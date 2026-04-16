import argparse
import importlib
import json
import logging
import os
import random
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from ultralytics import YOLO


def _find_project_root(start_path: Path) -> Path:
    """Find the workspace root by looking for top-level project markers."""
    for parent in [start_path] + list(start_path.parents):
        if (parent / "main.py").exists() and (parent / "servers").exists() and (parent / "memory").exists():
            return parent
    return start_path.parents[3]


PROJECT_ROOT = _find_project_root(Path(__file__).resolve())
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from logger.logger import init_logger
from memory.base_pointers import BasePointers
from memory.pointers.dinput import DINPUT
from memory.pointers.inventory_slots import InventorySlots
from memory.pointers.window_messages import WindowMessages
from market_data_pipeline.item_link_scanner import ChatAddressFailedInScanner
from market_data_pipeline.item_slot_coverage_scanner import ItemSlotCoverageGetter, extract_simple_item_names
from item_recognition.item_icon_getter import (
    ItemIconGetter,
    convert_icon_groups_format,
    find_missing_icons,
    generate_icon_samples,
    group_by_pixel_hash,
)
from item_recognition.cnn_model.recognizer import Recognizer


logger = logging.getLogger("workflow")

# Loaded at runtime from servers.<server_name>.variables
WINDOW_INPUT = None
DINPUT_KEYS = None
INVENTORY_SLOTS = None
WINDOW_DETAILS = None
WINDOW_FOCUS = None

SERVER_NAME = "server"
SERVER_DIR = PROJECT_ROOT / "servers" / SERVER_NAME
PREPARED_DATA_DIR = SERVER_DIR / "prepared_data"
RECOGNITION_DIR = SERVER_DIR / "item_recognition"
ICONS_DIR = RECOGNITION_DIR / "icons"
UNIQUE_ICONS_DIR = RECOGNITION_DIR / "unique_icons_hashed"
SAMPLES_DIR = RECOGNITION_DIR / "icon_samples"
FEATURES_DB_PATH = RECOGNITION_DIR / "features_db_average_v3.pkl"
ALL_ITEMS_DB_PATH = SERVER_DIR / "item_names.json"
CNN_MODEL_PATH = RECOGNITION_DIR / "models" / "cnn_model.pth"
YOLO_MODEL_PATH = RECOGNITION_DIR / "models" / "yolo_model.pt"

CNN_CONFIG = {
    "train_dir": str(RECOGNITION_DIR / "datasets" / "train"),
    "val_dir": str(RECOGNITION_DIR / "datasets" / "val"),
    "num_epochs": 200,
    "embedding_size": 256,
    "p_sampler": 32,
    "k_sampler": 4,
    "learning_rate": 1e-3,
    "weight_decay": 1e-4,
    "arcface_margin": 0.5,
    "arcface_scale": 30.0,
    "input_size": 32,
    "model_save_path": "embedding_model.pth",
    "early_stopping_patience": 10,
}
CNN_CONFIG["batch_size"] = CNN_CONFIG["p_sampler"] * CNN_CONFIG["k_sampler"]


def _configure_runtime(server_name: str) -> None:
    """Load server-specific memory pointers and resolve all runtime paths."""
    global SERVER_NAME, SERVER_DIR, PREPARED_DATA_DIR, RECOGNITION_DIR, ICONS_DIR
    global UNIQUE_ICONS_DIR, SAMPLES_DIR, FEATURES_DB_PATH, ALL_ITEMS_DB_PATH
    global CNN_MODEL_PATH, YOLO_MODEL_PATH, WINDOW_INPUT, DINPUT_KEYS, INVENTORY_SLOTS
    global WINDOW_DETAILS, WINDOW_FOCUS

    SERVER_NAME = server_name
    SERVER_DIR = PROJECT_ROOT / "servers" / SERVER_NAME
    PREPARED_DATA_DIR = SERVER_DIR / "prepared_data"
    RECOGNITION_DIR = SERVER_DIR / "item_recognition"
    ICONS_DIR = RECOGNITION_DIR / "icons"
    UNIQUE_ICONS_DIR = RECOGNITION_DIR / "unique_icons_hashed"
    SAMPLES_DIR = RECOGNITION_DIR / "icon_samples"
    FEATURES_DB_PATH = RECOGNITION_DIR / "features_db_average_v3.pkl"
    ALL_ITEMS_DB_PATH = SERVER_DIR / "item_names.json"

    CNN_MODEL_PATH = Path(os.getenv("WORKFLOW_CNN_MODEL", str(RECOGNITION_DIR / "models" / "cnn_model.pth")))
    YOLO_MODEL_PATH = Path(os.getenv("WORKFLOW_YOLO_MODEL", str(RECOGNITION_DIR / "models" / "yolo_model.pt")))

    CNN_CONFIG["train_dir"] = os.getenv("WORKFLOW_TRAIN_DIR", str(RECOGNITION_DIR / "datasets" / "train"))
    CNN_CONFIG["val_dir"] = os.getenv("WORKFLOW_VAL_DIR", str(RECOGNITION_DIR / "datasets" / "val"))

    variables_module = importlib.import_module(f"servers.{SERVER_NAME}.variables")
    WINDOW_INPUT = variables_module.WINDOW_INPUT
    DINPUT_KEYS = variables_module.DINPUT_KEYS
    INVENTORY_SLOTS = variables_module.INVENTORY_SLOTS
    WINDOW_DETAILS = variables_module.WINDOW_DETAILS
    WINDOW_FOCUS = variables_module.WINDOW_FOCUS


def _initialize_game_modules():
    """Initialize modules used to interact with the game process."""
    logger.info("Initializing game interaction modules...")
    process, window_hwnd = BasePointers.get_window_handle_and_pid()
    pointers_config = {
        "window_input_pointer": WINDOW_INPUT,
        "inventory_slots_pointer": INVENTORY_SLOTS,
        "window_focus_pointer": WINDOW_FOCUS,
    }
    BasePointers(process, window_hwnd).initialize_pointers(pointers_config)

    dinput = DINPUT(process, **pointers_config, dinput_keys=DINPUT_KEYS)
    window_messages = WindowMessages(
        process,
        **pointers_config,
        window_handle=window_hwnd,
        window_details=WINDOW_DETAILS,
    )
    inventory_slots = InventorySlots(process, **pointers_config)
    return process, window_hwnd, dinput, window_messages, inventory_slots


def _prepare_directories() -> None:
    """Create output directories used by the workflow."""
    RECOGNITION_DIR.mkdir(parents=True, exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    UNIQUE_ICONS_DIR.mkdir(parents=True, exist_ok=True)
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)


def step_0_get_slot_coverage() -> None:
    """[ONLINE] Collect slot coverage for each candidate item."""
    logger.info("[Step 0] Collecting item slot coverage...")
    process, _, dinput, window_messages, inventory_slots = _initialize_game_modules()

    inv_slot_ids = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 35]
    slot_coverage_getter = ItemSlotCoverageGetter(process, inv_slot_ids, window_messages, dinput, inventory_slots)

    all_simple_items_path = SERVER_DIR / "all_simple_items.json"
    extract_simple_item_names(str(PREPARED_DATA_DIR), str(all_simple_items_path))

    with open(all_simple_items_path, "r", encoding="utf-8") as file_obj:
        items_to_check = json.load(file_obj)

    item_vids = list(map(int, items_to_check.keys()))
    for retry in range(3):
        try:
            logger.info("Attempt %s/3: preparing game preconditions...", retry + 1)
            slot_coverage_getter.prepare_preconditions()
            slot_coverage_getter.get_item_slot_coverage_via_links(item_vids, items_to_check)
            logger.info("Slot coverage scan completed.")
            break
        except ChatAddressFailedInScanner as exc:
            logger.error("Scan failed: %s. Retrying in 15 seconds...", exc)
            time.sleep(15)
    else:
        raise ChatAddressFailedInScanner("Could not resolve chat address after 3 attempts.")

    output_filename = f"item_names_with_slot_coverage_{datetime.now().strftime('%Y-%m-%d_%H-%M')}.json"
    output_path = SERVER_DIR / output_filename
    with open(output_path, "w", encoding="utf-8") as file_obj:
        json.dump(items_to_check, file_obj, ensure_ascii=False, indent=4)
    logger.info("Saved slot coverage to: %s", output_path)


def step_1_filter_slots() -> None:
    """[OFFLINE] Keep only single-slot items from slot coverage output."""
    logger.info("[Step 1] Filtering single-slot items...")
    items_with_slots_path = SERVER_DIR / "item_names_with_slot_coverage.json"
    single_slot_items_path = RECOGNITION_DIR / "single_slot_items.json"

    if not items_with_slots_path.exists():
        raise FileNotFoundError(f"Missing required file: {items_with_slots_path}")

    with open(items_with_slots_path, "r", encoding="utf-8") as file_obj:
        all_items_with_slots = json.load(file_obj)

    single_slot_items = {
        vid: data for vid, data in all_items_with_slots.items() if data.get("slots", 99) == 1
    }
    with open(single_slot_items_path, "w", encoding="utf-8") as file_obj:
        json.dump(single_slot_items, file_obj, indent=4, ensure_ascii=False)

    logger.info("Saved %s single-slot items to: %s", len(single_slot_items), single_slot_items_path)


def step_2_get_icons(items_with_slots_path: Path) -> None:
    """[ONLINE] Capture missing icons for filtered single-slot items."""
    logger.info("[Step 2] Capturing missing item icons...")
    items_to_capture = find_missing_icons(str(items_with_slots_path), str(ICONS_DIR), max_slot_size=1)

    if not items_to_capture:
        logger.info("No missing icons detected.")
        return

    logger.info("Found %s missing icons. Starting capture...", len(items_to_capture))
    process, _, dinput, window_messages, inventory_slots = _initialize_game_modules()
    icon_getter = ItemIconGetter(
        process=process,
        window_messages=window_messages,
        dinput=dinput,
        inventory_slots=inventory_slots,
        inventory_slots_ids=[1],
    )
    icon_getter.get_items_icons(items_to_capture, str(ICONS_DIR))
    logger.info("Icon capture completed.")


def step_3_process_icons() -> None:
    """[OFFLINE] Group icons by hash and convert grouping format."""
    logger.info("[Step 3] Grouping unique icons by pixel hash...")
    group_by_pixel_hash(str(ICONS_DIR), str(ALL_ITEMS_DB_PATH), str(UNIQUE_ICONS_DIR))

    hashed_groups_path = UNIQUE_ICONS_DIR / "icon_groups_hashed.json"
    converted_groups_path = UNIQUE_ICONS_DIR / "icon_groups.json"
    convert_icon_groups_format(str(hashed_groups_path), str(converted_groups_path))
    logger.info("Icon grouping conversion completed.")


def step_4_get_samples() -> None:
    """[ONLINE] Generate dataset samples for unique icon groups."""
    logger.info("[Step 4] Generating icon samples...")
    if any(SAMPLES_DIR.iterdir()):
        logger.info("Samples directory is not empty. Skipping generation.")
        return

    _, _, dinput, window_messages, inventory_slots = _initialize_game_modules()
    icon_getter_samples = ItemIconGetter(
        process=None,
        window_messages=window_messages,
        dinput=dinput,
        inventory_slots=inventory_slots,
        inventory_slots_ids=list(range(1, 46)),
    )
    hashed_groups_path = UNIQUE_ICONS_DIR / "icon_groups_hashed.json"
    generate_icon_samples(
        simple_groups_path=str(hashed_groups_path),
        output_path=str(SAMPLES_DIR),
        icon_getter=icon_getter_samples,
        samples_per_icon=5,
        quantity_samples_per_icon=5,
    )
    logger.info("Sample generation completed.")


def visualize_hashed_groups(
    groups_json_path: str,
    original_icons_path: str,
    review_output_path: str,
    min_group_size: int = 2,
) -> None:
    """Build visual collages from hashed icon groups for manual review."""
    logger.info("Creating group collages from: %s", Path(groups_json_path).name)
    groups_path = Path(groups_json_path)
    icons_path = Path(original_icons_path)
    output_path = Path(review_output_path)
    output_path.mkdir(parents=True, exist_ok=True)

    try:
        with open(groups_path, "r", encoding="utf-8") as file_obj:
            icon_groups = json.load(file_obj)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Cannot load icon groups file '%s': %s", groups_path, exc)
        return

    collages_created = 0
    for representative_filename, items in icon_groups.items():
        if len(items) < min_group_size:
            continue

        images_to_combine = []
        for item_details in items:
            item_id = item_details.get("id")
            original_icon_path = next(icons_path.glob(f"{item_id}_*.png"), None)
            if not original_icon_path or not original_icon_path.exists():
                logger.warning("Missing icon for id=%s in %s", item_id, icons_path)
                continue

            try:
                pil_img = Image.open(original_icon_path)
                img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGBA2BGRA)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Failed to read image '%s': %s", original_icon_path, exc)
                continue

            images_to_combine.append(img)

        if len(images_to_combine) < min_group_size:
            continue

        collage = cv2.hconcat(images_to_combine)
        collage_filename = f"group_{representative_filename}"
        _, buffer = cv2.imencode(".png", collage)
        with open(output_path / collage_filename, "wb") as file_obj:
            file_obj.write(buffer)
        collages_created += 1

    logger.info("Created %s collages in: %s", collages_created, output_path)


def step_5_build_db() -> None:
    """[OFFLINE] Build embeddings database from generated samples."""
    logger.info("[Step 5] Building embeddings database...")
    if FEATURES_DB_PATH.exists():
        logger.warning("Existing features DB found. Recreating: %s", FEATURES_DB_PATH)
        os.remove(FEATURES_DB_PATH)

    Recognizer(
        model_path=str(CNN_MODEL_PATH),
        features_db_path=str(FEATURES_DB_PATH),
        icons_path=str(ICONS_DIR),
        dataset_path=str(SAMPLES_DIR),
        config=CNN_CONFIG,
    )
    logger.info("Features database created: %s", FEATURES_DB_PATH)


def step_6_run_e2e_test(num_iterations: int = 25) -> None:
    """[ONLINE] Run end-to-end detector + recognizer evaluation loop."""
    logger.info("[Step 6] Running E2E test for server '%s'...", SERVER_NAME)

    total_correct = 0
    total_incorrect = 0
    total_missed = 0
    total_placed_overall = 0
    all_incorrect_logs = []

    process, _, dinput, window_messages, inventory_slots = _initialize_game_modules()
    icon_getter = ItemIconGetter(process, window_messages, dinput, inventory_slots, list(range(1, 46)))

    yolo_detector = YOLO(str(YOLO_MODEL_PATH))
    cnn_recognizer = Recognizer(
        model_path=str(CNN_MODEL_PATH),
        features_db_path=str(FEATURES_DB_PATH),
        icons_path=str(SAMPLES_DIR),
        dataset_path=str(SAMPLES_DIR),
        config=CNN_CONFIG,
    )

    grouped_items_path = UNIQUE_ICONS_DIR / "icon_groups.json"
    with open(grouped_items_path, "r", encoding="utf-8") as file_obj:
        icon_groups = json.load(file_obj)
        item_names_db = {rep_id: data["names"][0].split("_", 1)[1] for rep_id, data in icon_groups.items()}

    item_ids_to_use = list(item_names_db.keys())
    test_e2e_path = RECOGNITION_DIR / "test_e2e_results"
    test_e2e_path.mkdir(exist_ok=True)
    incorrect_collages_path = test_e2e_path / "incorrect_comparisons"
    incorrect_collages_path.mkdir(exist_ok=True)

    for iteration in range(num_iterations):
        logger.info("\n%s START ITERATION %s/%s %s", "=" * 20, iteration + 1, num_iterations, "=" * 20)

        test_slots = list(range(1, 46))
        ground_truth = {}
        for slot_id in test_slots:
            if random.random() < 0.7:
                item_id = int(random.choice(item_ids_to_use))
                inventory_slots.set_item_vid_to_slot(slot_id, item_id)
                inventory_slots.set_item_quantity_to_slot(slot_id, random.randint(1, 201))
                ground_truth[slot_id] = str(item_id)
            else:
                inventory_slots.set_item_vid_to_slot(slot_id, 0)

        time.sleep(0.1)
        dinput.press_key("alt")
        time.sleep(0.1)
        dinput.release_key("alt")
        time.sleep(0.1)

        test_screenshot_path = test_e2e_path / f"e2e_iter_{iteration + 1}.png"
        icon_getter.capture_inventory_area(str(test_screenshot_path))
        main_image = cv2.imread(str(test_screenshot_path))

        yolo_results = yolo_detector(main_image, conf=0.55, iou=0.5)
        detected_boxes = sorted(
            yolo_results[0].boxes.cpu().numpy(),
            key=lambda box: (box.xyxy[0][1], box.xyxy[0][0]),
        )
        gt_coords_map = icon_getter.capture_inventory_grid_area(1, 45, str(test_screenshot_path), (0, 0, 0, 0))

        correct = 0
        incorrect = 0
        found_slot_ids = set()

        for box in detected_boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detected_center_x = x1 + (x2 - x1) // 2
            detected_center_y = y1 + (y2 - y1) // 2

            found_slot_id = None
            for slot_id, (sx1, sy1, sx2, sy2) in gt_coords_map.items():
                if sx1 < detected_center_x < sx2 and sy1 < detected_center_y < sy2:
                    found_slot_id = slot_id
                    found_slot_ids.add(slot_id)
                    break

            if not found_slot_id or found_slot_id not in ground_truth:
                continue

            truth_id = ground_truth[found_slot_id]
            roi_image = main_image[y1:y2, x1:x2]
            results = cnn_recognizer.find_best_match(roi_image, top_k=1)
            if not results:
                continue

            recognized_id, _score = results[0]
            if truth_id == recognized_id:
                correct += 1
                continue

            incorrect += 1
            truth_name = item_names_db.get(truth_id, "Unknown GT")
            rec_name = item_names_db.get(recognized_id, "Unknown prediction")
            error_msg = (
                f"Slot {found_slot_id}: predicted '{rec_name}' ({recognized_id}) "
                f"instead of '{truth_name}' ({truth_id})"
            )
            logger.warning(error_msg)

            try:
                truth_icon_path = next(ICONS_DIR.glob(f"{truth_id}_*.png"), None)
                pred_icon_path = next(ICONS_DIR.glob(f"{recognized_id}_*.png"), None)
                if truth_icon_path and pred_icon_path:
                    truth_img = cv2.imread(str(truth_icon_path))
                    pred_img = cv2.imread(str(pred_icon_path))
                    collage = cv2.hconcat([truth_img, pred_img])
                    collage_name = (
                        f"iter{iteration + 1}_slot{found_slot_id}_"
                        f"truth_{truth_id}_pred_{recognized_id}.png"
                    )
                    cv2.imwrite(str(incorrect_collages_path / collage_name), collage)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Failed to create error collage: %s", exc)

            all_incorrect_logs.append(error_msg)

        missed = len(ground_truth) - len(found_slot_ids.intersection(ground_truth.keys()))
        total_placed_overall += len(ground_truth)
        total_correct += correct
        total_incorrect += incorrect
        total_missed += missed

        logger.info(
            "Iteration %s summary -> correct: %s, incorrect: %s, missed by YOLO: %s",
            iteration + 1,
            correct,
            incorrect,
            missed,
        )

        if incorrect > 0 or missed > 0:
            for missed_id in set(ground_truth.keys()) - found_slot_ids:
                mx1, my1, mx2, my2 = gt_coords_map[missed_id]
                cv2.rectangle(main_image, (mx1, my1), (mx2, my2), (0, 255, 255), 2)
            cv2.imwrite(str(test_screenshot_path), main_image)
        else:
            os.remove(test_screenshot_path)

    logger.info("\n%s FINAL E2E SUMMARY %s", "=" * 20, "=" * 20)
    logger.info("Iterations: %s", num_iterations)
    logger.info("Total placed items: %s", total_placed_overall)
    logger.info("Correct recognitions: %s", total_correct)
    logger.info("Incorrect recognitions: %s", total_incorrect)
    logger.info("Missed by detector: %s", total_missed)

    detected_total = total_placed_overall - total_missed
    if detected_total > 0:
        accuracy = (total_correct / detected_total) * 100
        logger.info("Recognition accuracy (correct / detected): %.2f%%", accuracy)

    if all_incorrect_logs:
        logger.warning("\n%s DETAILED ERROR LIST %s", "=" * 20, "=" * 20)
        for error in all_incorrect_logs:
            logger.warning(error)


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Anonymized item recognition workflow. Run exactly one step per invocation.",
    )
    parser.add_argument("--server", default=os.getenv("WORKFLOW_SERVER", "server"), help="Server config name.")
    parser.add_argument(
        "--step",
        required=True,
        choices=[
            "prepare_dirs",
            "step_0_slot_coverage",
            "step_1_filter_slots",
            "step_2_get_icons",
            "step_3_process_icons",
            "step_4_get_samples",
            "step_5_build_db",
            "step_6_e2e_test",
            "visualize_groups",
        ],
        help="Single workflow step to execute.",
    )
    parser.add_argument("--iterations", type=int, default=25, help="Iteration count for E2E step.")
    parser.add_argument(
        "--items-with-slots",
        default=None,
        help="Optional path to item_names_with_slot_coverage.json for step_2_get_icons.",
    )
    parser.add_argument("--min-group-size", type=int, default=2, help="Minimum group size for visualization.")
    return parser


def main() -> None:
    args = _build_arg_parser().parse_args()
    _configure_runtime(args.server)

    logs_path = PROJECT_ROOT / "logs"
    log_file_name = f"workflow_{SERVER_NAME}_{datetime.now().strftime('%Y%m%d')}"
    global logger
    logger = init_logger(str(logs_path), log_file_name, max_history_files=3)

    _prepare_directories()
    logger.info("Workflow initialized for server '%s'.", SERVER_NAME)
    logger.info(
        "Run steps in order: step_0_slot_coverage -> step_1_filter_slots -> step_2_get_icons -> "
        "step_3_process_icons -> step_4_get_samples -> step_5_build_db -> step_6_e2e_test"
    )

    if args.step == "prepare_dirs":
        logger.info("Directory preparation done.")
        return
    if args.step == "step_0_slot_coverage":
        step_0_get_slot_coverage()
    elif args.step == "step_1_filter_slots":
        step_1_filter_slots()
    elif args.step == "step_2_get_icons":
        default_path = SERVER_DIR / "item_names_with_slot_coverage.json"
        step_2_get_icons(Path(args.items_with_slots) if args.items_with_slots else default_path)
    elif args.step == "step_3_process_icons":
        step_3_process_icons()
    elif args.step == "step_4_get_samples":
        step_4_get_samples()
    elif args.step == "step_5_build_db":
        step_5_build_db()
    elif args.step == "step_6_e2e_test":
        step_6_run_e2e_test(num_iterations=args.iterations)
    elif args.step == "visualize_groups":
        visualize_hashed_groups(
            groups_json_path=str(UNIQUE_ICONS_DIR / "icon_groups_hashed.json"),
            original_icons_path=str(ICONS_DIR),
            review_output_path=str(RECOGNITION_DIR / "review_hashed_groups"),
            min_group_size=args.min_group_size,
        )

    logger.info("Step '%s' completed.", args.step)


if __name__ == "__main__":
    main()
