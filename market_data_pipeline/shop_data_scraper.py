"""Runtime scraper that logs in, teleports through locations, and collects shop data."""

import subprocess
import time
import os
import win32gui
import win32process
import win32con
import pymem
import json
import logging
from datetime import datetime
from memory.pointers.window_messages import WindowMessages
from memory.pointers.player import Player
from memory.pointers.dinput import DINPUT

class ShopDataScraper:

    def __init__(self, username: str, password: str, pin: str, window_messages: WindowMessages, player: Player,
                 dinput: DINPUT, shop_scanner, shop_locations: list, end_location: str = None, data_file_path: str = None,
                 session_data: dict = None, session_file_path: str = None):
        self.username = username
        self.password = password
        self.pin = pin
        self.window_messages = window_messages
        self.player = player
        self.dinput = dinput
        self.shop_locations = shop_locations
        self.end_location = end_location
        self.data_file_path = data_file_path
        self.shop_scanner = shop_scanner
        self.session_file_path = session_file_path

        self.scanned_shop_names = set()
        self.accumulated_shop_data = []

        self.logger = logging.getLogger("logger.{}".format(self.__class__.__name__))

    def run_preconditions(self):
        if self.session_file_path and os.path.exists(self.session_file_path):
            try:
                with open(self.session_file_path, 'r', encoding='utf-8') as f:
                    state = json.load(f)
                    self.accumulated_shop_data = state.get('accumulated_shop_data', [])
                    self.scanned_shop_names = set(state.get('scanned_shop_names', []))
                    self.logger.info(f"Session resumed. Loaded {len(self.accumulated_shop_data)} shops and {len(self.scanned_shop_names)} unique names.")
            except (json.JSONDecodeError, IOError) as e:
                self.logger.warning(f"Failed to load session file {self.session_file_path}, starting from scratch. Error: {e}")

        self.login_to_account()
        time.sleep(8)
        self.select_character_and_wait_until_loaded()
        time.sleep(4)

    def run_shop_data_scrapper(self):
        self.run_preconditions()
        self.teleport_to_shop_locations_and_get_shop_data()
        self.run_postconditions()
        return self.accumulated_shop_data

    def run_postconditions(self):
        if self.end_location is not None:
            time.sleep(10)  # Waiting for teleportation possibility after closing shop
            self.window_messages.send_string_to_window("\r{}\r\r".format(self.end_location))
            time.sleep(2)
            self.player.wait_until_player_appear()
        if self.data_file_path is not None:
            file_name = datetime.now().strftime("shop_data_scrapper_%Y-%m-%d_%H-%M.json")
            full_file_path = os.path.join(self.data_file_path, file_name)
            with open(full_file_path, "w", encoding="utf-8") as json_file:
                json.dump(self.accumulated_shop_data, json_file, ensure_ascii=False, indent=3)
        
        if self.session_file_path and os.path.exists(self.session_file_path):
            os.remove(self.session_file_path)
            self.logger.info(f"Scanning finished successfully. Session file removed: {self.session_file_path}")

    def teleport_to_shop_locations_and_get_shop_data(self):
        all_shops = []
        for shop_location in self.shop_locations:
            self.window_messages.send_string_to_window("\r{}\r\r".format(shop_location))
            self.player.wait_until_player_appear()
            time.sleep(10)  # Waiting for shops to load

            shop_entities = self.shop_scanner.get_shop_entities()
            time.sleep(3)
            while True:
                shop_entities_temp = self.shop_scanner.get_shop_entities()
                if len(shop_entities) >= len(shop_entities_temp):
                    break
                shop_entities = shop_entities_temp[:]
                time.sleep(3)

            all_shops_vid = [shop_ent.vid for shop_ent in all_shops]
            new_shops = []
            for shop_ent in shop_entities:
                if shop_ent.vid not in all_shops_vid:
                    new_shops.append(shop_ent)

            if len(new_shops) == 0:
                continue
            player_pos = self.player.get_player_pos()

            batch_size = 100
            for i in range(0, len(new_shops), batch_size):
                original_batch = new_shops[i:i + batch_size]

                shop_batch = [shop for shop in original_batch if shop.try_to_get_entity_name() not in self.scanned_shop_names]
                
                skipped_count = len(original_batch) - len(shop_batch)
                if skipped_count > 0:
                    self.logger.info(f"Skipped {skipped_count} shops already present in session.")

                if not shop_batch:
                    continue

                for shop_ent in shop_batch:
                    self.shop_scanner.teleport_shop_to_cords(shop_ent, *player_pos)

                shop_data = self.shop_scanner.get_all_data_from_shops(shops_entities=shop_batch)

                for shop_ent in shop_batch:
                    self.shop_scanner.teleport_shop_to_cords(shop_ent, x=-1, y=-1, z=-1)

                self.accumulated_shop_data.extend(shop_data)
                newly_scanned_names = {s.get("shop_name") for s in shop_data if s.get("shop_name")}
                self.scanned_shop_names.update(newly_scanned_names)
                self._save_session_state()

            all_shops.extend(new_shops)
            time.sleep(10)  # Waiting for teleportation possibility

        self.logger.info("Finished all locations. Total collected data from {} shops.".format(len(self.accumulated_shop_data)))
        return self.accumulated_shop_data

    def select_character_and_wait_until_loaded(self):
        while self.player.check_if_player_disappear() is True:
            self.dinput.press_and_release_keys("enter")
            time.sleep(3)

    def login_to_account(self):
        for i in range(5):
            self.window_messages.send_backspace_to_window()
        self.window_messages.send_string_to_window(self.username)
        self.window_messages.send_enter_to_window()
        self.window_messages.send_string_to_window(self.password)
        self.window_messages.send_enter_to_window()
        if self.pin:
            self.window_messages.send_string_to_window(self.pin)
            self.window_messages.send_enter_to_window()

    def _save_session_state(self):
        if not self.session_file_path:
            return

        state = {
            "accumulated_shop_data": self.accumulated_shop_data,
            "scanned_shop_names": list(self.scanned_shop_names)
        }
        try:
            with open(self.session_file_path, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=4)
            self.logger.info(f"Session state saved. Current shop count: {len(self.accumulated_shop_data)}")
        except IOError as e:
            self.logger.error(f"Failed to save session state: {e}")

    @staticmethod
    def _get_hwnd_for_pid(pid: int, timeout: int = 35) -> int:
        start_time = time.time()
        while time.time() - start_time < timeout:
            def callback(hwnd, hwnds):
                if win32gui.IsWindowVisible(hwnd) and win32gui.IsWindowEnabled(hwnd):
                    _, found_pid = win32process.GetWindowThreadProcessId(hwnd)
                    if found_pid == pid:
                        if win32gui.GetWindowText(hwnd):
                            hwnds.append(hwnd)
                return True

            hwnds = []
            win32gui.EnumWindows(callback, hwnds)
            if hwnds:
                return hwnds[0]
            time.sleep(0.25)
        raise TimeoutError(f"Window handle (HWND) for PID {pid} not found within {timeout}s.")

    @staticmethod
    def start_game(game_exe_path: str):
        logger = logging.getLogger("logger.ShopDataScraper.start_game")
        actual_cwd = os.getcwd()
        game_dir = os.path.dirname(game_exe_path)

        try:
            os.chdir(game_dir)
            logger.info(f"Starting process from: {game_exe_path}")
            process = subprocess.Popen(game_exe_path)
            pid = process.pid
            logger.info(f"Process started with PID: {pid}. Waiting for window handle...")

            hwnd = ShopDataScraper._get_hwnd_for_pid(pid)
            logger.info(f"Found window handle (HWND): {hwnd}. Trying to set window on top.")
            
            try:
                win32gui.SetWindowPos(hwnd, win32con.HWND_TOP, 0, 0, 0, 0, win32con.SWP_NOSIZE)
                logger.info("Successfully set window on top.")
            except Exception as e:
                logger.warning(f"Failed to set window on top: {e}", exc_info=True)

            process = pymem.Pymem(pid)
            return process, hwnd
        finally:
            os.chdir(actual_cwd)
