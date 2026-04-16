"""Tools for exporting embedding DB into a frontend-friendly format.

The runtime recognizer uses a Python pickle (.pkl) file.
For web, it's often nicer to ship:
- a compact JSON metadata file
- a raw Float32 embedding blob (.bin)

This module converts a `features_db_*.pkl` to (*).json + (*).bin.
"""

from __future__ import annotations

import json
import os
import pickle
from typing import Any, Dict

import numpy as np


def prepare_db_for_frontend(pkl_path: str, icon_groups_path: str, output_dir: str, base_filename: str) -> None:
    with open(pkl_path, "rb") as f:
        features_db: Dict[str, Any] = pickle.load(f)

    item_ids = features_db.get("item_ids")
    embeddings_tensor = features_db.get("embeddings")
    if item_ids is None or embeddings_tensor is None:
        raise ValueError("Invalid .pkl file. Expected keys: 'item_ids' and 'embeddings'.")

    with open(icon_groups_path, "r", encoding="utf-8") as f:
        icon_groups = json.load(f)

    group_id_to_all_items: Dict[str, list] = {}
    for group_id, data in icon_groups.items():
        all_items = []
        for name_entry in data.get("names", []):
            vid, name = name_entry.split("_", 1)
            all_items.append({"vid": vid, "name": name})
        if all_items:
            group_id_to_all_items[group_id] = all_items

    embeddings_np = embeddings_tensor.cpu().numpy()
    if len(item_ids) != len(embeddings_np):
        raise ValueError("Mismatch between number of IDs and embeddings.")

    embedding_size = int(embeddings_np.shape[1])

    os.makedirs(output_dir, exist_ok=True)

    metadata = {
        "groups": [group_id_to_all_items.get(group_id, [{"vid": group_id, "name": "Unknown"}]) for group_id in item_ids],
        "embedding_size": embedding_size,
        "binary_file": f"{base_filename}.bin",
    }

    json_output_path = os.path.join(output_dir, f"{base_filename}.json")
    with open(json_output_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, separators=(",", ":"))

    binary_output_path = os.path.join(output_dir, f"{base_filename}.bin")
    with open(binary_output_path, "wb") as f:
        f.write(np.asarray(embeddings_np, dtype=np.float32).tobytes())

