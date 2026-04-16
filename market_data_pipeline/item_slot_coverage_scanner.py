"""Slot coverage scanner built on top of `ItemLinkScanner`."""

import json
import logging
import os
import time
from typing import Any

import pymem

from market_data_pipeline.item_link_scanner import ChatAddressFailedInScanner, ItemLinkScanner
from memory.pointers.dinput import DINPUT
from memory.pointers.inventory_slots import InventorySlots
from memory.pointers.window_messages import WindowMessages


def extract_simple_item_names(directory: str, output_file: str) -> None:
    """Extract unique simple items from `prepared_data_*.json` files into one JSON map."""
    logger = logging.getLogger("logger.extract_simple_item_names")
    unique_items: dict[Any, dict[str, str]] = {}

    for filename in os.listdir(directory):
        if not (filename.startswith("prepared_data_") and filename.endswith(".json")):
            continue

        file_path = os.path.join(directory, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as file_obj:
                data = json.load(file_obj)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to process file '%s': %s", filename, exc)
            continue

        simple_items = data.get("simple_items")
        if not isinstance(simple_items, dict):
            continue

        for item_name, item_details in simple_items.items():
            vid = item_details.get("vid")
            if vid is not None and vid not in unique_items:
                unique_items[vid] = {"name": item_name}

    sorted_items = dict(sorted(unique_items.items(), key=lambda item: int(item[0])))
    with open(output_file, "w", encoding="utf-8") as file_obj:
        json.dump(sorted_items, file_obj, ensure_ascii=False, indent=4)

    logger.info("Found %s unique simple items. Saved to: %s", len(sorted_items), output_file)


class ItemSlotCoverageGetter:
    """Detect how many inventory slots each item occupies (1/2/3) using chat link behavior."""

    def __init__(
        self,
        process: pymem.Pymem,
        clickable_inventory_slot_ids,
        window_messages: WindowMessages,
        dinput: DINPUT,
        inventory_slots: InventorySlots,
    ):
        self.process = process
        self.window_messages = window_messages
        self.dinput = dinput
        self.inventory_slots = inventory_slots
        self.clickable_inventory_slot_ids = clickable_inventory_slot_ids
        self.item_link_scanner = ItemLinkScanner(
            process,
            clickable_inventory_slot_ids,
            window_messages,
            dinput,
            inventory_slots,
        )
        self.logger = logging.getLogger(f"logger.{self.__class__.__name__}")
        self.inventory_focus_address = None
        self.chat_address = None

    def prepare_preconditions(self, retries=13):
        """Prepare and validate inventory/chat addresses required for scanning."""
        self.inventory_focus_address, self.chat_address = self.item_link_scanner.prepare_preconditions(retries)
        return self.inventory_focus_address, self.chat_address

    def get_item_slot_coverage_via_links(self, item_ids, items_info):
        """Populate `items_info[item_id]['slots']` by probing neighboring slots."""
        start_time = time.time()

        self.dinput.press_and_release_keys("i")
        self.window_messages.send_enter_to_window()
        item_index = 0
        try:
            while item_index < len(item_ids):
                used_slots = self.item_link_scanner._assign_items_to_inventory_slots(item_ids, item_index)
                item_index += len(used_slots)

                time.sleep(0.1)
                self.dinput.press_key("alt")
                time.sleep(0.1)
                try:
                    self._scan_items_in_slots(used_slots, items_info)
                finally:
                    time.sleep(0.1)
                    self.dinput.release_key("alt")
                    time.sleep(0.1)

            elapsed_time = time.time() - start_time
            self.logger.info("Slot coverage scan done in %.2fs for %s items", elapsed_time, len(item_ids))
            return items_info
        finally:
            self._clear_chat_input(backspaces=3)
            self.window_messages.send_enter_to_window()
            self.dinput.press_and_release_keys("i")

    def _clear_chat_input(self, backspaces: int = 3) -> None:
        for _ in range(backspaces):
            self.window_messages.send_backspace_to_window()

    def try_to_click_on_slot(self, slot_id, last_item_names):
        """Try to click one slot and parse its link from chat; return item name or None."""
        inventory_slot_pos = self.window_messages.get_inventory_slot_center_point(slot_id, self.inventory_focus_address)
        debug_flag = -1
        chat_content = None

        for attempt in range(10):
            if inventory_slot_pos != self.window_messages.get_last_left_click_pos():
                if attempt > 0:
                    self.window_messages.mouse_click(0, 0, self.inventory_focus_address, key="left")
                self.window_messages.click_on_inventory_slot(slot_id, self.inventory_focus_address, key="left")
                debug_flag = attempt

            chat_content = self.item_link_scanner.get_chat_content()
            if chat_content is None:
                raise ChatAddressFailedInScanner(f"Cannot read chat content for slot {slot_id}")

            if self.item_link_scanner.check_if_item_link_in_chat_content(chat_content):
                item_name = self.item_link_scanner.get_item_name_from_item_link(chat_content)
                if item_name is None:
                    raise ChatAddressFailedInScanner(f"Missing item name in chat content: {chat_content}")

                if item_name in last_item_names:
                    last_item_names.append(item_name)
                    if len(last_item_names) == 7:
                        raise ChatAddressFailedInScanner(
                            f"Detected same item name 7 times in a row: {last_item_names}"
                        )
                else:
                    last_item_names.clear()
                    last_item_names.append(item_name)
                return item_name

            if debug_flag != -1 and attempt > 4:
                return None

        raise ChatAddressFailedInScanner(
            f"Failed to resolve item link after 10 attempts. Last chat content: {chat_content}"
        )

    def _scan_items_in_slots(self, used_slots, items_info):
        last_item_names = []
        for slot_id, item_id in used_slots.items():
            real_item_name = items_info[str(item_id)]["name"]

            item_name = self.try_to_click_on_slot(slot_id, last_item_names)
            if item_name != real_item_name:
                self.logger.warning(
                    "Name mismatch for slot %s: scanned='%s', expected='%s'",
                    slot_id,
                    item_name,
                    real_item_name,
                )
                self._clear_chat_input(backspaces=3)
                continue
            self._clear_chat_input(backspaces=3)

            item_name = self.try_to_click_on_slot(slot_id + 5, last_item_names)
            if item_name is None:
                items_info[str(item_id)]["slots"] = 1
                continue
            self._clear_chat_input(backspaces=3)

            item_name = self.try_to_click_on_slot(slot_id + 10, last_item_names)
            if item_name is None:
                items_info[str(item_id)]["slots"] = 2
            elif item_name == real_item_name:
                items_info[str(item_id)]["slots"] = 3
            else:
                raise RuntimeError("Slot coverage scan returned inconsistent item name for third slot probe.")

            self._clear_chat_input(backspaces=5)
