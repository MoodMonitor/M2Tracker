import argparse
import importlib
import json
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

import win32con
import win32gui


PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from market_data_pipeline.shop_data_scraper import ShopDataScraper


def _build_parser():
    parser = argparse.ArgumentParser(description="Run shop data scraper for a selected server.")
    parser.add_argument("--server", default="server", help="Server module name in servers/<name>.")
    parser.add_argument("--exe-path", default=None, help="Optional path to game executable; if omitted attaches to running game.")
    parser.add_argument("--username", default=os.getenv("SHOP_LOGIN"), help="Account login.")
    parser.add_argument("--password", default=os.getenv("SHOP_PASSWORD"), help="Account password.")
    parser.add_argument("--character-index", type=int, default=None, help="Optional character index for scraper.")
    parser.add_argument("--item-vids-file", default=None, help="Path to item_names.json.")
    parser.add_argument("--output-dir", default="./shop_data_scrapper_data", help="Output directory for shop data.")
    parser.add_argument("--shop-mob-ids", default="30000,30001,30002,30003,30004,30005,30006,30007,30008,30009", help="Comma separated shop mob IDs.")
    parser.add_argument("--shop-capacity", type=int, default=90, help="Max scanned slots per shop.")
    parser.add_argument("--shop-locations", default="/localization r 0,/localization r 1,/localization r 2,/localization r 3,/localization r 4,/localization r 5,/localization r 6", help="Comma separated teleport commands.")
    parser.add_argument("--start-wait-seconds", type=int, default=10, help="Wait after process start.")
    parser.add_argument("--check-item-names", action="store_true", help="Resolve and update item names after scraping.")
    parser.add_argument("--item-name-retries", type=int, default=5, help="Retry count for item link scanner.")
    return parser


def _resolve_server_classes(server_name):
    module = importlib.import_module(f"servers.{server_name}.shop_scanner_runner")
    scanner_cls = getattr(module, "ServerShopScanner", None) or getattr(module, "ServerShopScanner", None)
    shop_cls = getattr(module, "ServerShop", None) or getattr(module, "ServerShop", None)
    if scanner_cls is None or shop_cls is None:
        raise ImportError(f"Could not find scanner/shop classes in servers.{server_name}.shop_scanner_runner")
    return scanner_cls, shop_cls


def main():
    from logger.logger import init_logger
    from memory.base_pointers import BasePointers
    from memory.pointers.dinput import DINPUT
    from memory.pointers.entity_list import EntityList
    from memory.pointers.inventory_slots import InventorySlots
    from memory.pointers.player import Player
    from memory.pointers.window_messages import WindowMessages
    from market_data_pipeline.item_link_scanner import ChatAddressFailedInScanner, ItemLinkScanner, PreparationFailed

    args = _build_parser().parse_args()
    if not args.username or not args.password:
        raise ValueError("Missing credentials. Use --username/--password or SHOP_LOGIN/SHOP_PASSWORD env vars.")

    variables = importlib.import_module(f"servers.{args.server}.variables")
    scanner_cls, shop_cls = _resolve_server_classes(args.server)

    pointers = {
        "player_pointer": variables.PLAYER_POINTER,
        "window_input_pointer": variables.WINDOW_INPUT,
        "entity_pointer": variables.ENTITY_POINTER,
        "player_control_pointer": variables.PLAYER_CONTROL,
        "shop_pointer": variables.SHOP,
        "window_focus_pointer": variables.WINDOW_FOCUS,
    }
    link_scanner_pointers = {
        "window_input_pointer": variables.WINDOW_INPUT,
        "inventory_slots_pointer": variables.INVENTORY_SLOTS,
        "window_focus_pointer": variables.WINDOW_FOCUS,
    }

    logs_path = PROJECT_ROOT / "logs"
    logger = init_logger(str(logs_path), f"{args.server}_shop_data_scrapper", max_history_files=2)

    if args.exe_path:
        process, window_handle = ShopDataScraper.start_game(args.exe_path)
        time.sleep(args.start_wait_seconds)
    else:
        process, window_handle = BasePointers.get_window_handle_and_pid()

    BasePointers(process, window_handle).initialize_pointers(pointers)

    window_messages = WindowMessages(
        process=process,
        window_handle=window_handle,
        window_details=variables.WINDOW_DETAILS,
        **pointers,
    )
    entity = EntityList(process, **pointers)
    player = Player(process, **pointers)
    dinput = DINPUT(process, **pointers, dinput_keys=variables.DINPUT_KEYS)
    shop = shop_cls(process, **pointers)

    item_vids_file = Path(args.item_vids_file) if args.item_vids_file else (PROJECT_ROOT / "servers" / args.server / "item_names.json")
    shop_mobs_ids = [int(value.strip()) for value in args.shop_mob_ids.split(",") if value.strip()]
    scanner = scanner_cls(process, shop, entity, player, dinput, shop_mobs_ids, args.shop_capacity, str(item_vids_file))

    shop_locations = [value.strip() for value in args.shop_locations.split(",") if value.strip()]
    scrapper = ShopDataScraper(
        args.username,
        args.password,
        args.character_index,
        window_messages=window_messages,
        player=player,
        dinput=dinput,
        shop_locations=shop_locations,
        shop_scanner=scanner,
    )

    logger.info("Logging in...")
    scrapper.login_to_account()
    time.sleep(5)
    scrapper.select_character_and_wait_until_loaded()
    time.sleep(3)
    shops_data = scrapper.teleport_to_shop_locations_and_get_shop_data()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    file_name = datetime.now().strftime(f"shop_data_{args.server}_%Y-%m-%d_%H-%M.json")
    output_path = output_dir / file_name
    with open(output_path, "w", encoding="utf-8") as json_file:
        json.dump(shops_data, json_file, ensure_ascii=False, indent=3)
    logger.info("Shop data saved to: %s", output_path)

    if not args.check_item_names:
        return

    dinput.press_and_release_keys("esc")
    dinput.press_and_release_keys("esc")
    time.sleep(1)

    backup_path = item_vids_file.with_name(f"{item_vids_file.stem}_backup{item_vids_file.suffix}")
    shutil.copy2(item_vids_file, backup_path)
    actual_item_names = scanner_cls.get_item_names_vid_from_file(str(item_vids_file))

    item_vids = []
    for shop_data in shops_data:
        for item_vid, item_info in shop_data.items():
            if isinstance(item_info, dict):
                item_vids.append(int(item_vid))
    item_vids = list(set(item_vids))
    logger.info("Item vids to verify: %s", len(item_vids))

    BasePointers(process, window_handle).initialize_pointers(link_scanner_pointers)
    inventory_slots = InventorySlots(process, **link_scanner_pointers)
    win32gui.ShowWindow(window_handle, win32con.SW_MINIMIZE)

    inv_slot_ids = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 35]
    item_link_scanner = ItemLinkScanner(process, inv_slot_ids, window_messages, dinput, inventory_slots)
    for attempt in range(args.item_name_retries):
        try:
            item_link_scanner.prepare_preconditions()
            item_names = item_link_scanner.get_item_info_via_links(item_vids[:])
            break
        except (ChatAddressFailedInScanner, PreparationFailed) as exc:
            logger.warning("Item link scan attempt %s/%s failed: %s", attempt + 1, args.item_name_retries, exc)
            time.sleep(60)
    else:
        raise ChatAddressFailedInScanner

    for item_vid, item_name in item_names.items():
        if item_vid in actual_item_names and actual_item_names[item_vid] != item_name:
            logger.info("Updating item name for vid=%s from '%s' to '%s'", item_vid, actual_item_names[item_vid], item_name)
            actual_item_names[item_vid] = item_name
        elif item_vid not in actual_item_names:
            logger.info("Adding new item name: %s -> %s", item_vid, item_name)
            actual_item_names[item_vid] = item_name

    with open(item_vids_file, "w", encoding="utf-8") as json_file:
        json.dump(actual_item_names, json_file, ensure_ascii=False, indent=3)
    logger.info("Updated item names file: %s", item_vids_file)


if __name__ == "__main__":
    main()
