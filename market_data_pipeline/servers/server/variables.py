import ctypes.wintypes


PLAYER_POINTER = {
        "sig": "CC CC CC CC CC CC CC CC CC CC CC CC CC CC CC 55 8B EC 8B 0D . . . . 83 C1 04 8B 01 5D FF 60 08 CC CC CC CC CC CC CC CC CC CC CC CC CC CC 55 8B EC",
        "extra": 20,
        "offset": 0,
        "offsets": {
            "name": {
                "offset": [0xC, 0x14],
                "value_type": ctypes.c_char(),
                "validation_value": lambda x: x > 0.0
            },
            "x": {
                "offset": [0xC, 0x684],
                "value_type": ctypes.c_float(),
                "validation_value": lambda x: x > 0.0
            },
            "y": {
                "offset": [0xC, 0x688],
                "value_type": ctypes.c_float(),
                "validation_value": lambda x: x < 0.0
            },
            "z": {
                "offset": [0xC, 0x68C],
                "value_type": ctypes.c_float(),
                "validation_value": lambda x: x > 0.0
            },
            "weapon_type": {
                "offset": [0xC, 0x54C],
                "value_type": ctypes.c_ubyte(),
                "validation_value": lambda x: x > 0,
                "values": {"bare": 1}
            },
        }
}

ENTITY_POINTER = {
        "sig": "8B 0D . . . . 8B 01 FF 50 04",
        "extra": 2,
        "offset": 0x8,
        "offsets": {
            "id": {
                "offset": [0x61C],
                "value_type": ctypes.c_uint(),
                "validation_value": lambda x: x >= 0.0,
            },
            "type": {
                "offset": [0x614],
                "value_type": ctypes.c_uint(),
                "validation_value": lambda x: x >= 0.0,
            },
            "vid": {
                "offset": [0x77C],
                "value_type": ctypes.c_uint(),
                "validation_value": lambda x: x > 0
            },
            "x": {
                "offset": [0x684],
                "value_type": ctypes.c_float(),
                "validation_value": lambda x: x > 0.0
            },
            "y": {
                "offset": [0x688],
                "value_type": ctypes.c_float(),
                "validation_value": lambda x: x > 0.0
            },
            "z": {
                "offset": [0x68C],
                "value_type": ctypes.c_float(),
                "validation_value": lambda x: x > 0.0
            },
            "name": {
                "offset": [0x14],
                "value_type": ctypes.c_uint(),
                "validation_value": lambda x: x > 0.0
            },
        }
}

PLAYER_CONTROL = {
    "sig": "83 C4 08 C3 CC CC CC 55 8B EC 83 EC 10 . . . . . 33 C5 89 45 FC 8B . . . . . 8D 45 F0 50",
    "extra": 25,
    "offset": 0,
    "offsets": {
        "send_packet": {
            "offset": [0x5C],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == 0,
            "values": {"use_skill": "HIDDEN", "talk": "HIDDEN", "move": "HIDDEN"}
        },
        "actual_vid": {
            "offset": [0x13B64],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == 0
        },
        "last_vid": {
            "offset": [0x13ABC],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == 0
        },
    }
}


SHOP = {
    "sig": "8B 07 83 C7 04 33 DB 89 45 A4 8D 73 5A 8B . . . . . 57 53",
    "extra": 15,
    "offset": 0,
    "offsets": {
        "item_info_start": {
            "offset": [0x1787],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == 0,
            "values": {
                "offset": lambda slot_id: 0x1787 + 49 * (slot_id - 1),
            }
        },
        "shop_open": {
            "offset": [0x4],
            "value_type": ctypes.c_ubyte(),
            "validation_value": lambda x: x == 0,
            "values": {
                "open": 1,
                "closed": 0
            }
        },
        "vid": {
            "offset": [0x1788],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == 0,
            "values": {
                "offset": lambda slot_id: 0x1788 + 49 * (slot_id - 1),
            }
        },
        "price_yang": {
            "offset": [0x178C],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == 0,
            "values": {
                "offset": lambda slot_id: 0x178C + 49 * (slot_id - 1),
            }
        },
        "price_won": {
            "offset": [0x1794],
            "value_type": ctypes.c_uint8(),
            "validation_value": lambda x: x == 0,
            "values": {
                "offset": lambda slot_id: 0x1794 + 49 * (slot_id - 1),
            }
        },
        "amount": {
            "offset": [0x1796],
            "value_type": ctypes.c_uint8(),
            "validation_value": lambda x: x == 0,
            "values": {
                "offset": lambda slot_id: 0x1796 + 49 * (slot_id - 1),
            }
        },
        "type": {
            "offset": [0x1789],
            "value_type": ctypes.c_ubyte(),
            "validation_value": lambda x: x == 0,
            "values": {
                "offset": lambda slot_id: 0x1789 + 49 * (slot_id - 1),
            }
        },
        "bonus_type": {
            "offset": [0x6F],  # rest bonuses just +3, max bonuses - 10
            "value_type": ctypes.c_ubyte(),
            "validation_value": lambda x: x == 0
        },
        "bonus_value": {
            "offset": [0x70],  # rest bonuses just +3, max bonuses - 10
            "value_type": ctypes.c_int16(),
            "validation_value": lambda x: x == 0
        }
    }
}

WINDOW_INPUT = {
    "sig": "83 C4 18 C3 CC CC CC CC CC CC CC CC CC CC 57 8B F9 8B . . . . . 85 C9",
    "extra": 19,
    "offset": 0,
    "offsets": {
         "capture_window": {
             "offset": ["HIDDEN", "HIDDEN"],
             "value_type": ctypes.c_uint(),
             "validation_value": lambda x: x == "HIDDEN" or x == "HIDDEN",
             "values": {
                 "capture": "HIDDEN",
                 "uncapture": "HIDDEN"
             }
         },
         "capture_input": {
            "offset": ["HIDDEN"],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x == "HIDDEN" or x == "HIDDEN",
            "values": {
                "capture": "HIDDEN",
                "uncapture": "HIDDEN"
            }
        }
    }
}

DINPUT_KEYS = {
    "esc": {
        "offset": 0x312F8,
        "key_down": 32768
    },
    "z": {
        "offset": 0x31324,
        "key_down": 128
    },
    "enter": {
        "offset": 0x31314,
        "key_down": 128
    },
    "i": {
        "offset": 0x3130c,
        "key_down": 2147483648
    },
    "alt": {
        "offset": 0x31330,
        "key_down": 128
    },
    "f1": {
        "offset": 0x31330,
        "key_down": 2147483648
    },
}

WINDOW_FOCUS = {
    "sig": "8B 45 F8 2B 45 F0 8B . . . . . 8B CE 50 8B 45 F4 2B 45 EC 50",
    "extra": 8,
    "offset": 0,
    "offsets": {
        "focus": {
            "offset": [0x64],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "cursor_x": {
            "offset": [0x14],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "cursor_y": {
            "offset": [0x18],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "left_click": {
            "offset": [0x68],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "right_click": {
            "offset": [0x6C],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "last_left_click_x": {
            "offset": [0x24],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "last_left_click_y": {
            "offset": [0x28],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
        },
        "chat_open": {
            "offset": [0x58],
            "value_type": ctypes.c_ubyte(),
            "validation_value": lambda x: x == 5 or x == 4,
            "values": {
                "open": 3,
                "closed": 2
            }
        }
    }
}

INVENTORY_SLOTS = {
   "sig": "83 C1 04 8B 01 5D FF 60 08 CC CC CC CC CC CC CC CC CC CC CC CC CC CC 55 8B EC 8B . . . . . 8B 01",
    "extra": 28,
    "offset": 0,
    "offsets": {
        "slot_vid": {
            "offset": [0x74],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
            "values": {
                "slot_offset": lambda slot_id: 0x74 + 50 * (slot_id - 1)
                # slots from 1 to ...
            }
        },
        "slot_quantity": {
            "offset": [0x78],
            "value_type": ctypes.c_uint(),
            "validation_value": lambda x: x >= 0,
            "values": {
                "slot_offset": lambda slot_id: 0x78 + 50 * (slot_id - 1)
            }
        }
    }
}



WINDOW_DETAILS = {
    "x1": 0x34,
    "x2": 0x3C,
    "y1": 0x38,
    "y2": 0x40,
    "inventory_window": {
        "offset": 0x14,
        "bytes": b'\x08\x00\x00\x00\x0f\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x08\x00\x00\x00\xf6\x00\x00\x00\xa0\x00\x00\x00 \x01\x00\x00'
    }
}