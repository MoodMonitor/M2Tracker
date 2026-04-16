"""Demo: recognize a single icon ROI using the embedding recognizer.

This is a *showcase* script.
It loads:
- embedding model (.pth)
- embedding DB (.pkl) (or builds it if missing and --db-build-dir is provided)
- a single icon crop image

Then prints top-k matches.

Tip: provide `--item-names` JSON to display human-readable names.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any, Dict

def _load_item_names(path: str | None) -> Dict[str, Any]:
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    parser = argparse.ArgumentParser(description="Recognize a single item icon crop using CNN embeddings")
    parser.add_argument("--model", required=True, help="Path to embedding model weights (.pth)")
    parser.add_argument("--icons-dir", required=True, help="Directory containing unique icon classes (subfolders or files) used to infer num_classes")
    parser.add_argument("--db", required=True, help="Path to features DB (.pkl)")
    parser.add_argument("--db-build-dir", default=None, help="Optional ImageFolder directory used to build the DB if --db does not exist")
    parser.add_argument("--image", required=True, help="Path to an icon crop image (ROI)")
    parser.add_argument("--top-k", type=int, default=5, help="How many best matches to print")
    parser.add_argument("--item-names", default=None, help="Optional JSON mapping item_id -> metadata (e.g. name)")
    parser.add_argument("--embedding-size", type=int, default=256)
    parser.add_argument("--input-size", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--device", default=None, help="Force device: cuda / cpu")

    args = parser.parse_args()

    # Import after parsing so `--help` works without optional deps.
    try:
        from .recognizer import Recognizer, RecognizerConfig  # type: ignore
    except Exception:  # pragma: no cover
        from recognizer import Recognizer, RecognizerConfig  # type: ignore

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    cfg = RecognizerConfig(
        embedding_size=args.embedding_size,
        input_size=args.input_size,
        batch_size=args.batch_size,
    )

    recognizer = Recognizer(
        model_path=args.model,
        features_db_path=args.db,
        icons_path=args.icons_dir,
        config=cfg,
        dataset_path=args.db_build_dir,
        device=args.device,
    )

    # Import here so `--help` works even without optional deps.
    import cv2

    roi_bgr = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if roi_bgr is None:
        raise FileNotFoundError(f"Could not read image: {args.image}")

    item_names_db = _load_item_names(args.item_names)
    results = recognizer.find_best_match(roi_bgr, top_k=args.top_k)

    logging.info("Query: %s", Path(args.image).name)
    if not results:
        logging.warning("No matches found")
        return 0

    for i, (item_id, score) in enumerate(results, start=1):
        name = item_names_db.get(item_id, {}).get("name") if item_names_db else None
        if name:
            logging.info("%d) %s | %s | similarity=%.4f", i, item_id, name, score)
        else:
            logging.info("%d) %s | similarity=%.4f", i, item_id, score)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
