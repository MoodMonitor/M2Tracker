"""Demo: read stack quantity from a single icon image.

This is a small showcase script for the `NumberReader`.

It prints the recognized number (or None) and optionally saves a debug image.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Read stack quantity from an item icon")
    parser.add_argument("--image", required=True, help="Path to icon or slot image")
    parser.add_argument("--templates", default=None, help="Directory with digit templates 0..9")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    try:
        from .number_reader import NumberReader, default_templates_dir
    except Exception:  # pragma: no cover
        from number_reader import NumberReader, default_templates_dir

    templates_dir = args.templates or default_templates_dir()
    reader = NumberReader(templates_dir=templates_dir)

    qty = reader.read_from_file(args.image)
    logging.info("Image: %s", Path(args.image).name)
    logging.info("Recognized quantity: %s", qty)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

