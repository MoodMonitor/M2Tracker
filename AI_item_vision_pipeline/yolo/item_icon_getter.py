"""Utilities for capturing inventory icons and preparing icon datasets.

This module contains the minimal, production-oriented API used by the AI item
vision tooling. It intentionally avoids experimental research helpers and keeps
only functions that are reusable for dataset generation and icon grouping.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import shutil
import time
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

import cv2
import mss
import mss.tools
import numpy as np
import pymem
import win32gui

from market_data_pipeline.memory.pointers.dinput import DINPUT
from market_data_pipeline.memory.pointers.inventory_slots import InventorySlots
from market_data_pipeline.memory.pointers.window_messages import WindowMessages

BoxXYXY = Tuple[int, int, int, int]


def find_missing_icons(
    items_with_slots_path: str,
    icons_directory: str,
    max_slot_size: int = 1,
) -> Dict[str, Dict[str, str]]:
    """Return items that do not have an icon image in the target folder.

    Args:
        items_with_slots_path: JSON path with item entries keyed by item id.
            Expected shape: {"<vid>": {"name": "...", "slots": 1, ...}, ...}
        icons_directory: Directory with icon files named like "<vid>_<name>.png".
        max_slot_size: Include only items where `slots <= max_slot_size`.

    Returns:
        Mapping of missing item ids to minimal item metadata.
    """

    logger = logging.getLogger("logger.find_missing_icons")

    try:
        with open(items_with_slots_path, "r", encoding="utf-8") as file_obj:
            all_items = json.load(file_obj)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Could not load items file '%s': %s", items_with_slots_path, exc)
        return {}

    icons_path = Path(icons_directory)
    if not icons_path.is_dir():
        logger.error("Icons directory does not exist: %s", icons_directory)
        return {}

    existing_vid_prefixes = {
        icon_file.name.split("_", 1)[0]
        for icon_file in icons_path.iterdir()
        if icon_file.is_file() and icon_file.suffix.lower() == ".png" and "_" in icon_file.name
    }

    missing_items: Dict[str, Dict[str, str]] = {}
    for vid, data in all_items.items():
        if int(data.get("slots", 99)) > max_slot_size:
            continue
        if str(vid) in existing_vid_prefixes:
            continue
        missing_items[str(vid)] = {"name": str(data.get("name", ""))}

    logger.info(
        "Found %d missing icons for slot size <= %d",
        len(missing_items),
        max_slot_size,
    )
    return missing_items


def filter_single_slot_items(input_file: str, output_file: str) -> int:
    """Filter item names and keep likely single-slot consumables/materials.

    The filtering rules are intentionally conservative and game-specific.

    Args:
        input_file: Source JSON with item id -> metadata mapping.
        output_file: Destination JSON path for filtered items.

    Returns:
        Number of items written to the output file.
    """

    logger = logging.getLogger("logger.filter_single_slot_items")

    equipment_keywords = {
        "miecz", "ostrze", "sztylet", "noz", "kozik", "klinga", "luk", "wachlarz",
        "dzwon", "gizarma", "partyzana", "kosa", "sierp",
        "zbroja", "pancerz", "ubranie", "szata", "smoking", "kostium",
        "helm", "kaptur", "maska", "czapka", "kapelusz", "diadem", "tiara", "korona",
        "tarcza", "kolczyki", "bransoleta", "naszyjnik", "buty", "kozaki",
        "rekawice", "pas", "opaska", "bojownik", "stroj", "mundur", "toga",
    }

    try:
        with open(input_file, "r", encoding="utf-8") as file_obj:
            all_items = json.load(file_obj)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Could not load '%s': %s", input_file, exc)
        return 0

    filtered_items: Dict[str, Dict[str, object]] = {}
    for item_id, item_data in all_items.items():
        item_name = str(item_data.get("name", ""))
        if not item_name:
            continue

        name_lower = item_name.lower()

        if re.search(r"\+\d+$", name_lower):
            continue
        if re.search(r"\d$", name_lower):
            continue
        if any(re.search(r"\b" + re.escape(keyword) + r"\b", name_lower) for keyword in equipment_keywords):
            continue

        filtered_items[str(item_id)] = item_data

    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as file_obj:
        json.dump(filtered_items, file_obj, indent=3, ensure_ascii=False)

    logger.info("Saved %d filtered items to %s", len(filtered_items), output_path)
    return len(filtered_items)


def convert_icon_groups_format(input_path: str, output_path: str) -> Dict[str, Dict[str, list[str]]]:
    """Convert icon group JSON from hashed format to legacy grouped-name format.

    Input format:
        {"100002_unique.png": [{"id": "100002", "name": "Name"}]}

    Output format:
        {"100002": {"names": ["100002_Name"]}}
    """

    logger = logging.getLogger("logger.convert_icon_groups_format")

    try:
        with open(input_path, "r", encoding="utf-8") as file_obj:
            input_data = json.load(file_obj)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Could not load '%s': %s", input_path, exc)
        return {}

    converted: Dict[str, Dict[str, list[str]]] = {}
    for representative_filename, items_in_group in input_data.items():
        representative_id = str(representative_filename).split("_", 1)[0]
        names: list[str] = []

        for item_details in items_in_group:
            item_id = item_details.get("id")
            item_name = item_details.get("name")
            if item_id and item_name:
                names.append(f"{item_id}_{item_name}")

        if names:
            converted[representative_id] = {"names": names}

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as file_obj:
        json.dump(converted, file_obj, indent=4, ensure_ascii=False)

    logger.info("Converted %d groups to %s", len(converted), output_file)
    return converted


def group_by_pixel_hash(
    icons_path: str,
    items_db_path: str,
    output_path: str,
    cleanup: bool = False,
) -> Dict[str, list[Dict[str, str]]]:
    """Group icons by exact pixel identity and save representative files.

    This method is intentionally strict: two icons match only if their RGB bytes
    are identical after image decoding.
    """

    logger = logging.getLogger("logger.group_by_pixel_hash")
    icons_dir = Path(icons_path)
    out_dir = Path(output_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        with open(items_db_path, "r", encoding="utf-8") as db_file:
            items_db = json.load(db_file) if items_db_path else {}
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.warning("Could not load items db '%s': %s", items_db_path, exc)
        items_db = {}

    groups: Dict[str, Dict[str, object]] = {}
    for icon_file in icons_dir.iterdir():
        if not icon_file.is_file() or icon_file.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue

        try:
            image_bytes = icon_file.read_bytes()
            image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                logger.warning("Skipping unreadable icon: %s", icon_file.name)
                continue
        except OSError as exc:
            logger.warning("Skipping icon '%s': %s", icon_file.name, exc)
            continue

        pixel_hash = hashlib.md5(image.tobytes()).hexdigest()
        group = groups.setdefault(pixel_hash, {"representative": icon_file, "items": []})
        group["items"].append(icon_file)

    mapping: Dict[str, list[Dict[str, str]]] = {}
    for group_data in groups.values():
        representative = Path(group_data["representative"])
        icon_files = list(group_data["items"])

        group_details: list[Dict[str, str]] = []
        for file_path in icon_files:
            item_id = file_path.name.split("_", 1)[0]
            item_name = str(items_db.get(item_id, {}).get("name", "Unknown"))
            group_details.append({"id": item_id, "name": item_name, "original_path": str(file_path)})

        if not group_details:
            continue

        representative_id = group_details[0]["id"]
        new_filename = f"{representative_id}_unique.png"
        shutil.copy2(representative, out_dir / new_filename)
        mapping[new_filename] = group_details

    mapping_path = out_dir / "icon_groups_hashed.json"
    with open(mapping_path, "w", encoding="utf-8") as file_obj:
        json.dump(mapping, file_obj, indent=4, ensure_ascii=False)

    if cleanup:
        for group_data in groups.values():
            for file_path in group_data["items"]:
                try:
                    Path(file_path).unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove source icon: %s", file_path)

    logger.info("Saved %d grouped icons to %s", len(mapping), out_dir)
    return mapping


class ItemIconGetter:
    """Capture inventory icons and grid regions from the game window."""

    def __init__(
        self,
        process: pymem.Pymem,
        window_messages: WindowMessages,
        dinput: DINPUT,
        inventory_slots: InventorySlots,
        inventory_slots_ids: list[int],
    ) -> None:
        self.process = process
        self.window_messages = window_messages
        self.dinput = dinput
        self.inventory_slots = inventory_slots
        self.inventory_slots_ids = inventory_slots_ids

        self.window_hwnd = self.window_messages.window_hwnd
        self._inventory_address = self.window_messages.get_inventory_window_address()
        self.logger = logging.getLogger(f"logger.{self.__class__.__name__}")

    @staticmethod
    def _screenshot_mss(rect: Dict[str, int], filename: str) -> None:
        """Capture a rectangular region and write it as PNG."""

        with mss.mss() as sct:
            img = sct.grab(rect)
            mss.tools.to_png(img.rgb, img.size, output=filename)

    def _refresh_inventory_view(self) -> None:
        """Nudge UI rendering after in-memory slot edits."""

        time.sleep(0.1)
        self.dinput.press_key("alt")
        time.sleep(0.1)
        self.dinput.release_key("alt")
        time.sleep(0.1)

    def capture_inventory_area(self, filename: str = "inventory.png", offset: Optional[Tuple[int, int]] = None) -> bool:
        """Capture the full inventory window area to file."""

        if not self._inventory_address:
            self.logger.error("Could not resolve inventory window address")
            return False

        offset_x, offset_y = offset or (0, 0)
        x1, x2, y1, y2 = self.window_messages.get_window_size(self._inventory_address)
        game_point = win32gui.ClientToScreen(self.window_messages.window_hwnd, (x1, y1))

        inventory_rect = {
            "left": game_point[0] - offset_x,
            "top": game_point[1] - offset_y,
            "width": (x2 - x1) + (2 * offset_x),
            "height": (y2 - y1) + (2 * offset_y),
        }

        output_path = Path(filename)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._screenshot_mss(inventory_rect, str(output_path))
        return True

    def capture_item_icon_by_slot(
        self,
        slot_id: int,
        filename: Optional[str] = None,
        inventory_x_size: int = 5,
        inventory_y_size: int = 9,
        add_random_offset: Optional[Tuple[int, int]] = None,
    ) -> bool:
        """Capture one inventory slot as an icon image."""

        if not self._inventory_address:
            self.logger.error("Could not resolve inventory window address")
            return False

        output_name = filename or f"item_slot_{slot_id}.png"

        cell_x1, cell_x2, cell_y1, cell_y2 = self.window_messages.get_inventory_slot_pos(
            slot_id,
            self._inventory_address,
            inventory_x_size,
            inventory_y_size,
        )
        cell_width, cell_height = cell_x2 - cell_x1, cell_y2 - cell_y1
        game_point = win32gui.ClientToScreen(self.window_messages.window_hwnd, (cell_x1, cell_y1))

        offset_x = 0
        offset_y = 0
        if add_random_offset:
            offset_x = random.randint(add_random_offset[0], add_random_offset[1])
            offset_y = random.randint(add_random_offset[0], add_random_offset[1])

        icon_rect = {
            "left": game_point[0] + offset_x,
            "top": game_point[1] + offset_y,
            "width": cell_width,
            "height": cell_height,
        }

        output_path = Path(output_name)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._screenshot_mss(icon_rect, str(output_path))
        return True

    def _iter_slots_in_grid(
        self,
        start_slot: int,
        end_slot: int,
        inventory_x_size: int,
    ) -> Iterable[int]:
        start_col = (start_slot - 1) % inventory_x_size
        start_row = (start_slot - 1) // inventory_x_size
        end_col = (end_slot - 1) % inventory_x_size
        end_row = (end_slot - 1) // inventory_x_size

        row_from, row_to = sorted((start_row, end_row))
        col_from, col_to = sorted((start_col, end_col))

        for row in range(row_from, row_to + 1):
            for col in range(col_from, col_to + 1):
                yield row * inventory_x_size + col + 1

    def capture_inventory_grid_area(
        self,
        start_slot: int,
        end_slot: int,
        filename: str,
        offset: Tuple[int, int, int, int] = (0, 0, 0, 0),
        inventory_x_size: int = 5,
        inventory_y_size: int = 9,
    ) -> Optional[Dict[int, BoxXYXY]]:
        """Capture a slot sub-grid and return per-slot boxes relative to the image."""

        if not self._inventory_address:
            self.logger.error("Could not resolve inventory window address")
            return None

        sx1, sx2, sy1, sy2 = self.window_messages.get_inventory_slot_pos(
            start_slot,
            self._inventory_address,
            inventory_x_size,
            inventory_y_size,
        )
        ex1, ex2, ey1, ey2 = self.window_messages.get_inventory_slot_pos(
            end_slot,
            self._inventory_address,
            inventory_x_size,
            inventory_y_size,
        )

        grid_x1 = min(sx1, ex1)
        grid_y1 = min(sy1, ey1)
        grid_x2 = max(sx2, ex2)
        grid_y2 = max(sy2, ey2)

        offset_left, offset_top, offset_right, offset_bottom = offset
        screen_origin = win32gui.ClientToScreen(self.window_messages.window_hwnd, (grid_x1, grid_y1))

        screenshot_rect = {
            "left": screen_origin[0] - offset_left,
            "top": screen_origin[1] - offset_top,
            "width": (grid_x2 - grid_x1) + offset_left + offset_right,
            "height": (grid_y2 - grid_y1) + offset_top + offset_bottom,
        }

        output_path = Path(filename)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._screenshot_mss(screenshot_rect, str(output_path))

        slot_coords_relative: Dict[int, BoxXYXY] = {}
        for slot_id in self._iter_slots_in_grid(start_slot, end_slot, inventory_x_size):
            x1, x2, y1, y2 = self.window_messages.get_inventory_slot_pos(
                slot_id,
                self._inventory_address,
                inventory_x_size,
                inventory_y_size,
            )

            cell_w, cell_h = x2 - x1, y2 - y1
            rel_x1 = (x1 - grid_x1) + offset_left
            rel_y1 = (y1 - grid_y1) + offset_top
            rel_x2 = rel_x1 + cell_w
            rel_y2 = rel_y1 + cell_h
            slot_coords_relative[slot_id] = (rel_x1, rel_y1, rel_x2, rel_y2)

        return slot_coords_relative

    def _assign_items_to_inventory_slots(self, item_ids: list[str], start_index: int) -> Dict[int, str]:
        """Place item ids in configured slots and return used slot mapping."""

        used_slots: Dict[int, str] = {}
        for slot_id in self.inventory_slots_ids:
            if start_index >= len(item_ids):
                break

            item_id = item_ids[start_index]
            self.inventory_slots.set_item_vid_to_slot(slot_id, int(item_id))
            used_slots[slot_id] = item_id
            start_index += 1

        return used_slots

    def get_items_icons(
        self,
        items_to_capture: Dict[str, Dict[str, str]],
        output_path: str,
        inventory_x_size: int = 5,
        inventory_y_size: int = 9,
    ) -> None:
        """Capture icon PNG files for all items from `items_to_capture`."""

        if not self.inventory_slots_ids:
            self.logger.error("No inventory slot ids were configured")
            return

        output_dir = Path(output_path)
        output_dir.mkdir(parents=True, exist_ok=True)

        all_item_ids = list(items_to_capture.keys())
        item_index = 0

        while item_index < len(all_item_ids):
            used_slots = self._assign_items_to_inventory_slots(all_item_ids, item_index)
            item_index += len(used_slots)
            self._refresh_inventory_view()

            for slot_id, item_id in used_slots.items():
                item_name = str(items_to_capture[item_id].get("name", ""))
                safe_name = "".join(c for c in item_name if c.isalnum() or c in (" ", "_", "-")).rstrip().replace(" ", "_")
                filename = f"{item_id}_{safe_name}.png" if safe_name else f"{item_id}.png"
                full_path = output_dir / filename
                self.capture_item_icon_by_slot(
                    slot_id=slot_id,
                    filename=str(full_path),
                    inventory_x_size=inventory_x_size,
                    inventory_y_size=inventory_y_size,
                )


def generate_icon_samples(
    simple_groups_path: str,
    output_path: str,
    icon_getter: ItemIconGetter,
    samples_per_icon: int = 4,
    quantity_samples_per_icon: int = 2,
) -> None:
    """Generate icon crops for grouped items using random slot/quantity variation."""

    logger = logging.getLogger("logger.generate_icon_samples")

    quantity_ranges = [
        (2, 9),
        (10, 99),
        (100, 999),
        (1000, 9999),
    ]

    base_output_path = Path(output_path)
    base_output_path.mkdir(parents=True, exist_ok=True)

    try:
        with open(simple_groups_path, "r", encoding="utf-8") as file_obj:
            icon_groups = json.load(file_obj)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Could not load icon groups '%s': %s", simple_groups_path, exc)
        return

    tasks: list[tuple[str, str, int, bool]] = []
    for representative_filename, items_in_group in icon_groups.items():
        representative_id = str(representative_filename).split("_", 1)[0]
        item_ids_in_group = [str(item["id"]) for item in items_in_group if "id" in item]
        if not item_ids_in_group:
            continue

        if samples_per_icon > 0:
            tasks.append((representative_id, random.choice(item_ids_in_group), 1, False))
        if quantity_samples_per_icon > 0:
            tasks.append((representative_id, random.choice(item_ids_in_group), random.randint(2, 200), False))

        for _ in range(max(0, samples_per_icon - 1)):
            tasks.append((representative_id, random.choice(item_ids_in_group), 1, True))

        for i in range(max(0, quantity_samples_per_icon - 1)):
            range_min, range_max = quantity_ranges[i % len(quantity_ranges)]
            random_quantity = random.randint(range_min, range_max)
            tasks.append((representative_id, random.choice(item_ids_in_group), random_quantity, True))

    logger.info("Prepared %d icon sample tasks", len(tasks))

    slots_available = icon_getter.inventory_slots_ids
    batch_size = len(slots_available)
    task_index = 0

    while task_index < len(tasks):
        batch_tasks = tasks[task_index: task_index + batch_size]
        slots_to_fill = slots_available[: len(batch_tasks)]

        for slot_id, (_, item_id, quantity, _) in zip(slots_to_fill, batch_tasks):
            icon_getter.inventory_slots.set_item_quantity_to_slot(slot_id, quantity)
            icon_getter.inventory_slots.set_item_vid_to_slot(slot_id, int(item_id))

        icon_getter._refresh_inventory_view()

        for slot_id, (representative_id, _, _, use_offset) in zip(slots_to_fill, batch_tasks):
            icon_folder = base_output_path / representative_id
            icon_folder.mkdir(exist_ok=True)

            existing_samples = len(list(icon_folder.glob("*.png")))
            output_file = icon_folder / f"sample_{existing_samples + 1}.png"
            random_offset = (-1, 1) if use_offset else None

            icon_getter.capture_item_icon_by_slot(
                slot_id=slot_id,
                filename=str(output_file),
                add_random_offset=random_offset,
            )

        task_index += len(batch_tasks)

    logger.info("Icon sample generation completed")
