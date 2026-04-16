"""YOLO model tester (Ultralytics) for quick qualitative evaluation.

This script runs inference on one image or a batch of images and saves the
rendered detections to an output directory.

Why this exists
---------------
- Ultralytics already has its own CLI, but it can be convenient to keep a tiny
  project-specific runner with consistent defaults (thresholds, min box size,
  output naming, etc.).

Supported model formats
-----------------------
Ultralytics `YOLO()` can load both `.pt` and `.onnx` models.

Output
------
- For each input image it writes: `detected_<original_name>`.
- Boxes that are rejected by min-size filters are drawn in red.

Note
----
This is a visualization/debug tool, not a benchmark.
"""

from __future__ import annotations

import argparse
import logging
import random
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import cv2
from ultralytics import YOLO


BGRColor = Tuple[int, int, int]


def _color_for_class(cls_id: int) -> BGRColor:
    """Deterministic (but varied) BGR color for a class id."""

    rng = random.Random(int(cls_id))
    return tuple(rng.randint(50, 255) for _ in range(3))  # type: ignore[return-value]


def _iter_images(input_path: Path, glob_pattern: str) -> Iterable[Path]:
    if input_path.is_file():
        yield input_path
        return

    if not input_path.exists():
        raise FileNotFoundError(f"Input path does not exist: {input_path}")

    # Directory
    yield from sorted(input_path.glob(glob_pattern))


def test_yolo_model(
    model_path: Path,
    image_paths: Sequence[Path],
    output_dir: Path,
    confidence_threshold: float = 0.5,
    iou_threshold: float = 0.5,
    min_width: int = 30,
    min_height: int = 30,
) -> None:
    """Run YOLO inference and save rendered images.

    Args:
        model_path: Path to `.pt` or `.onnx` model.
        image_paths: Images to run inference on.
        output_dir: Where to write `detected_*.png`/`*.jpg`.
        confidence_threshold: Confidence threshold passed to Ultralytics.
        iou_threshold: IoU threshold passed to Ultralytics.
        min_width: Reject detections smaller than this (px).
        min_height: Reject detections smaller than this (px).
    """

    logger = logging.getLogger("yolo_test")

    logger.info("Loading YOLO model from: %s", model_path)
    model = YOLO(str(model_path))

    output_dir.mkdir(parents=True, exist_ok=True)

    total_images = 0
    for image_path in image_paths:
        total_images += 1
        image = cv2.imread(str(image_path))
        if image is None:
            logger.warning("Could not read image: %s", image_path)
            continue

        logger.info("Running detection on: %s", image_path.name)
        results = model(image, conf=confidence_threshold, iou=iou_threshold)

        detection_count = 0
        rejected_count = 0

        for result in results:
            boxes = result.boxes.cpu().numpy()
            for box in boxes:
                detection_count += 1
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                class_name = model.names.get(cls, "UNKNOWN")

                box_w = x2 - x1
                box_h = y2 - y1

                if box_w < min_width or box_h < min_height:
                    rejected_count += 1
                    # Rejected: red thin rectangle
                    cv2.rectangle(image, (x1, y1), (x2, y2), (0, 0, 255), 1)
                    logger.debug(
                        "Rejected '%s' (%sx%s too small) conf=%.2f at [%s,%s,%s,%s]",
                        class_name,
                        box_w,
                        box_h,
                        conf,
                        x1,
                        y1,
                        x2,
                        y2,
                    )
                    continue

                color = _color_for_class(cls)
                cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)

                # Compact label: confidence
                label = f"{conf:.2f}"
                (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)

                # Center the label in the box
                label_x = x1 + max(0, (box_w - tw) // 2)
                label_y = y1 + max(th + baseline, (box_h + th) // 2)

                cv2.rectangle(
                    image,
                    (label_x, label_y - th - baseline),
                    (label_x + tw, label_y),
                    color,
                    -1,
                )
                cv2.putText(
                    image,
                    label,
                    (label_x, label_y - baseline),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.35,
                    (0, 0, 0),
                    1,
                    lineType=cv2.LINE_AA,
                )

        out_path = output_dir / f"detected_{image_path.name}"
        cv2.imwrite(str(out_path), image)

        logger.info(
            "Saved: %s (detections=%s, rejected=%s)",
            out_path.name,
            detection_count,
            rejected_count,
        )

    logger.info("Done. Processed %s images.", total_images)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Test YOLO model on images and save visualizations")
    p.add_argument("--model", type=Path, required=True, help="Path to YOLO model (.pt or .onnx)")
    p.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Input image path OR directory with images",
    )
    p.add_argument(
        "--glob",
        type=str,
        default="*.png",
        help="Glob pattern used when --input is a directory (default: *.png)",
    )
    p.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output directory to store detected_*.png",
    )

    p.add_argument("--conf", type=float, default=0.6, help="Confidence threshold")
    p.add_argument("--iou", type=float, default=0.5, help="IoU threshold")
    p.add_argument("--min-width", type=int, default=20, help="Reject boxes smaller than this width")
    p.add_argument("--min-height", type=int, default=20, help="Reject boxes smaller than this height")
    p.add_argument("--verbose", action="store_true", help="Enable debug logs")

    return p


def main(argv: Optional[List[str]] = None) -> None:
    args = _build_arg_parser().parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    images = list(_iter_images(args.input, args.glob))
    if not images:
        raise SystemExit(f"No images found for input={args.input} glob={args.glob}")

    test_yolo_model(
        model_path=args.model,
        image_paths=images,
        output_dir=args.output,
        confidence_threshold=args.conf,
        iou_threshold=args.iou,
        min_width=args.min_width,
        min_height=args.min_height,
    )


if __name__ == "__main__":
    main()

