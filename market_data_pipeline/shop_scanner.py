"""Core scanner abstractions for reading in-game shop inventories."""

import time
import random
import pymem
import logging
import json
from memory.pointers.shop import Shop
from memory.pointers.player import Player
from memory.pointers.entity_list import EntityList
from memory.pointers.dinput import DINPUT
from abc import ABC, abstractmethod
from pymem.exception import MemoryReadError


class ShopScanner(ABC):

    def __init__(self, process: pymem.Pymem, shop: Shop, entity: EntityList, player: Player, dinput: DINPUT,
                 shop_mob_ids: list, shop_slot_amount: int, item_names_vid_file: str = None,
                 bonus_ids_file: str = None, shop_name_keyword: str | None = None):
        self.process = process
        self.shop = shop
        self.entity = entity
        self.player = player
        self.dinput = dinput
        self.shop_mob_ids = shop_mob_ids
        self.shop_slot_amount = shop_slot_amount
        self.shops_data = {}
        self.item_names_vid = self.get_item_names_vid_from_file(item_names_vid_file) if item_names_vid_file else {}
        self.bonus_ids = self.get_bonus_ids_from_file(bonus_ids_file) if bonus_ids_file is not None else {}
        self.shop_name_keyword = shop_name_keyword or "Sklep"

        self._not_found_item_names = 0
        self.logger = logging.getLogger("logger.{}".format(self.__class__.__name__))

    @staticmethod
    @abstractmethod
    def get_item_names_vid_from_file(file_path):
        pass

    @staticmethod
    def get_bonus_ids_from_file(file_path):
        return {}

    def get_bonuses_for_item(self, offsets, **kwargs):
        pass

    def get_shop_entities(self):
        filter_offsets = [{"id": mob_id} for mob_id in self.shop_mob_ids]
        return self.entity.get_filtered_entities(filter_offsets=filter_offsets, ent_amt=15000)

    def get_player_nearby_shop_entities(self, max_distance):
        shop_entities = self.get_shop_entities()
        player_pos = self.player.get_player_pos()
        return self.entity.filter_entities_by_distance(*player_pos, shop_entities, max_distance)

    def close_shop(self, retries=10):
        for _ in range(retries):
            self.dinput.press_and_release_keys("esc")
            time.sleep(0.2)
            if self.shop.check_shop_status("closed") is True:
                return
        else:
            raise Exception("Failed to close shop.")

    def open_shop(self, shop_vid, retries=13):
        for _ in range(retries):
            self.player.send_talk_to_vid(shop_vid, sleep=False)
            time.sleep(0.23)
            if self.shop.check_shop_status("open") is True:
                return None
        else:
            return False

    @staticmethod
    def teleport_shop_to_cords(shop_entity, x, y, z=None):
        shop_entity.x = x
        shop_entity.y = y
        if z is not None:
            shop_entity.z = z

    def scan_for_maximum_number_of_shops(self):
        unique_vids = []
        while True:
            user_input = input("Type 'scan' to scan or 'break' to quit \n")
            if user_input == "scan":
                shops = self.get_shop_entities()
                for shop in shops:
                    if shop.vid not in unique_vids:
                        unique_vids.append(shop.vid)
                print("Unique shops: {}".format(len(unique_vids)))
            elif user_input == "break":
                break
        return len(unique_vids)

    def teleport_shops_to_player_loop(self):
        while True:
            user_input = input("Type 'tp' or 'break' \n")
            if user_input == "tp":
                shop_entities = self.get_shop_entities()
                player_pos = self.player.get_player_pos()
                for shop in shop_entities:
                    self.teleport_shop_to_cords(shop, *player_pos)
                print("Number of nearby shops: {}".format(len(self.get_player_nearby_shop_entities(5))))
            elif user_input == "break":
                break

    def get_all_items_info_from_open_shop(self):
        shop_info = {}
        slots_data = {}
        for slot_id in range(1, self.shop_slot_amount + 1):
            base_info = self.shop.get_item_info_for_slot_id(slot_id)
            if base_info is None:
                continue
            vid, single_price, amount, item_type = base_info
            slots_data[slot_id] = {"vid": vid, "single_price": single_price, "amount": amount}

            bonus_offsets_info = self.shop.get_bonus_offsets_info_for_slot_id(slot_id)
            item_name = self.item_names_vid.get(vid, None)

            if item_name is None:
                self._not_found_item_names += 1

            try:
                try:
                    shop_info[vid]["prices"][single_price] += amount
                except KeyError:
                    shop_info[vid]["prices"][single_price] = amount
            except KeyError:
                shop_info[vid] = {"prices": {single_price: amount}, "item_type": item_type, "name": item_name}

            if len(bonus_offsets_info) > 1:
                bonus_dict = {"offsets": bonus_offsets_info, "price": single_price}
                try:
                    shop_info[vid]["examples"].append(bonus_dict)
                except KeyError:
                    shop_info[vid]["examples"] = [bonus_dict]

        return shop_info, slots_data

    def renew_shop_vid(self, shop_entity):
        try:
            actual_shop_vid = shop_entity.get_offset_value("vid")
            if shop_entity.vid != actual_shop_vid:
                mob_id = shop_entity.get_offset_value("id")
                if mob_id not in self.shop_mob_ids:
                    return None
        except MemoryReadError:
            return None
        return actual_shop_vid

    def teleport_shops_to_player_and_get_data(self):
        full_shop_data = []
        while True:
            self.scan_for_maximum_number_of_shops()
            self.teleport_shops_to_player_loop()
            shop_entities = self.get_player_nearby_shop_entities(max_distance=5)
            full_shop_data.extend(self.get_all_data_from_shops(shops_entities=shop_entities))
            if input("Type 'quit' to leave or any key to continue \n") == "quit":
                break
        return full_shop_data

    @staticmethod
    def get_unknown_items_vid_from_shops_data(shops_data):
        unknown_items_vid = []
        for shop_data in shops_data:
            for item_vid, item_info in shop_data.items():
                if not isinstance(item_info, dict):
                    continue
                if item_info.get("name", None) is None:
                    unknown_items_vid.append(int(item_vid))
        return unknown_items_vid

    def get_all_data_from_shops(self, shops_entities):
        shops_info = []
        failed_to_open = 0
        not_found_shop_names = []
        self._not_found_item_names = 0

        start_time = time.monotonic()
        for itt, shop in enumerate(shops_entities):
            iteration_start = time.monotonic()
            
            actual_shop_vid = self.renew_shop_vid(shop_entity=shop)
            if actual_shop_vid is None:
                continue
            result = self.open_shop(shop.vid)
            if result is False:
                failed_to_open += 1
                continue
            shop_info, _ = self.get_all_items_info_from_open_shop()
            self.close_shop()
            shop_name = shop.try_to_get_entity_name()
            try:
                if self.shop_name_keyword and self.shop_name_keyword not in shop_name:
                    not_found_shop_names.append(shop_name)
            except TypeError:
                continue
            shops_info.append({**shop_info, "vid": actual_shop_vid, "shop_name": shop_name})

            iteration_time = time.monotonic() - iteration_start
            sleep_time = 0.73 - iteration_time
            if sleep_time > 0:
                time.sleep(sleep_time)  # cooldown for clicking next shop

        loop_time = time.monotonic() - start_time
        iteration_time = loop_time / len(shops_entities) if len(shops_entities) > 0 else 0
        self.logger.info(f"Data loop for {len(shops_entities)} shops took {loop_time:.2f}s, average iteration time: {iteration_time:.2f}s, failed to open: {failed_to_open} shops, item names not found: {self._not_found_item_names}")
        if len(not_found_shop_names) > 0:
            self.logger.info(f"Shop names not found: {not_found_shop_names}")
        return shops_info

