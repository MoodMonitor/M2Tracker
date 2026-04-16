import argparse
import importlib
import json
import sys
import time
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))


def _build_parser():
    parser = argparse.ArgumentParser(description="Resolve item names from shop data via item links.")
    parser.add_argument("--server", default="server", help="Server module name in servers/<name>.")
    parser.add_argument("--input-file", required=True, help="Path to shop_data_*.json file.")
    parser.add_argument("--output-dir", default="./item_link_scanner_data", help="Output directory for item_names json.")
    parser.add_argument("--retries", type=int, default=3, help="Retry attempts for chat address resolution.")
    return parser


def main():
    from logger.logger import init_logger
    from memory.base_pointers import BasePointers
    from memory.pointers.dinput import DINPUT
    from memory.pointers.inventory_slots import InventorySlots
    from memory.pointers.window_messages import WindowMessages
    from market_data_pipeline.item_link_scanner import ChatAddressFailedInScanner, ItemLinkScanner

    args = _build_parser().parse_args()
    variables = importlib.import_module(f"servers.{args.server}.variables")

    pointers = {
        "window_input_pointer": variables.WINDOW_INPUT,
        "inventory_slots_pointer": variables.INVENTORY_SLOTS,
        "window_focus_pointer": variables.WINDOW_FOCUS,
    }

    logs_path = PROJECT_ROOT / "logs"
    logger = init_logger(str(logs_path), f"{args.server}_item_link_scanner", max_history_files=2)

    process, window_hwnd = BasePointers.get_window_handle_and_pid()
    BasePointers(process, window_hwnd).initialize_pointers(pointers)

    dinput = DINPUT(process, **pointers, dinput_keys=variables.DINPUT_KEYS)
    window_messages = WindowMessages(process, **pointers, window_handle=window_hwnd, window_details=variables.WINDOW_DETAILS)
    inventory_slots = InventorySlots(process, **pointers)

    inv_slot_ids = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 35]
    item_link_scanner = ItemLinkScanner(process, inv_slot_ids, window_messages, dinput, inventory_slots)

    with open(args.input_file, "r", encoding="utf-8") as json_file:
        shops_data = json.load(json_file)

    item_vids = []
    for shop_data in shops_data:
        for item_vid, item_info in shop_data.items():
            if isinstance(item_info, dict):
                item_vids.append(int(item_vid))
    item_vids = list(set(item_vids))
    logger.info("Found %s unique item vids to resolve.", len(item_vids))

    for attempt in range(args.retries):
        try:
            item_link_scanner.prepare_preconditions()
            item_names = item_link_scanner.get_item_info_via_links(item_vids[:])
            break
        except ChatAddressFailedInScanner as exc:
            logger.warning("Attempt %s/%s failed: %s", attempt + 1, args.retries, exc)
            time.sleep(60)
    else:
        raise ChatAddressFailedInScanner

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    file_name = datetime.now().strftime(f"item_names_{args.server}_%Y-%m-%d_%H-%M.json")
    output_path = output_dir / file_name
    with open(output_path, "w", encoding="utf-8") as json_file:
        json.dump(item_names, json_file, ensure_ascii=False, indent=3)

    logger.info("Item names saved to: %s", output_path)


if __name__ == "__main__":
    main()
