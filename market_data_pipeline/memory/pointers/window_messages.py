import time
import random
import math
import pymem
import win32api
import win32gui
import win32con
import threading
import logging
from .pointer import Pointer
from memory.base_pointers import BasePointers


class WindowMessages:
    _lock = threading.Lock()

    def __init__(self, process, window_focus_pointer=None, window_handle=None, window_details=None, **kwargs):
        self.process = process
        self.window_pointer = Pointer(self.process, window_focus_pointer, "window_focus_pointer") \
            if window_focus_pointer else None
        self.window_details = window_details
        self.window_hwnd = window_handle or BasePointers(self.process).window_hwnd

        self._lock = threading.Lock()
        self.logger = logging.getLogger("logger.{}".format(self.__class__.__name__))

    def set_cursor_pos(self, x, y):
        self.window_pointer.set_address_value_for_offset_name("cursor_x", x)
        self.window_pointer.set_address_value_for_offset_name("cursor_y", y)

    def set_window_focus(self, focus_value):
        self.window_pointer.set_address_value_for_offset_name("focus", focus_value)

    def set_click_for_window_focus(self, click, focus_value):
        self.window_pointer.set_address_value_for_offset_name(click, focus_value)

    def check_focus_value(self, window_address, window_name):
        if self.process.read_string(window_address + 0x4, len(window_name)) == window_name:
            return True
        return False

    def get_window_size(self, window_address):
        if self.window_details is None:
            return None
        x1 = self.process.read_int(window_address + self.window_details["x1"])
        x2 = self.process.read_int(window_address + self.window_details["x2"])
        y1 = self.process.read_int(window_address + self.window_details["y1"])
        y2 = self.process.read_int(window_address + self.window_details["y2"])
        return x1, x2, y1, y2

    def get_central_window_point(self, window_address):
        x1, x2, y1, y2 = self.get_window_size(window_address)
        half_window_width = (x2 - x1) // 2
        half_window_height = (y2 - y1) // 2
        return x1 + half_window_width, y1 + half_window_height

    def click_on_central_window_point(self, window_address, key="left"):
        self.mouse_click(*self.get_central_window_point(window_address), window_address=window_address, key=key)

    @staticmethod
    def get_single_inventory_cell_size(x1, x2, y1, y2, inventory_x_size=5, inventory_y_size=9):
        return round(abs(x2 - x1) / inventory_x_size), round(abs(y2 - y1) / inventory_y_size)

    def get_inventory_slot_pos(self, slot_id, window_address, inventory_x_size=5, inventory_y_size=9):
        x1, x2, y1, y2 = self.get_window_size(window_address)
        cell_w, cell_h = self.get_single_inventory_cell_size(x1, x2, y1, y2, inventory_x_size, inventory_y_size)
        slot_x = slot_id % inventory_x_size or inventory_x_size
        slot_y = math.ceil(slot_id / inventory_x_size)
        cell_x2 = x1 + (cell_w * slot_x)
        cell_y2 = y1 + (cell_h * slot_y)
        return cell_x2 - cell_w, cell_x2, cell_y2 - cell_h, cell_y2

    def get_inventory_slot_center_point(self, slot_id, window_address, inventory_x_size=5, inventory_y_size=9):
        cell_x1, cell_x2, cell_y1, cell_y2 = self.get_inventory_slot_pos(slot_id, window_address,
                                                                         inventory_x_size, inventory_y_size)
        cell_width, cell_height = cell_x2 - cell_x1, cell_y2 - cell_y1
        return cell_x2 - cell_width // 2, cell_y2 - cell_height // 2

    def get_last_left_click_pos(self):
        return (self.window_pointer.get_address_value_for_offset_name("last_left_click_x"),
                self.window_pointer.get_address_value_for_offset_name("last_left_click_y"))

    def get_window_address_from_bytes(self, window_name):
        window_entry = self.window_details[window_name]
        window_bytes = window_entry["bytes"]
        conditions = window_entry.get("conditions", {})
        offset = window_entry["offset"]

        addresses = pymem.pattern.pattern_scan_all(
            self.process.process_handle,
            window_bytes,
            return_multiple=True
        )

        if len(addresses) == 1:
            return addresses[0] - offset
        elif len(addresses) == 0:
            return None

        hex_found_addresses = ", ".join(map(hex, addresses))
        self.logger.warning(
            f"Not found only 1 address for window '{window_name}': {hex_found_addresses}. Trying to check conditions."
        )

        if not conditions:
            return None

        valid_addresses = []
        for address in addresses:
            try:
                for byte_offset, condition in conditions.items():
                    val = self.process.read_bytes(address + byte_offset, 1)[0]
                    if callable(condition) and not condition(val):
                        raise ValueError
                valid_addresses.append(address)
            except ValueError as e:
                self.logger.debug(f"Condition check failed at address {hex(address)}: {e}")
                continue

        if len(valid_addresses) == 1:
            return valid_addresses[0] - offset

        self.logger.error(f"No valid address found for window '{window_name}' after applying conditions.")
        return None

    def get_inventory_window_address(self):
        if self.window_details is None or "inventory_window" not in self.window_details.keys():
            return None
        return self.get_window_address_from_bytes("inventory_window")

    def click_on_inventory_slot(self, slot_id, inventory_window_address=None, key="right", inventory_x_size=5,
                                inventory_y_size=9):
        inventory_window_address = inventory_window_address or self.get_inventory_window_address()
        self.mouse_click(*self.get_inventory_slot_center_point(slot_id, inventory_window_address, inventory_x_size,
                                                               inventory_y_size), inventory_window_address, key)

    def mouse_click(self, x, y, window_address, key="right"):
        l_param = win32api.MAKELONG(int(x), int(y))
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_NCHITTEST, 0x0, l_param)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_NCHITTEST, 0x0, l_param)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_NCHITTEST, 1, l_param)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_NCHITTEST, 1, l_param)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        # self.set_cursor_pos(int(x), int(y))
        # self.set_window_focus(window_address)
        # self.set_cursor_pos(int(x), int(y))
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        if key == "right":
            self.set_click_for_window_focus("right_click", window_address)
            self.set_window_focus(window_address)
            win32api.PostMessage(self.window_hwnd, win32con.WM_RBUTTONDOWN, 1, l_param)
        elif key == "left":
            self.set_click_for_window_focus("left_click", window_address)
            self.set_window_focus(window_address)
            win32api.PostMessage(self.window_hwnd, win32con.WM_LBUTTONDOWN, 1, l_param)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        self.set_window_focus(window_address)
        self.set_cursor_pos(int(x), int(y))
        win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        self.set_window_focus(window_address)
        self.set_cursor_pos(int(x), int(y))
        time.sleep(0.015)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        # win32api.PostMessage(self.window_hwnd, win32con.WM_MOUSEMOVE, 1, l_param)
        # win32gui.SendMessage(self.window_hwnd, win32con.WM_SETCURSOR, 1, l_param)
        #
        # time.sleep(0.1)
        if key == "right":
            win32api.PostMessage(self.window_hwnd, win32con.WM_RBUTTONUP, 1, l_param)
        # elif key == "left":
        #     win32api.PostMessage(self.window_hwnd, win32con.WM_LBUTTONUP, 1, l_param)

    def send_string_to_window(self, string, fast_send=False):
        with self._lock:
            for char in string:
                win32api.PostMessage(self.window_hwnd, win32con.WM_CHAR, ord(char), 0)
                time.sleep(random.uniform(0.07, 0.13)) if fast_send is False else None

    def send_enter_to_window(self):
        self.send_string_to_window("\r", fast_send=True)

    def send_backspace_to_window(self):
        self.send_string_to_window("\b", fast_send=True)

    def open_chat(self):
        if self.window_pointer is None:
            return
        if self.check_if_chat_is_open() is False:
            self.send_enter_to_window()

    def close_chat(self):
        if self.window_pointer is None:
            return
        if self.check_if_chat_is_open() is True:
            self.send_enter_to_window()

    def check_if_chat_is_open(self):
        chat_opened_value = self.window_pointer.get_value_for_offset_name("chat_open", "open")
        if self.window_pointer.get_address_value_for_offset_name("chat_open") == chat_opened_value:
            return True
        return False

    def __del__(self):
        win32gui.SendMessage(self.window_hwnd, win32con.WM_SETFOCUS, 0, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_CAPTURECHANGED, 0, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_CANCELMODE, 0, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_NCACTIVATE, 0, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_ACTIVATE, 0, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_ACTIVATEAPP, 0, 0x12C4)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_KILLFOCUS, 0, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_IME_NOTIFY, 1, 0)
        win32gui.SendMessage(self.window_hwnd, win32con.WM_IME_SETCONTEXT, 0, 0xC000000F)
