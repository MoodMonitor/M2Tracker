import time
import logging
import threading
import pydirectinput
import win32api
import win32con
import win32gui
import win32process

from .pointer import Pointer
from pymem.process import module_from_name
from pymem.exception import WinAPIError
from memory.base_pointers import BasePointers


class DINPUT:


    def __init__(self, process, window_input_pointer=None, key_input_pointer=None, dinput_keys=None, window_handle=None,
                 **kwargs):
        self.process = process
        self.window_pointer = Pointer(self.process, window_input_pointer, "window_input_pointer")
        self.window_hwnd = window_handle or BasePointers(self.process).window_hwnd

        self.dinput_base = module_from_name(self.process.process_handle, "DINPUT8.dll").lpBaseOfDll
        self.dinput_keys = dinput_keys
        self.logger = logging.getLogger("logger.{}".format(self.__class__.__name__))
        self.update_dinput_keys_offset()

        self._lock = threading.Lock()
        self._pressed_keys = []
        self._captured = False

    def update_dinput_keys_offset(self, key="z", retried=False):
        """
        Update the memory offset for the `dinput8.dll` module, which may vary across different computers.
        """
        if not self.check_if_game_window_is_active():
            self.set_foreground_window_safe(self.window_hwnd)

        self.logger.info("Start searching for the offset for dinput keys, ensure the game window is in focus")
        key_address = self.dinput_base + self.dinput_keys[key]["offset"]
        pydirectinput.keyDown(key)
        time.sleep(0.4)
        for i in range(10000):
            try:
                if self.process.read_int(key_address + 0x1 * i) == self.dinput_keys[key]["key_down"]:
                    self.logger.info("Found offset for dinput: {}".format(hex(0x1 * i)))
                    offset = 0x1 * i
                    break
                if self.process.read_int(key_address + 0x1 * -i) == self.dinput_keys[key]["key_down"]:
                    self.logger.info("Found offset for dinput: {}".format(hex(0x1 * -i)))
                    offset = 0x1 * -i
                    break
            except WinAPIError:
                pass
        else:
            pydirectinput.keyUp(key)
            if retried is False:
                self.logger.warning("Failed to find dinput, retrying one more time in 3 seconds!!")
                time.sleep(3)
                self.update_dinput_keys_offset(key=key, retried=True)
                return
            raise Exception("Not found offset for dinput!!")
        pydirectinput.keyUp(key)

        for key in self.dinput_keys.keys():
            self.dinput_keys[key]["offset"] += offset

    def capture_dinput(self):
        dinput_captured = self.window_pointer.get_address_value_for_offset_name("capture_input")
        if dinput_captured != self.window_pointer.get_value_for_offset_name("capture_input", "capture"):
            self.window_pointer.set_defined_address_value_for_offset_name("capture_window", "capture")
            time.sleep(0.02)
            self.window_pointer.set_defined_address_value_for_offset_name("capture_input", "capture")
            self._captured = True
        return self._captured

    def uncapture_dinput(self):
        if self.check_if_game_window_is_active() is False and len(self._pressed_keys) == 0 and self._captured is True:
            self.window_pointer.set_defined_address_value_for_offset_name("capture_window", "uncapture")
            self._captured = False
        return self._captured

    def press_key(self, key):
        if key in self._pressed_keys:
            return
        with self._lock:
            self.capture_dinput()
            key_address = self.dinput_base + self.dinput_keys[key]["offset"]
            actual_value = self.process.read_int(key_address)
            if actual_value < 0:
                self.process.write_int(key_address, 0)
                actual_value = 0
            self.process.write_int(key_address, actual_value + self.dinput_keys[key]["key_down"])
            self._pressed_keys.append(key)
            time.sleep(0.01)

    def release_key(self, key):
        key_address = self.dinput_base + self.dinput_keys[key]["offset"]
        actual_value = self.process.read_int(key_address)
        key_value = self.dinput_keys[key]["key_down"]
        with self._lock:
            if abs(actual_value) - abs(key_value) >= 0:
                self.process.write_int(key_address, actual_value - key_value)
                self._pressed_keys.remove(key)
                time.sleep(0.02)
                self.uncapture_dinput()
            else:  # Defensive cleanup in case key state got out of sync.
                self.logger.warning("Key %s is not pressed.", key)
                try:
                    self._pressed_keys.remove(key)
                except ValueError as e:
                    self.logger.warning("Key is missing in pressed list: %s", e)

    def press_and_release_keys(self, keys):
        keys = keys if isinstance(keys, list) else [keys]
        for key in keys:
            self.press_key(key)
        time.sleep(0.01)
        for key in keys:
            self.release_key(key)

    def get_available_keys(self):
        return list(self.dinput_keys.keys())

    def check_if_game_window_is_active(self):
        if win32gui.GetForegroundWindow() == self.window_hwnd:
            return True
        return False

    @staticmethod
    def set_foreground_window_safe(hwnd):
        try:
            if not win32gui.IsWindow(hwnd):
                return False

            current_thread = win32api.GetCurrentThreadId()

            target_thread, _ = win32process.GetWindowThreadProcessId(hwnd)

            if current_thread != target_thread:
                win32process.AttachThreadInput(current_thread, target_thread, True)

            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
            win32gui.BringWindowToTop(hwnd)

            if current_thread != target_thread:
                win32process.AttachThreadInput(current_thread, target_thread, False)

            return True

        except Exception:
            logging.getLogger("logger.DINPUT").exception("Failed to set foreground window safely")
            return False

    def __del__(self):
        if self.check_if_game_window_is_active() is False:
            self.window_pointer.set_defined_address_value_for_offset_name("capture_window", "uncapture")
