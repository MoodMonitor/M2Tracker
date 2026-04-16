"""Utilities for scanning item links from in-game chat using inventory clicks."""

import pymem
import random
import time
import logging
import re
from typing import Iterable
from pymem.exception import MemoryReadError
from memory.pointers.window_messages import WindowMessages
from memory.pointers.dinput import DINPUT
from memory.pointers.inventory_slots import InventorySlots


class ItemLinkScanner:

    def __init__(self, process: pymem.Pymem, clickable_inventory_slot_ids: Iterable[int], window_messages: WindowMessages,
                 dinput: DINPUT, inventory_slots: InventorySlots):
        self.process = process
        self.window_messages = window_messages
        self.dinput = dinput
        self.inventory_slots = inventory_slots
        self.clickable_inventory_slot_ids = clickable_inventory_slot_ids
        self.inventory_focus_address = None
        self.chat_address = None
        self.logger = logging.getLogger("logger.{}".format(self.__class__.__name__))

    def prepare_preconditions(self, retries=13):
        self.inventory_focus_address = self.window_messages.get_inventory_window_address()
        for attempt in range(retries):
            try:
                self.chat_address = self.find_chat_address()
            except Exception as e:
                self.logger.error("Error while finding chat address: {}".format(e))
                time.sleep(5)
                continue
            
            try:
                self.test_chat_address()
                time.sleep(2)
                break
            except ChatAddressIsNotValid:
                pass
        else:
            raise PreparationFailed("Preparation of preconditions failed")
            
        self.logger.info("Preconditions prepared at attempt {}, chat address: {}, inventory address: {}"
                         .format(attempt, hex(self.chat_address), hex(self.inventory_focus_address)))
        return self.inventory_focus_address, self.chat_address

    def _assign_items_to_inventory_slots(self, item_ids, start_index):
        used_slots = {}
        for slot_id in self.clickable_inventory_slot_ids:
            if start_index >= len(item_ids):
                break
            item_id = item_ids[start_index]
            self.inventory_slots.set_item_vid_to_slot(slot_id, item_id)
            used_slots[slot_id] = item_id
            start_index += 1
        return used_slots

    def _scan_items_in_slots(self, used_slots, items_info):
        last_item_names = []
        for slot_id, item_id in used_slots.items():
            inventory_slot_pos = self.window_messages.get_inventory_slot_center_point(slot_id, self.inventory_focus_address)

            debug_flag = -1
            for attempt in range(10):
                if inventory_slot_pos != self.window_messages.get_last_left_click_pos():
                    if attempt > 0:
                        self.window_messages.mouse_click(0, 0, self.inventory_focus_address, key="left")  # avoid double click
                    self.window_messages.click_on_inventory_slot(slot_id, self.inventory_focus_address, key="left")
                    debug_flag = attempt

                chat_content = self.get_chat_content()
                if chat_content is None:
                    self.logger.error(f"Cannot get chat content for slot {slot_id}")
                    raise ChatAddressFailedInScanner(f"Cannot get chat content for slot {slot_id}")

                if self.check_if_item_link_in_chat_content(chat_content):
                    item_name = self.get_item_name_from_item_link(chat_content)
                    if item_name is None:
                        self.logger.error(f"Missing item name in content: {chat_content}")
                        raise ChatAddressFailedInScanner(f"Missing item name in content: {chat_content}")

                    if item_name in last_item_names:
                        last_item_names.append(item_name)
                        if len(last_item_names) == 7:
                            self.logger.error(f"Got the same item name 7 times in a row: {last_item_names}")
                            raise ChatAddressFailedInScanner(f"Got the same item name 7 times in a row: {last_item_names}")
                    else:
                        last_item_names = [item_name]

                    items_info[int(item_id)] = {"name": item_name}
                    break

            else:
                self.logger.error("Failed to get item name in 10 attempts, debug flag: {}".format(debug_flag))
                raise ChatAddressFailedInScanner("Failed to get item name in 10 attempts.")

            for _ in range(5):
                self.window_messages.send_backspace_to_window()

    def get_item_info_via_links(self, item_ids):
        items_info = {}
        start_time = time.time()

        self.dinput.press_and_release_keys("i")
        self.window_messages.send_enter_to_window()
        item_index = 0
        try:
            while item_index < len(item_ids):
                used_slots = self._assign_items_to_inventory_slots(item_ids, item_index)
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
            self.logger.info(f"Successfully scanned {len(item_ids)} items in time: {elapsed_time:.2f}s")
            return items_info
        finally:
            for _ in range(3):
                self.window_messages.send_backspace_to_window()
            self.window_messages.send_enter_to_window()
            self.dinput.press_and_release_keys("i")

    @staticmethod
    def get_item_name_from_item_link(chat_content):
        match = re.search(r"\|h\[(.*?)]\|h", chat_content)
        if match:
            return match.group(1)
        return None

    def get_chat_content(self):
        if self.chat_address is None:
            raise PreparationFailed("Chat address is not set. Call prepare_preconditions() first.")
        try:
            return self.process.read_string(self.chat_address, 1000, 'windows-1250')
        except (MemoryReadError, UnicodeDecodeError):
            self.logger.warning("Failed to get chat content from address: {}".format(hex(self.chat_address)))
            return None

    @staticmethod
    def check_if_item_link_in_chat_content(chat_content):
        if "|h" in chat_content:
            return True
        return False

    def find_chat_address(self):
        self.window_messages.send_enter_to_window()
        temp_string = "abcqwerty123"
        self.window_messages.send_string_to_window(temp_string)
        try:
            found_addresses = pymem.pattern.pattern_scan_all(self.process.process_handle,
                                                             bytes(temp_string, encoding="windows-1250"),
                                                             return_multiple=True)
        except pymem.exception.WinAPIError:
            self.logger.warning("Error finding chat address: WinApiError")
            return None
        finally:
            for _ in range(len(temp_string)):
                self.window_messages.send_backspace_to_window()
            self.window_messages.send_enter_to_window()

        if found_addresses:
            return found_addresses[-1]
        self.logger.warning("No chat address found!")
        return None

    def test_chat_address(self):
        if not self.inventory_focus_address:
            raise PreparationFailed("Missing inventory focus address")
            
        temp_string = "qwerty123abc"
        chat_test_attempts = 5

        self.dinput.press_and_release_keys("i")
        time.sleep(0.1)
        
        try:
            time.sleep(0.1)
            self.dinput.press_key("alt")
            time.sleep(0.2)
            slot_ids = random.sample(self.clickable_inventory_slot_ids[1:], len(self.clickable_inventory_slot_ids) - 2)

            for slot_id in slot_ids:
                inventory_slot_pos = self.window_messages.get_inventory_slot_center_point(slot_id, self.inventory_focus_address)
                self.window_messages.send_enter_to_window()
                time.sleep(0.1)
                for click_attempt in range(7):
                    if inventory_slot_pos != self.window_messages.get_last_left_click_pos():
                        if click_attempt > 0:
                            self.window_messages.mouse_click(0, 0, self.inventory_focus_address, key="left")  # avoid double left click
                        self.window_messages.click_on_inventory_slot(slot_id, self.inventory_focus_address, key="left")
                    else:
                        break
                    time.sleep(0.2)
                else:
                    raise ChatAddressIsNotValid("Could not click on inventory slot in chat test (7 attempts)")

                chat_content = self.get_chat_content()
                self.window_messages.send_backspace_to_window()
                if chat_content is None:
                    self.window_messages.send_enter_to_window()
                    raise ChatAddressIsNotValid
                result = self.check_if_item_link_in_chat_content(chat_content)
                if not result:
                    self.window_messages.send_enter_to_window()
                    raise ChatAddressIsNotValid

                self.window_messages.send_string_to_window(temp_string, fast_send=True)
                time.sleep(0.2)
                chat_content = self.get_chat_content()
                for _ in range(len(temp_string)):
                    self.window_messages.send_backspace_to_window()
                if chat_content != temp_string:
                    self.window_messages.send_enter_to_window()
                    raise ChatAddressIsNotValid
                self.window_messages.send_enter_to_window()
                time.sleep(0.5)
        finally:
            time.sleep(0.1)
            self.dinput.release_key("alt")
            time.sleep(0.1)
            self.dinput.press_and_release_keys("i")
            time.sleep(0.1)
            self.window_messages.mouse_click(0, 0, self.inventory_focus_address, key="left") # reset last left click pos


class NotFoundInventoryFocusAddress(Exception):
    pass

class ChatAddressIsNotValid(Exception):
    pass

class ChatAddressFailedInScanner(Exception):
    pass

class PreparationFailed(Exception):
    pass


