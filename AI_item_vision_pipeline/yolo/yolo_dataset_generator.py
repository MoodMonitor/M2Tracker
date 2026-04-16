"""YOLO dataset generator for Metin2 inventory slot detection.

This module automates creating *detection* training data for YOLO.

High-level idea
---------------
1) Randomly populate a subset of inventory slots with items (and sometimes quantities).
2) Capture a screenshot of a random inventory sub-grid.
3) Export labels in YOLO format (normalized cx, cy, w, h) for slots that *contain an item*.
4) Optionally render a visualization to quickly verify label correctness.

"""

from __future__ import annotations

import logging
import os
import random
import sys
import time
from pathlib import Path
from typing import Dict, List, Protocol, Tuple

import cv2
import pymem


BoxXYXY = Tuple[int, int, int, int]


class ItemIconCaptureProtocol(Protocol):
    """Minimal contract required by YoloDatasetGenerator for screenshot capture."""

    def capture_inventory_grid_area(
        self,
        start_slot: int,
        end_slot: int,
        filename: str,
        offset: tuple[int, int, int, int],
        inventory_x_size: int = 5,
        inventory_y_size: int = 9,
    ) -> Dict[int, BoxXYXY]:
        """Capture a sub-grid screenshot and return slot coordinates relative to it."""


class YoloDatasetGenerator:
    """Generate YOLO detection datasets from in-game inventory screenshots."""

    def __init__(
        self,
        process: object,
        window_messages: object,
        inventory_slots: object,
        icon_getter: ItemIconCaptureProtocol,
        items_to_use: List[int],
        dinput: object,
    ):
        self.process = process
        self.window_messages = window_messages
        self.inventory_slots = inventory_slots
        self.dinput = dinput
        self.icon_getter = icon_getter
        self.items_to_use = items_to_use
        self.logger = logging.getLogger(f"logger.{self.__class__.__name__}")

    @staticmethod
    def _generate_yolo_label_content(
        slot_coords: Dict[int, BoxXYXY],
        slot_states: Dict[int, bool],
        img_width: int,
        img_height: int,
    ) -> str:
        """Create a YOLO label file content from absolute pixel coordinates.

        Args:
            slot_coords: Map of ``slot_id -> (x1, y1, x2, y2)`` coordinates *relative
                to the captured screenshot*.
            slot_states: Map of ``slot_id -> bool`` describing whether the slot contains
                an item. Only slots with ``True`` are emitted as labels.
            img_width: Screenshot width in pixels.
            img_height: Screenshot height in pixels.

        Returns:
            YOLO label content (one line per box) with normalized cx, cy, w, h.
        """

        yolo_lines: List[str] = []
        for slot_id, (x1, y1, x2, y2) in slot_coords.items():
            if not slot_states.get(slot_id, False):
                continue

            class_id = 0  # single class: "item"

            slot_w = x2 - x1
            slot_h = y2 - y1
            center_x = x1 + (slot_w / 2)
            center_y = y1 + (slot_h / 2)

            # Normalize coordinates (YOLO format)
            norm_center_x = center_x / img_width
            norm_center_y = center_y / img_height
            norm_w = slot_w / img_width
            norm_h = slot_h / img_height

            yolo_lines.append(
                f"{class_id} {norm_center_x:.6f} {norm_center_y:.6f} {norm_w:.6f} {norm_h:.6f}"
            )

        return "\n".join(yolo_lines)

    def visualize_labels(self, image_path: str, label_path: str, output_path: str) -> None:
        """Draw YOLO labels on the image to validate dataset correctness."""

        image = cv2.imread(image_path)
        if image is None:
            self.logger.error("Could not read image for visualization: %s", image_path)
            return

        h, w = image.shape[:2]

        with open(label_path, "r", encoding="utf-8") as f:
            for line in f.readlines():
                class_id, norm_cx, norm_cy, norm_w, norm_h = map(float, line.split())

                # Denormalize
                cx = int(norm_cx * w)
                cy = int(norm_cy * h)
                box_w = int(norm_w * w)
                box_h = int(norm_h * h)

                x1 = int(cx - box_w / 2)
                y1 = int(cy - box_h / 2)
                x2 = int(cx + box_w / 2)
                y2 = int(cy + box_h / 2)

                # Green for class 0 (item)
                color = (0, 255, 0)
                cv2.rectangle(image, (x1, y1), (x2, y2), color, 1)
                _ = class_id  # class id currently unused (single-class dataset)

        cv2.imwrite(output_path, image)
        self.logger.info("Saved visualization to '%s'", output_path)

    def generate_dataset_by_rows(
        self,
        num_samples: int,
        output_dir: str,
        fill_ratio: float = 0.6,
        max_inner_offset: int = 5,
        max_outer_offset: int = 50,
        inventory_x_size: int = 5,
        inventory_y_size: int = 9,
    ) -> None:
        """Generate samples by capturing full inventory rows.

        This variant always captures *whole rows* (continuous horizontal range for each
        chosen row), which reduces the risk of partially capturing non-labeled slots
        on the left/right edges.

        Args:
            num_samples: Number of image/label pairs to generate.
            output_dir: Output directory (will contain images/labels/visualizations).
            fill_ratio: Fraction of slots to populate with items.
            max_inner_offset: Max random crop offset (pixels) when the crop boundary is
                adjacent to non-captured slots.
            max_outer_offset: Max random crop offset (pixels) on the outer inventory boundary.
            inventory_x_size: Inventory grid columns.
            inventory_y_size: Inventory grid rows.
        """

        base_path = Path(output_dir)
        images_path = base_path / "images"
        labels_path = base_path / "labels"
        visualizations_path = base_path / "visualizations"
        images_path.mkdir(parents=True, exist_ok=True)
        labels_path.mkdir(parents=True, exist_ok=True)
        visualizations_path.mkdir(parents=True, exist_ok=True)

        self.logger.info("Starting dataset generation for %s samples...", num_samples)

        for i in range(num_samples):
            self.logger.info("--- Generating sample %s/%s ---", i + 1, num_samples)

            # 1) Choose which full rows to capture.
            num_rows_to_capture = random.randint(1, inventory_y_size)
            start_row = random.randint(0, inventory_y_size - num_rows_to_capture)
            end_row = start_row + num_rows_to_capture - 1

            start_slot = start_row * inventory_x_size + 1
            end_slot = (end_row + 1) * inventory_x_size

            self.logger.info(
                "Capturing rows %s to %s (slots %s to %s)",
                start_row,
                end_row,
                start_slot,
                end_slot,
            )

            # 2) Compute allowed crop offsets to avoid capturing non-labeled slots.
            # Top offset is intentionally smaller for the top edge because of equipped inventory UI.
            top_offset_max = max_outer_offset // 2 if start_row == 0 else max_inner_offset
            bottom_offset_max = max_outer_offset if end_row == (inventory_y_size - 1) else max_inner_offset
            # We capture full rows -> left/right can be larger.
            left_offset_max = max_outer_offset
            right_offset_max = max_outer_offset

            offset_top = random.randint(1, top_offset_max)
            offset_bottom = random.randint(1, bottom_offset_max)
            offset_left = random.randint(1, left_offset_max)
            offset_right = random.randint(1, right_offset_max)

            # 3) Randomly populate slots BEFORE taking the screenshot.
            slots_in_grid: List[int] = []
            for r in range(start_row, end_row + 1):
                for c in range(inventory_x_size):
                    slots_in_grid.append(r * inventory_x_size + c + 1)

            slot_states: Dict[int, bool] = {}
            for slot_id in slots_in_grid:
                has_item = random.random() < fill_ratio
                slot_states[slot_id] = has_item

                if has_item:
                    item_id = random.choice(self.items_to_use)
                    self.inventory_slots.set_item_vid_to_slot(slot_id, item_id)

                    # Sometimes set a random quantity (stack size).
                    if random.random() < 0.3:
                        self.inventory_slots.set_item_quantity_to_slot(slot_id, random.randint(1, 10000))
                    else:
                        self.inventory_slots.set_item_quantity_to_slot(slot_id, 1)
                else:
                    # Empty slot
                    self.inventory_slots.set_item_quantity_to_slot(slot_id, 1)
                    self.inventory_slots.set_item_vid_to_slot(slot_id, 0)

            self._update_inventory_items()  # wait for the game to render

            # 4) Capture screenshot and slot coordinates (relative to screenshot).
            sample_name = f"sample_{i:04d}"
            img_path = str(images_path / f"{sample_name}.png")

            slot_coords = self.icon_getter.capture_inventory_grid_area(
                start_slot=start_slot,
                end_slot=end_slot,
                filename=img_path,
                offset=(offset_left, offset_top, offset_right, offset_bottom),
                inventory_x_size=inventory_x_size,
                inventory_y_size=inventory_y_size,
            )

            if not slot_coords:
                self.logger.error("Failed to capture grid area. Skipping sample.")
                continue

            img = cv2.imread(img_path)
            if img is None:
                self.logger.error("Failed to read back screenshot from '%s'. Skipping.", img_path)
                continue

            h, w = img.shape[:2]
            label_content = self._generate_yolo_label_content(slot_coords, slot_states, w, h)

            label_path = labels_path / f"{sample_name}.txt"
            with open(label_path, "w", encoding="utf-8") as f:
                f.write(label_content)

            # 5) Render visualization to quickly spot annotation issues.
            vis_path = str(visualizations_path / f"{sample_name}_visualized.png")
            self.visualize_labels(img_path, str(label_path), vis_path)

            self.logger.info("Saved image, label, and visualization for '%s'.", sample_name)

        self.logger.info("Dataset generation complete.")

    def generate_dataset_by_grid(
        self,
        num_samples: int,
        output_dir: str,
        fill_ratio: float = 0.6,
        max_inner_offset: int = 5,
        max_outer_offset: int = 50,
        inventory_x_size: int = 5,
        inventory_y_size: int = 9,
    ) -> None:
        """Generate samples by capturing random rectangular sub-grids.

        This variant captures random (width x height) rectangles. It tries to reduce
        label leakage by limiting crop offsets when the crop is adjacent to non-captured
        slots.

        Args:
            num_samples: Number of image/label pairs to generate.
            output_dir: Output directory (will contain images/labels/visualizations).
            fill_ratio: Fraction of slots to populate with items.
            max_inner_offset: Max random crop offset (pixels) near inner boundaries.
            max_outer_offset: Max random crop offset (pixels) on outer inventory boundary.
            inventory_x_size: Inventory grid columns.
            inventory_y_size: Inventory grid rows.
        """

        base_path = Path(output_dir)
        images_path = base_path / "images"
        labels_path = base_path / "labels"
        visualizations_path = base_path / "visualizations"
        images_path.mkdir(parents=True, exist_ok=True)
        labels_path.mkdir(parents=True, exist_ok=True)
        visualizations_path.mkdir(parents=True, exist_ok=True)

        self.logger.info(
            "Starting dataset generation for %s samples using random grids...", num_samples
        )

        for i in range(num_samples):
            self.logger.info("--- Generating sample %s/%s ---", i + 1, num_samples)

            # 1) Choose random grid bounds.
            grid_width = random.randint(1, inventory_x_size)
            grid_height = random.randint(1, inventory_y_size)
            start_col = random.randint(0, inventory_x_size - grid_width)
            start_row = random.randint(0, inventory_y_size - grid_height)
            end_col = start_col + grid_width - 1
            end_row = start_row + grid_height - 1

            start_slot = start_row * inventory_x_size + start_col + 1
            end_slot = end_row * inventory_x_size + end_col + 1

            self.logger.info(
                "Capturing grid from slot %s to %s (rows: %s-%s, cols: %s-%s)",
                start_slot,
                end_slot,
                start_row,
                end_row,
                start_col,
                end_col,
            )

            # 2) Determine crop offsets.
            offset_top = random.randint(
                1, max_outer_offset // 2 if start_row == 0 else max_inner_offset
            )
            offset_bottom = random.randint(
                1, max_outer_offset if end_row == (inventory_y_size - 1) else max_inner_offset
            )
            offset_left = random.randint(1, max_outer_offset if start_col == 0 else max_inner_offset)
            offset_right = random.randint(
                1, max_outer_offset if end_col == (inventory_x_size - 1) else max_inner_offset
            )

            # 3) Populate chosen slots.
            slots_in_grid: List[int] = []
            for r in range(start_row, end_row + 1):
                for c in range(start_col, end_col + 1):
                    slots_in_grid.append(r * inventory_x_size + c + 1)

            slot_states: Dict[int, bool] = {slot_id: (random.random() < fill_ratio) for slot_id in slots_in_grid}
            for slot_id, has_item in slot_states.items():
                item_id = random.choice(self.items_to_use) if has_item else 0

                if item_id != 0 and random.random() < 0.3:
                    self.inventory_slots.set_item_quantity_to_slot(slot_id, random.randint(1, 10000))
                else:
                    self.inventory_slots.set_item_quantity_to_slot(slot_id, 1)

                self.inventory_slots.set_item_vid_to_slot(slot_id, item_id)

            self._update_inventory_items()  # wait for the game to render

            # 4) Capture screenshot and coordinates.
            sample_name = f"sample_grid_{i:04d}"
            img_path = str(images_path / f"{sample_name}.png")

            slot_coords = self.icon_getter.capture_inventory_grid_area(
                start_slot,
                end_slot,
                img_path,
                offset=(offset_left, offset_top, offset_right, offset_bottom),
                inventory_x_size=inventory_x_size,
                inventory_y_size=inventory_y_size,
            )

            if not slot_coords:
                self.logger.error("Failed to capture grid area. Skipping sample.")
                continue

            img = cv2.imread(img_path)
            if img is None:
                self.logger.error("Failed to read back screenshot from '%s'. Skipping.", img_path)
                continue

            h, w = img.shape[:2]
            label_content = self._generate_yolo_label_content(slot_coords, slot_states, w, h)
            label_path = labels_path / f"{sample_name}.txt"

            with open(label_path, "w", encoding="utf-8") as f:
                f.write(label_content)

            vis_path = str(visualizations_path / f"{sample_name}_visualized.png")
            self.visualize_labels(img_path, str(label_path), vis_path)
            self.logger.info("Saved image, label, and visualization for '%s'.", sample_name)

        self.logger.info("Dataset generation complete.")

    def _update_inventory_items(self) -> None:
        """Tiny UI refresh hack so the game renders inventory changes."""

        time.sleep(0.1)
        self.dinput.press_key("alt")
        time.sleep(0.1)
        self.dinput.release_key("alt")
        time.sleep(0.1)


def _load_item_ids_from_simple_names(simple_items_path: str) -> List[int]:
    """Load item VIDs from a simple item DB JSON (keyed by vid)."""

    import json

    with open(simple_items_path, "r", encoding="utf-8") as f:
        items_data = json.load(f)

    # JSON keys are strings.
    return [int(vid) for vid in items_data.keys()]


def _find_workspace_root(start_path: Path) -> Path:
    """Find workspace root by locating both AI and market pipeline folders."""

    for parent in [start_path] + list(start_path.parents):
        if (parent / "AI_item_vision_pipeline").exists() and (parent / "market_data_pipeline").exists():
            return parent
    raise RuntimeError("Could not locate workspace root containing AI_item_vision_pipeline and market_data_pipeline")


def _ensure_market_pipeline_on_sys_path(workspace_root: Path) -> None:
    """Expose market_data_pipeline as top-level package root for legacy imports."""

    market_pipeline_root = workspace_root / "market_data_pipeline"
    if str(market_pipeline_root) not in sys.path:
        sys.path.append(str(market_pipeline_root))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    logger = logging.getLogger("yolo_dataset_generator")

    workspace_root = _find_workspace_root(Path(__file__).resolve())
    _ensure_market_pipeline_on_sys_path(workspace_root)

    from memory.base_pointers import BasePointers
    from memory.pointers.dinput import DINPUT
    from memory.pointers.inventory_slots import InventorySlots
    from memory.pointers.window_messages import WindowMessages
    from servers.server.variables import (
        DINPUT_KEYS,
        INVENTORY_SLOTS,
        WINDOW_DETAILS,
        WINDOW_FOCUS,
        WINDOW_INPUT,
    )

    try:
        from .item_icon_getter import ItemIconGetter
    except ImportError:
        from item_icon_getter import ItemIconGetter

    item_link_scanner_pointers = {
        "window_input_pointer": WINDOW_INPUT,
        "inventory_slots_pointer": INVENTORY_SLOTS,
        "window_focus_pointer": WINDOW_FOCUS,
    }

    process, window_hwnd = BasePointers.get_window_handle_and_pid()
    BasePointers(process, window_hwnd).initialize_pointers(item_link_scanner_pointers)

    dinput = DINPUT(process, **item_link_scanner_pointers, dinput_keys=DINPUT_KEYS)
    window_messages = WindowMessages(
        process,
        **item_link_scanner_pointers,
        window_handle=window_hwnd,
        window_details=WINDOW_DETAILS,
    )
    inventory_slots = InventorySlots(process, **item_link_scanner_pointers)

    # Use all visible inventory slots so capture works across full 5x9 grid.
    all_inventory_slots = list(range(1, 46))
    icon_getter = ItemIconGetter(process, window_messages, dinput, inventory_slots, all_inventory_slots)

    default_items_path = workspace_root / "market_data_pipeline" / "servers" / "server" / "item_names.json"
    simple_items_path = Path(os.getenv("YOLO_ITEMS_JSON", str(default_items_path)))
    if not simple_items_path.exists():
        raise FileNotFoundError(
            f"Item IDs JSON not found: {simple_items_path}. Set YOLO_ITEMS_JSON to a valid file path."
        )
    item_ids_to_use = _load_item_ids_from_simple_names(str(simple_items_path))

    dataset_generator = YoloDatasetGenerator(
        process=process,
        window_messages=window_messages,
        inventory_slots=inventory_slots,
        icon_getter=icon_getter,
        items_to_use=item_ids_to_use,
        dinput=dinput,
    )

    logger.info("Starting dataset generation in 3 seconds...")
    time.sleep(3)

    generate_by_rows = False
    output_root = workspace_root / "AI_item_vision_pipeline"

    if generate_by_rows:
        logger.info("Mode: generate by full rows")
        dataset_generator.generate_dataset_by_rows(
            num_samples=75,
            output_dir=str(output_root / "yolo_dataset_rows"),
            fill_ratio=0.65,
            max_inner_offset=7,
            max_outer_offset=69,
        )
    else:
        logger.info("Mode: generate by random grids")
        dataset_generator.generate_dataset_by_grid(
            num_samples=150,
            output_dir=str(output_root / "yolo_dataset_grid"),
            fill_ratio=0.5,
            max_inner_offset=7,
            max_outer_offset=69,
        )

