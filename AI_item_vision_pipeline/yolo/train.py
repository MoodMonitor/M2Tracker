"""YOLO training helper (Ultralytics) for inventory slot detection.

This script does two things:
1) Generates the ``data.yaml`` file required by Ultralytics/YOLO training.
2) Launches training using a pre-trained base model.

The dataset directory is expected to have the following structure::

    dataset/
      images/
        train/
        val/
      labels/
        train/
        val/

Only a single class is assumed (default: ``item``).

You can use this module both as a library (import and call functions) and as a
standalone script.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml
from ultralytics import YOLO


@dataclass(frozen=True)
class TrainConfig:
    """Configuration for YOLO training."""

    dataset_root: Path
    class_name: str = "item"
    base_model: str = "yolov8s.pt"  # can be a .pt path or a model name

    device: Optional[int] = 0
    epochs: int = 50
    imgsz: int = 640
    batch: int = 8
    patience: int = 20

    # Augmentations (Ultralytics args)
    hsv_h: float = 0.05
    hsv_s: float = 0.7
    hsv_v: float = 0.5
    degrees: float = 0.0
    translate: float = 0.0
    scale: float = 0.3
    fliplr: float = 0.0
    mosaic: float = 1.0
    mixup: float = 0.0
    perspective: float = 0.0
    erasing: float = 0.0


def create_dataset_yaml(dataset_root: Path, class_name: str = "item") -> Path:
    """Create the ``data.yaml`` file required by Ultralytics.

    Args:
        dataset_root: Dataset root directory (contains ``images/`` and ``labels/``).
        class_name: Name of the single class.

    Returns:
        Path to the generated ``data.yaml``.

    Raises:
        FileNotFoundError: When required folders are missing.
    """

    train_images = dataset_root / "images" / "train"
    val_images = dataset_root / "images" / "val"

    if not train_images.exists() or not val_images.exists():
        raise FileNotFoundError(
            "Train/Val directories not found. Expected: "
            f"'{train_images}' and '{val_images}'."
        )

    data_yaml = {
        "train": str(train_images.resolve()),
        "val": str(val_images.resolve()),
        "nc": 1,
        "names": [class_name],
    }

    yaml_path = dataset_root / "data.yaml"
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data_yaml, f, default_flow_style=False, sort_keys=False)

    return yaml_path


def train_yolo_model(cfg: TrainConfig, dataset_yaml_path: Path):
    """Train a YOLO model using Ultralytics.

    Args:
        cfg: Training configuration.
        dataset_yaml_path: Path to ``data.yaml``.

    Returns:
        Ultralytics training results object.
    """

    model = YOLO(cfg.base_model)
    results = model.train(
        data=str(dataset_yaml_path),
        device=cfg.device,
        epochs=cfg.epochs,
        imgsz=cfg.imgsz,
        batch=cfg.batch,
        patience=cfg.patience,
        hsv_h=cfg.hsv_h,
        hsv_s=cfg.hsv_s,
        hsv_v=cfg.hsv_v,
        degrees=cfg.degrees,
        translate=cfg.translate,
        scale=cfg.scale,
        fliplr=cfg.fliplr,
        mosaic=cfg.mosaic,
        mixup=cfg.mixup,
        perspective=cfg.perspective,
        erasing=cfg.erasing,
    )
    return results


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Train YOLO with Ultralytics")
    p.add_argument(
        "--dataset-root",
        type=Path,
        required=True,
        help="Dataset root folder containing images/train, images/val, labels/...",
    )
    p.add_argument("--class-name", type=str, default="item")
    p.add_argument("--base-model", type=str, default="yolov8s.pt")
    p.add_argument("--device", type=int, default=0, help="CUDA device index; use -1 for CPU")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--patience", type=int, default=20)

    # Augmentations
    p.add_argument("--hsv-h", type=float, default=0.05)
    p.add_argument("--hsv-s", type=float, default=0.7)
    p.add_argument("--hsv-v", type=float, default=0.5)
    p.add_argument("--degrees", type=float, default=0.0)
    p.add_argument("--translate", type=float, default=0.0)
    p.add_argument("--scale", type=float, default=0.3)
    p.add_argument("--fliplr", type=float, default=0.0)
    p.add_argument("--mosaic", type=float, default=1.0)
    p.add_argument("--mixup", type=float, default=0.0)
    p.add_argument("--perspective", type=float, default=0.0)
    p.add_argument("--erasing", type=float, default=0.0)

    return p


def main() -> None:
    args = _build_arg_parser().parse_args()

    cfg = TrainConfig(
        dataset_root=args.dataset_root,
        class_name=args.class_name,
        base_model=args.base_model,
        device=args.device,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        hsv_h=args.hsv_h,
        hsv_s=args.hsv_s,
        hsv_v=args.hsv_v,
        degrees=args.degrees,
        translate=args.translate,
        scale=args.scale,
        fliplr=args.fliplr,
        mosaic=args.mosaic,
        mixup=args.mixup,
        perspective=args.perspective,
        erasing=args.erasing,
    )

    dataset_yaml = create_dataset_yaml(cfg.dataset_root, class_name=cfg.class_name)
    results = train_yolo_model(cfg, dataset_yaml)

    # Ultralytics stores runs under runs/detect/train*/weights/best.pt by default.
    # The 'results' object has save_dir with that location.
    print("Training finished!")
    print(f"Best model saved to: {results.save_dir}/weights/best.pt")


if __name__ == "__main__":
    main()

