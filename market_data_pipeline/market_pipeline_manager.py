"""Manager for orchestrating one or more server-specific shop scraping runs."""

import argparse
import importlib
import json
import logging
import os
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict

import win32con
import win32gui

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from market_data_pipeline.item_link_scanner import ChatAddressFailedInScanner, ItemLinkScanner, PreparationFailed
from market_data_pipeline.shop_data_scraper import ShopDataScraper
from memory.base_pointers import BasePointers
from memory.pointers.dinput import DINPUT
from memory.pointers.entity_list import EntityList
from memory.pointers.inventory_slots import InventorySlots
from memory.pointers.player import Player
from memory.pointers.shop import Shop
from memory.pointers.window_messages import WindowMessages


def get_needed_server_variables(server_name: str):
    module_path = f"servers.{server_name}.variables"
    module = importlib.import_module(module_path)
    pointers_dict = {
        "player_pointer": module.PLAYER_POINTER,
        "window_input_pointer": module.WINDOW_INPUT,
        "entity_pointer": module.ENTITY_POINTER,
        "player_control_pointer": module.PLAYER_CONTROL,
        "shop_pointer": module.SHOP,
        "window_focus_pointer": module.WINDOW_FOCUS,
        "inventory_slots_pointer": module.INVENTORY_SLOTS,
    }
    return pointers_dict, module.WINDOW_DETAILS, module.DINPUT_KEYS


def make_file_backup(file_path):
    dir_name, file_name = os.path.split(file_path)
    name, ext = os.path.splitext(file_name)
    backup_name = f"{name}_backup{ext}"
    backup_path = os.path.join(dir_name, backup_name)
    shutil.copy2(file_path, backup_path)


def start_game_and_load_server_pointers(exe_path, pointer_details: dict, window_details: dict, dinput_keys: dict,
                                        wait_after_game_start : int = 7):
    process, window_handle = ShopDataScraper.start_game(exe_path)
    time.sleep(wait_after_game_start)
    BasePointers(process, window_handle).initialize_pointers(pointer_details)
    time.sleep(5)
    dinput = DINPUT(process, **pointer_details, dinput_keys=dinput_keys)
    entity = EntityList(process, **pointer_details)
    player = Player(process, **pointer_details, dinput=dinput)
    inventory_slots = InventorySlots(process, **pointer_details)
    window_messages = WindowMessages(process=process, window_handle=window_handle, window_details=window_details,
                                     **pointer_details)
    return process, window_handle, player, entity, inventory_slots, window_messages, dinput


def attach_to_game_and_load_server_pointers(pointer_details: dict, window_details: dict, dinput_keys: dict):
    process, window_handle = BasePointers.get_window_handle_and_pid()
    BasePointers(process, window_handle).initialize_pointers(pointer_details)
    dinput = DINPUT(process, **pointer_details, dinput_keys=dinput_keys)
    entity = EntityList(process, **pointer_details)
    player = Player(process, **pointer_details, dinput=dinput)
    inventory_slots = InventorySlots(process, **pointer_details)
    window_messages = WindowMessages(process=process, window_handle=window_handle, window_details=window_details,
                                     **pointer_details)
    return process, window_handle, player, entity, inventory_slots, window_messages, dinput

def run_scan_item_names(item_link_scanner, item_vids_file_path, item_vids_file_content, shops_data, scanner_attempts=7) -> None:
    logger = logging.getLogger("logger.{}".format("scan_item_names"))
    make_file_backup(item_vids_file_path)

    item_vids_to_scan = []
    for shop_data in shops_data:
        for item_vid, item_info in shop_data.items():
            if not isinstance(item_info, dict):
                continue
            item_vids_to_scan.append(int(item_vid))
    item_vids_to_scan = list(set(item_vids_to_scan))
    logger.info(f"Found {len(item_vids_to_scan)} items to scan")

    for attempt in range(scanner_attempts):
        try:
            item_link_scanner.prepare_preconditions()
            item_names = item_link_scanner.get_item_info_via_links(item_vids_to_scan)
            break
        except (ChatAddressFailedInScanner, PreparationFailed) as e:
            logger.debug(f"Scanning failed due to: {e}. Attempt: {attempt}")
            time.sleep(30)
    else:
        raise Exception("Failed to scan item names eventually")

    for item_vid, item_name in item_names.items():
        if item_vid in item_vids_file_content.keys() and item_vids_file_content[item_vid] != item_name:
            logger.warning(f"Item {item_vid} is already in file, actual name: {item_name}, supposedly scanned name: {item_vids_file_content[item_vid]}")
            item_vids_file_content[item_vid] = item_name
        elif item_vid not in item_vids_file_content.keys():
            logger.info("Adding scanned item {}: {}".format(item_vid, item_name))
            item_vids_file_content[item_vid] = item_name

    with open(item_vids_file_path, "w", encoding="utf-8") as json_file:
        json.dump(item_vids_file_content, json_file, ensure_ascii=False, indent=3)


def run_scraper(config: Dict[str, Any], scan_item_names=True, minimize_window=True, quit_after_run=False) -> int:
    """
    Generic function to run the scraper for a given server based on the configuration object.
    Returns the number of collected shops.
    """
    server_name = config["name"]
    logger = logging.getLogger(f"logger.{server_name}")
    logger.info(f"Starting scrapper for server: {server_name}")

    # --- Step 1: Environment Initialization ---
    pointers_dict, window_details, dinput_keys = get_needed_server_variables(server_name)
    if config.get("exe_path"):
        process, window_handle, player, entity, inventory_slots, window_messages, dinput = start_game_and_load_server_pointers(
            config["exe_path"],
            pointers_dict,
            window_details,
            dinput_keys,
            wait_after_game_start=config.get("wait_after_game_start", 7),
        )
    else:
        process, window_handle, player, entity, inventory_slots, window_messages, dinput = attach_to_game_and_load_server_pointers(
            pointers_dict,
            window_details,
            dinput_keys,
        )

    # --- Step 2: Ensure server-specific actions (if any) ---
    post_login_hook = config.get("post_login_hook")
    if post_login_hook:
        logger.info("Executing post-login hook...")
        post_login_hook(window_messages=window_messages, dinput=dinput)

    # --- Step 3: Initialize scraper and scanner classes ---
    ShopClass = config.get("shop_class", Shop)
    shop = ShopClass(process, **pointers_dict)

    ScannerClass = config["runner_class"]
    scanner = ScannerClass(
        process, shop, entity, player, dinput,
        config["shop_mobs_ids"],
        config["shop_grid_size"],
        config["items_vid_file"]
    )
    sessions_dir = Path(config.get("sessions_dir", PROJECT_ROOT / "market_data_pipeline" / "sessions"))
    sessions_dir.mkdir(parents=True, exist_ok=True)

    ScraperClass = config.get("scraper_class", ShopDataScraper)
    scraper = ScraperClass(
        **config["account_details"],
        window_messages=window_messages,
        player=player,
        dinput=dinput,
        shop_locations=config["shop_locations"],
        shop_scanner=scanner,
        end_location=config["end_location"],
        data_file_path=config["scrapper_data_path"],
        session_file_path=str(sessions_dir / f"{server_name}_session.json"),
    )

    # --- Step 4: Run main logic ---
    try:
        shops_data = scraper.run_shop_data_scrapper()
        if scan_item_names:
            if minimize_window:
                time.sleep(5)
                win32gui.ShowWindow(window_handle, win32con.SW_MINIMIZE)

            inv_slot_ids = config.get("item_link_scanner_inv_slots", [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 35])
            item_link_scanner = ItemLinkScanner(process, inv_slot_ids, window_messages, dinput, inventory_slots)

            item_vids_content = ScannerClass.get_item_names_vid_from_file(config["items_vid_file"])
            run_scan_item_names(
                item_link_scanner,
                config["items_vid_file"],
                item_vids_content,
                shops_data,
                scanner_attempts=config.get("item_name_scan_attempts", 7),
            )
        return len(shops_data)

    except Exception as e:
        logger.error(f"Error occurred during scraping from {server_name}: {e}", exc_info=True)
        return 0
    finally:
        if quit_after_run:
            logger.info(f"Quitting game on server {server_name}.")
            window_messages.send_string_to_window("\r/quit\r\r")


def click_button_post_login_hook(window_messages: WindowMessages, dinput: DINPUT, button_bytes_name: str):
    """Generic hook: click a named button in the game window after login."""
    logging.info("Executing post-login hook: clicking '%s'", button_bytes_name)
    button_addr = window_messages.get_window_address_from_bytes(button_bytes_name)
    x, y = window_messages.get_central_window_point(button_addr)
    import pydirectinput
    dinput.set_foreground_window_safe(window_messages.window_hwnd)
    pydirectinput.leftClick(x, y + 25)
    time.sleep(25)


def thread_wrapper(target_func: Callable, results_dict: Dict, server_name: str, *args, **kwargs):
    """
    Wrapper function that runs the target function (run_scraper) 
    and saves its result in the results dictionary.
    """
    try:
        result = target_func(*args, **kwargs)
        results_dict[server_name] = result
    except Exception as e:
        logging.getLogger(f"logger.{server_name}").error(f"Thread wrapper caught an unhandled exception: {e}", exc_info=True)
        results_dict[server_name] = -1 


def _resolve_runner_classes(server_name: str):
    module = importlib.import_module(f"servers.{server_name}.shop_scanner_runner")
    scanner_cls = getattr(module, "ServerShopScanner", None) or getattr(module, "", None)
    shop_cls = getattr(module, "ServerShop", None) or getattr(module, "", None) or Shop
    if scanner_cls is None:
        raise ImportError(f"Could not resolve scanner class in servers.{server_name}.shop_scanner_runner")
    return scanner_cls, shop_cls


def _normalize_server_configs(configs: list[dict[str, Any]], base_servers_path: Path) -> list[dict[str, Any]]:
    normalized = []
    for config in configs:
        server_name = config["name"]
        server_path = base_servers_path / server_name
        scanner_cls, shop_cls = _resolve_runner_classes(server_name)

        merged = dict(config)
        merged["runner_class"] = merged.get("runner_class", scanner_cls)
        merged["shop_class"] = merged.get("shop_class", shop_cls)
        merged["items_vid_file"] = merged.get("items_vid_file", str(server_path / "item_names.json"))
        merged["scrapper_data_path"] = merged.get("scrapper_data_path", str(server_path / "shop_data_scrapper_data"))
        merged.setdefault("shop_grid_size", 10 * 9)
        merged.setdefault("shop_mobs_ids", [30000 + i for i in range(10)])
        merged.setdefault("shop_locations", [f"/localization r {i}" for i in range(7)])
        merged.setdefault("end_location", "/localization r 7")
        normalized.append(merged)
    return normalized


def _load_configs_from_json(config_path: Path) -> list[dict[str, Any]]:
    with open(config_path, "r", encoding="utf-8") as file_obj:
        data = json.load(file_obj)
    if not isinstance(data, list):
        raise ValueError("Config file must contain a JSON list of server configs.")
    return data


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run multi-server shop scraping manager.")
    parser.add_argument("--config-file", default=None, help="Path to JSON list of server configs.")
    parser.add_argument("--servers-base-path", default=str(PROJECT_ROOT / "servers"), help="Base path containing server folders.")
    parser.add_argument("--workers", type=int, default=3, help="Maximum number of parallel scraping threads.")
    parser.add_argument("--thread-start-delay", type=int, default=23, help="Delay in seconds between thread starts.")
    parser.add_argument("--poll-interval", type=int, default=10, help="Polling interval in seconds for thread completion.")
    parser.add_argument("--scan-item-names", action="store_true", help="Enable item-name scan after shop scrape.")
    parser.add_argument("--no-minimize-window", action="store_true", help="Do not minimize game window before item-link scan.")
    parser.add_argument("--quit-after-run", action="store_true", help="Send /quit at the end of each server run.")
    parser.add_argument("--logs-path", default=str(PROJECT_ROOT / "logs"), help="Directory for manager logs.")
    return parser


def main():
    from logger.logger import init_logger

    args = _build_parser().parse_args()
    logger = init_logger(args.logs_path, "shop_scraper_manager", max_history_files=2, include_thread_name=True)

    if args.config_file:
        raw_configs = _load_configs_from_json(Path(args.config_file))
    else:
        logger.warning("No config file provided. Nothing to run.")
        raw_configs = []

    server_configs = _normalize_server_configs(raw_configs, Path(args.servers_base_path))
    enabled_configs = [cfg for cfg in server_configs if cfg.get("enabled", False)]

    scraper_kwargs = {
        "scan_item_names": args.scan_item_names,
        "minimize_window": not args.no_minimize_window,
        "quit_after_run": args.quit_after_run,
    }

    final_results = {}
    scraper_threads = [
        threading.Thread(
            name=f"{cfg['name'].capitalize()}Scanner",
            target=thread_wrapper,
            args=(run_scraper, final_results, cfg["name"], cfg),
            kwargs=scraper_kwargs,
        )
        for cfg in enabled_configs
    ]

    active_threads = []
    for _ in range(min(args.workers, len(scraper_threads))):
        thread = scraper_threads.pop(0)
        thread.start()
        logger.info("-> Thread started: %s", thread.name)
        time.sleep(args.thread_start_delay)
        active_threads.append(thread)

    while active_threads or scraper_threads:
        for thread in active_threads[:]:
            if not thread.is_alive():
                logger.info("-> Thread finished: %s", thread.name)
                active_threads.remove(thread)
                if scraper_threads:
                    next_thread = scraper_threads.pop(0)
                    next_thread.start()
                    logger.info("-> Thread started: %s", next_thread.name)
                    time.sleep(args.thread_start_delay)
                    active_threads.append(next_thread)
        time.sleep(args.poll_interval)

    logger.info("=" * 60)
    logger.info("All threads finished. Summary:")
    logger.info("=" * 60)
    for server_name, shop_count in sorted(final_results.items()):
        if shop_count > 0:
            logger.info("[V] %-20s: Collected data from %s shops.", server_name, shop_count)
        elif shop_count == 0:
            logger.warning("[-] %-20s: Finished but no new shops were collected.", server_name)
        else:
            logger.error("[X] %-20s: Error occurred during processing.", server_name)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()


