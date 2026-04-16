"""Data shaping helpers for merging and preparing marketplace scan outputs."""

import logging
import os
import re
from datetime import datetime, timedelta
from collections import defaultdict

import numpy


LOGGER = logging.getLogger(__name__)


def find_best_daily_files(directory: str, hour_offset: int = 6, start_date_str: str | None = None) -> list[str]:
    """
    Search the specified directory, group files by logical day with time offset, 
    and return the path to the largest file for each day.
    """
    daily_files = defaultdict(list)
    file_pattern = re.compile(r'.*?(\d{4}-\d{2}-\d{2}_\d{2}-\d{2})\.json')

    start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date() if start_date_str else None

    for filename in os.listdir(directory):
        match = file_pattern.match(filename)
        if match:
            full_path = os.path.join(directory, filename)
            datetime_str = match.group(1)
            file_dt = datetime.strptime(datetime_str, "%Y-%m-%d_%H-%M")

            logical_date = (file_dt - timedelta(hours=hour_offset)).date()

            if start_date and logical_date < start_date:
                continue

            daily_files[logical_date].append((os.path.getsize(full_path), full_path))

    best_files = [max(files, key=lambda item: item[0])[1] for files in daily_files.values()]
    return sorted(best_files)


def calculate_price_stats(prices_by_str_key: dict, price_multiplier: int = 1) -> dict:
    """
    Calculate price statistics (min, max, 10th and 20th percentiles, median, and amount).
    """
    if price_multiplier != 1:
        prices = {float(price) * price_multiplier: count for price, count in prices_by_str_key.items()}
    else:
        prices = {float(price): count for price, count in prices_by_str_key.items()}

    sorted_prices = dict(sorted(prices.items()))
    total_count = sum(sorted_prices.values())
    
    if total_count == 0:
        return {"min": None, "max": None, "q10": None, "q20": None, "median": None, "amount": 0}

    thresholds = {
        "q10": total_count * 0.10,
        "q20": total_count * 0.20,
        "median": total_count * 0.50,
    }

    min_price = next(iter(sorted_prices))
    max_price = next(reversed(sorted_prices))

    cumulative = 0
    result = {"q10": None, "q20": None, "median": None}

    for price, count in sorted_prices.items():
        cumulative += count
        for key in ["q10", "q20", "median"]:
            if result[key] is None and cumulative >= thresholds[key]:
                result[key] = price
        if all(v is not None for v in result.values()):
            break

    return {
        "min": min_price,
        "max": max_price,
        **result,
        "amount": total_count,
    }


def extract_bonuses(offsets, start_offset, bonus_name_map, skip_ids=None, jump_offset=3):
    """
    Extract bonuses from offsets starting from start_offset. 
    Returns dict of bonus_name -> value/list of values and a warning flag if bonus name repeats.
    """
    skip_ids = skip_ids or []
    bonuses = {}
    warning_flag = False
    offset_key = lambda off: f"+{off}"
    current_offset = start_offset

    while offset_key(current_offset) in offsets:
        bonus_id = offsets[offset_key(current_offset)]
        val1 = offsets.get(offset_key(current_offset + 1), 0)
        val2 = offsets.get(offset_key(current_offset + 2), 0)

        if val2 == 255:
            bonus_value = val1 - 256
        else:
            bonus_value = (val2 << 8) | val1

        try:
            bonus_name = bonus_name_map[str(bonus_id)]
        except KeyError:
            if bonus_id not in skip_ids:
                raise KeyError(f"Bonus ID not found: {bonus_id}, value: {bonus_value}")
            else:
                LOGGER.info("Skipped unknown bonus ID: %s", bonus_id)
                break

        if bonus_name in bonuses:
            if isinstance(bonuses[bonus_name], list):
                bonuses[bonus_name].append(bonus_value)
            else:
                bonuses[bonus_name] = [bonuses[bonus_name], bonus_value]
            warning_flag = True
        else:
            bonuses[bonus_name] = bonus_value

        current_offset += jump_offset

        if start_offset <= current_offset < start_offset + 10:
            if offset_key(current_offset) not in offsets and offset_key(current_offset + jump_offset) in offsets:
                current_offset += jump_offset

    return bonuses, warning_flag


def merge_shop_items(shops_data, item_names_map, price_multiplier: int = 1):
    """
    Merge items from multiple shops.
    """
    merged = {}
    items_per_shop = []
    shop_names = []

    for shop in shops_data:
        items_per_shop.append(len(shop))
        if shop.get("shop_name"):
            shop_names.append(shop["shop_name"])

        for item_vid, item_info in shop.items():
            if not isinstance(item_info, dict):
                continue

            try:
                item_name = item_names_map.get(item_vid, {}).get("name", "UNKNOWN_ITEM")
            except TypeError:
                item_name = "UNKNOWN_ITEM"

            if item_name is None:
                raise ValueError(f"Failed to get item name (vid: {item_vid}).")

            prices = item_info.get("prices", {})
            examples = item_info.get("examples", [])

            if item_name not in merged:
                merged[item_name] = {"prices": {}, "examples": []}

            for price, count in prices.items():
                merged[item_name]["prices"][price] = merged[item_name]["prices"].get(price, 0) + count

            if examples:
                merged[item_name]["examples"].extend(examples)

            merged[item_name]["vid"] = item_vid
            merged[item_name]["shop_appearance"] = merged[item_name].get("shop_appearance", 0) + 1

    for name, info in list(merged.items()):
        if not info["examples"]:
            del info["examples"]

    merged["median_unique_items_per_shop"] = numpy.median(items_per_shop) if items_per_shop else 0
    merged["shop_names"] = shop_names
    merged["total_shops"] = len(shops_data)
    return merged


def make_bonus_key(bonuses):
    items = []
    for k, v in bonuses.items():
        if isinstance(v, list):
            items.append((k, tuple(v))) 
        else:
            items.append((k, v))
    return frozenset(items)


def merge_bonus_items(bonus_items):
    total_items = 0
    for item_name, item_data in bonus_items.items():
        new_examples = {}
        for entry in item_data["examples"]:
            total_items += 1
            bonuses = entry["bonuses"]
            price = entry["price"]

            bonus_key = make_bonus_key(bonuses)

            if bonus_key not in new_examples:
                new_examples[bonus_key] = {
                    "bonuses": bonuses,
                    "prices": {price: 1}
                }
            else:
                if price in new_examples[bonus_key]["prices"]:
                    new_examples[bonus_key]["prices"][price] += 1
                else:
                    new_examples[bonus_key]["prices"][price] = 1

        bonus_items[item_name]["examples"] = list(new_examples.values())

    return bonus_items, total_items


def count_simple_items(simple_items):
    return sum(item_info["amount"] for item_info in simple_items.values())


def prepare_items_data(merged_data, bonus_name_map, skip_names=None, skip_bonuses=None, bonus_start_offset=50,
                       handle_unknown_items_fn=None, jump_offset=3, price_multiplier: int = 1):
    """
    Prepare final data by categorizing items into simple, bonus, and unknown items.
    """
    skip_names = set(skip_names or [])
    skip_bonuses = set(skip_bonuses or [])
    items_with_warning = []

    prepared = {
        "simple_items": {},
        "bonus_items": {},
        "unknown_items": []
    }

    for item_name, info in merged_data.items():
        if item_name in skip_names or not isinstance(info, dict):
            continue

        base_item = {"vid": info.get("vid"), "shop_appearance": info.get("shop_appearance")}
        examples = info.get("examples")

        if examples:
            bonus_examples = []
            unknown_examples = []

            for example in examples:
                bonuses, warning = extract_bonuses(example["offsets"], bonus_start_offset, bonus_name_map,
                                                   skip_bonuses, jump_offset=jump_offset)
                if bonuses:
                    scaled_price = str(int(float(example["price"]) * price_multiplier))
                    bonus_examples.append({"bonuses": bonuses, "price": scaled_price})
                else:
                    unknown_examples.append(example)

                if warning:
                    items_with_warning.append(item_name)

            if unknown_examples:
                recovered_bonuses = None
                if handle_unknown_items_fn:
                    recovered_bonuses = handle_unknown_items_fn(item_name, unknown_examples, bonus_name_map)

                if recovered_bonuses:
                    prepared["bonus_items"][item_name] = {**base_item, "examples": recovered_bonuses}
                else:
                    prepared["unknown_items"].append(item_name)
                    prepared["simple_items"][item_name] = {**base_item, **calculate_price_stats(info.get("prices", {}), price_multiplier)}
            
            if bonus_examples:
                prepared["bonus_items"][item_name] = {**base_item, "examples": bonus_examples}
        else:
            prepared["simple_items"][item_name] = {**base_item, **calculate_price_stats(info.get("prices", {}), price_multiplier)}

    merged_bonus_items, total_bonus_items = merge_bonus_items(prepared["bonus_items"])
    prepared["bonus_items"] = merged_bonus_items
    prepared["bonus_items_amount"] = total_bonus_items
    prepared["unique_bonus_items_amount"] = len(prepared["bonus_items"])
    prepared["simple_items_amount"] = count_simple_items(prepared["simple_items"])
    prepared["unique_simple_items_amount"] = len(prepared["simple_items"])
    prepared["median_unique_items_per_shop"] = merged_data.get("median_unique_items_per_shop", 0)
    prepared["shop_names"] = merged_data.get("shop_names", [])
    prepared["total_shops"] = merged_data.get("total_shops", 0)

    return prepared, items_with_warning
