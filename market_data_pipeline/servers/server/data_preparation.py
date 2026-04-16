import argparse
import json
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from market_data_pipeline.market_data_transform import find_best_daily_files, merge_shop_items, prepare_items_data


def _build_parser():
    parser = argparse.ArgumentParser(description="Prepare merged shop data files for a selected server.")
    parser.add_argument("--server", default="server", help="Server name in servers/<name>.")
    parser.add_argument("--shop-data-dir", default=None, help="Directory with raw shop_data_*.json files.")
    parser.add_argument("--item-names-file", default=None, help="Path to item_names.json.")
    parser.add_argument("--bonus-ids-file", default=None, help="Path to bonus_ids.json.")
    parser.add_argument("--output-dir", default=None, help="Output directory for prepared_data_*.json.")
    parser.add_argument("--start-date", default=None, help="Optional filter start date, format YYYY-MM-DD.")
    parser.add_argument("--hour-offset", type=int, default=6, help="Hour offset used by find_best_daily_files.")
    return parser


def main():
    args = _build_parser().parse_args()

    server_dir = PROJECT_ROOT / "servers" / args.server
    shop_data_directory = Path(args.shop_data_dir) if args.shop_data_dir else (server_dir / "shop_data_scrapper_data")
    item_names_file_path = Path(args.item_names_file) if args.item_names_file else (server_dir / "item_names.json")
    bonus_names_file_path = Path(args.bonus_ids_file) if args.bonus_ids_file else (server_dir / "bonus_ids.json")
    save_file_path = Path(args.output_dir) if args.output_dir else (server_dir / "prepared_data")
    save_file_path.mkdir(parents=True, exist_ok=True)

    files_to_prepare = find_best_daily_files(
        str(shop_data_directory),
        hour_offset=args.hour_offset,
        start_date_str=args.start_date,
    )

    print("Selected files to prepare:")
    for file_path in files_to_prepare:
        print(file_path)

    with open(item_names_file_path, "r", encoding="utf-8") as file_obj:
        item_names = json.load(file_obj)
    with open(bonus_names_file_path, "r", encoding="utf-8") as file_obj:
        bonus_names_dict = json.load(file_obj)

    skip_item_names = []
    skip_bonus_ids = []
    bonus_start_offset = 12

    for data_file_path in files_to_prepare:
        print("Preparing:", data_file_path)
        with open(data_file_path, "r", encoding="utf-8") as file_obj:
            data = json.load(file_obj)

        merged_items_data = merge_shop_items(data, item_names)
        prepared, items_with_warning = prepare_items_data(
            merged_items_data,
            bonus_names_dict,
            bonus_start_offset=bonus_start_offset,
            skip_names=skip_item_names,
            skip_bonuses=skip_bonus_ids,
        )
        prepared["created_from"] = str(data_file_path)

        print("Unknown items:\n", " ||| ".join(prepared["unknown_items"]))
        print("Items with warnings:\n", " ||| ".join(set(items_with_warning)))

        match = re.search(r"(\d{4}-\d{2}-\d{2}_\d{2}-\d{2})", str(data_file_path))
        if not match:
            raise ValueError(f"Cannot extract timestamp from file name: {data_file_path}")

        datetime_str = match.group(1)
        output_path = save_file_path / f"prepared_data_{datetime_str}.json"
        with open(output_path, "w", encoding="utf-8") as file_obj:
            json.dump(prepared, file_obj, ensure_ascii=False, indent=3)


if __name__ == "__main__":
    main()
