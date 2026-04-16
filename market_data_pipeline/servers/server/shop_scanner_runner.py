import argparse
import importlib
import json
import sys
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from memory.pointers.shop import Shop
from market_data_pipeline.shop_scanner import ShopScanner


class ServerShop(Shop):
    def get_price_for_slot_id(self, slot_id):
        return self.get_offset_value_for_slot_id("price_yang", slot_id) + (
            self.get_offset_value_for_slot_id("price_won", slot_id) * 1_000_000_000
        )


class ServerShopScanner(ShopScanner):
    @staticmethod
    def get_item_names_vid_from_file(file_path):
        with open(file_path, "r", encoding="utf-8") as json_file:
            data = json.load(json_file)
        return {int(k): v for k, v in data.items()}

    @staticmethod
    def get_bonus_ids_from_file(_file_path):
        return {}


def _build_parser():
    parser = argparse.ArgumentParser(description="Run shop scanner for a selected server.")
    parser.add_argument("--server", default="server", help="Server module name in servers/<name>.")
    parser.add_argument("--item-vids-file", default=None, help="Path to item_names.json.")
    parser.add_argument("--shop-mob-ids", default="30000,30001,30002", help="Comma separated mob IDs.")
    parser.add_argument("--output-dir", default="./shop_scanner_data", help="Output folder for scan results.")
    return parser


def main():
    from logger.logger import init_logger
    from memory.base_pointers import BasePointers
    from memory.pointers.dinput import DINPUT
    from memory.pointers.entity_list import EntityList
    from memory.pointers.player import Player

    args = _build_parser().parse_args()
    variables = importlib.import_module(f"servers.{args.server}.variables")

    shop_scanner_pointers = {
        "player_pointer": variables.PLAYER_POINTER,
        "window_input_pointer": variables.WINDOW_INPUT,
        "entity_pointer": variables.ENTITY_POINTER,
        "player_control_pointer": variables.PLAYER_CONTROL,
        "shop_pointer": variables.SHOP,
    }

    logs_path = PROJECT_ROOT / "logs"
    logger = init_logger(str(logs_path), f"{args.server}_shop_scanner", max_history_files=2)

    process, window_hwnd = BasePointers.get_window_handle_and_pid()
    BasePointers(process, window_hwnd).initialize_pointers(shop_scanner_pointers)

    dinput = DINPUT(process, dinput_keys=variables.DINPUT_KEYS, **shop_scanner_pointers)
    entity = EntityList(process, **shop_scanner_pointers)
    player = Player(process, **shop_scanner_pointers)
    shop = ServerShop(process, **shop_scanner_pointers)

    item_vids_file = Path(args.item_vids_file) if args.item_vids_file else (PROJECT_ROOT / "servers" / args.server / "item_names.json")
    mob_ids = [int(value.strip()) for value in args.shop_mob_ids.split(",") if value.strip()]
    scanner = ServerShopScanner(process, shop, entity, player, dinput, mob_ids, 10 * 9, str(item_vids_file))

    shops_data = scanner.teleport_shops_to_player_and_get_data()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_name = datetime.now().strftime(f"shop_data_{args.server}_%Y-%m-%d_%H-%M.json")
    output_path = output_dir / output_name
    with open(output_path, "w", encoding="utf-8") as json_file:
        json.dump(shops_data, json_file, ensure_ascii=False, indent=3)

    logger.info("Shop scan finished. Saved data to: %s", output_path)


if __name__ == "__main__":
    main()


