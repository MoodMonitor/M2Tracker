"""Demo: end-to-end recognition on a single screenshot (YOLO -> crop -> CNN).

This script is intentionally written for *showcasing* the pipeline:
- run YOLO detector to find item slots
- filter tiny false positives
- recognize each slot via CNN embedding similarity
- produce:
  - a main output image with numbered boxes
  - per-slot side-by-side images (ROI vs matched icon) if --icons-flat-dir is provided

Notes:
- YOLO model is expected to have a single class: 'item slot'.
- CNN recognizer expects an embedding model (.pth) + embedding DB (.pkl).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List

def _safe_filename(text: str) -> str:
    return "".join(c for c in text if c.isalnum() or c in (" ", "_", "-", ".")).strip().replace(" ", "_")


def _load_item_names(path: str | None) -> Dict[str, Any]:
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _find_icon_file(flat_icons_dir: str, item_id: str) -> str | None:
    # Flat structure: files like "12345_name.png".
    try:
        for f in os.listdir(flat_icons_dir):
            if f.startswith(f"{item_id}_"):
                return os.path.join(flat_icons_dir, f)
    except FileNotFoundError:
        return None
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="YOLO + CNN pipeline demo on a single screenshot")

    parser.add_argument("--image", required=True, help="Input screenshot path")
    parser.add_argument("--out-dir", required=True, help="Directory to write results")

    # YOLO
    parser.add_argument("--yolo", required=True, help="YOLO model path (.pt / .onnx)")
    parser.add_argument("--conf", type=float, default=0.7, help="YOLO confidence threshold")
    parser.add_argument("--iou", type=float, default=0.5, help="YOLO IoU threshold")
    parser.add_argument("--min-box-w", type=int, default=20, help="Reject detections smaller than this width")
    parser.add_argument("--min-box-h", type=int, default=20, help="Reject detections smaller than this height")

    # CNN
    parser.add_argument("--cnn", required=True, help="Embedding CNN weights (.pth)")
    parser.add_argument("--icons-dir", required=True, help="Directory used to infer CNN num_classes")
    parser.add_argument("--db", required=True, help="Features DB .pkl")
    parser.add_argument("--db-build-dir", default=None, help="Optional ImageFolder dir used to build DB if missing")
    parser.add_argument("--top-k", type=int, default=1)
    parser.add_argument("--item-names", default=None, help="Optional JSON mapping item_id -> metadata")
    parser.add_argument("--embedding-size", type=int, default=256)
    parser.add_argument("--input-size", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--device", default=None, help="Force torch device: cuda/cpu")

    # Optional per-slot visualization
    parser.add_argument(
        "--icons-flat-dir",
        default=None,
        help="Optional directory with original icon images, used to add (ROI | matched icon) outputs",
    )

    args = parser.parse_args()

    # Import after parsing so `--help` works without optional deps.
    try:
        from .recognizer import Recognizer, RecognizerConfig  # type: ignore
    except Exception:  # pragma: no cover
        from recognizer import Recognizer, RecognizerConfig  # type: ignore

    import cv2
    import numpy as np
    from ultralytics import YOLO

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load image
    main_bgr = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if main_bgr is None:
        raise FileNotFoundError(f"Could not read image: {args.image}")

    # Init models
    logging.info("Loading YOLO: %s", args.yolo)
    yolo = YOLO(args.yolo)

    cfg = RecognizerConfig(
        embedding_size=args.embedding_size,
        input_size=args.input_size,
        batch_size=args.batch_size,
    )
    logging.info("Loading CNN recognizer: %s", args.cnn)
    cnn = Recognizer(
        model_path=args.cnn,
        features_db_path=args.db,
        icons_path=args.icons_dir,
        config=cfg,
        dataset_path=args.db_build_dir,
        device=args.device,
    )

    item_names_db = _load_item_names(args.item_names)

    # YOLO detect
    logging.info("Running YOLO on: %s", Path(args.image).name)
    yolo_results = yolo(main_bgr, conf=args.conf, iou=args.iou)

    boxes_xyxy = yolo_results[0].boxes.xyxy.cpu().numpy().astype(int)
    # Sort top-to-bottom, left-to-right like a natural inventory layout
    boxes_xyxy = sorted(boxes_xyxy, key=lambda b: (int(b[1]), int(b[0])))

    output_main = main_bgr.copy()

    recognized: List[Dict[str, Any]] = []

    valid_idx = 0
    for raw_i, (x1, y1, x2, y2) in enumerate(boxes_xyxy, start=1):
        w = x2 - x1
        h = y2 - y1

        if w < args.min_box_w or h < args.min_box_h:
            cv2.rectangle(output_main, (x1, y1), (x2, y2), (0, 0, 255), 1)
            logging.info("Rejected box #%d (size %dx%d)", raw_i, w, h)
            continue

        valid_idx += 1
        roi = main_bgr[y1:y2, x1:x2]

        matches = cnn.find_best_match(roi, top_k=args.top_k)
        if not matches:
            continue

        best_id, best_score = matches[0]
        name = item_names_db.get(best_id, {}).get("name", "Unknown") if item_names_db else "Unknown"

        recognized.append(
            {
                "rank": valid_idx,
                "id": best_id,
                "name": name,
                "score": float(best_score),
                "coords": (int(x1), int(y1), int(x2), int(y2)),
            }
        )

        logging.info("Slot %d -> %s (%s) similarity=%.3f", valid_idx, best_id, name, best_score)

        # Optional per-slot output: ROI | matched icon
        if args.icons_flat_dir:
            h_roi, w_roi = roi.shape[:2]
            canvas = np.zeros((h_roi, w_roi * 2, 3), dtype=np.uint8)
            canvas[:, :w_roi] = roi

            icon_path = _find_icon_file(args.icons_flat_dir, best_id)
            if icon_path:
                icon = cv2.imread(icon_path, cv2.IMREAD_UNCHANGED)
                if icon is not None:
                    icon = cv2.resize(icon, (w_roi, h_roi))
                    if icon.shape[2] == 4:
                        alpha = icon[:, :, 3].astype(np.float32) / 255.0
                        rgb = icon[:, :, :3]
                        target = canvas[:, w_roi : w_roi * 2]
                        canvas[:, w_roi : w_roi * 2] = (
                            (1.0 - alpha[..., None]) * target + alpha[..., None] * rgb
                        ).astype(np.uint8)
                    else:
                        canvas[:, w_roi : w_roi * 2] = icon

            slot_filename = _safe_filename(f"slot_{valid_idx:02d}_id_{best_id}_{name}_sim_{best_score:.2f}.png")
            cv2.imwrite(str(out_dir / slot_filename), canvas)

    # Draw numbered boxes on the main image
    for entry in recognized:
        x1, y1, x2, y2 = entry["coords"]
        label = str(entry["rank"])
        cv2.rectangle(output_main, (x1, y1), (x2, y2), (0, 255, 0), 1)
        cv2.putText(output_main, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

    out_main_path = out_dir / f"recognized_{Path(args.image).name}"
    cv2.imwrite(str(out_main_path), output_main)

    # Also write a machine-readable JSON for the frontend/devtools
    out_json_path = out_dir / f"recognized_{Path(args.image).stem}.json"
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(recognized, f, ensure_ascii=False, indent=2)

    logging.info("Done. Wrote: %s", out_main_path)
    logging.info("Wrote: %s", out_json_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
