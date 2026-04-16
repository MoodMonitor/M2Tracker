"""Dataset utilities for training and validating the icon embedding model.

It defines:
- `get_transforms(...)`: Albumentations pipelines for train/val.
- `IconDataset`: a lightweight dataset that reads images via OpenCV.

The model is trained on tiny icon crops (default: 32x32).
"""

from __future__ import annotations

from typing import Sequence

import albumentations as A
from albumentations.pytorch import ToTensorV2
from torch.utils.data import Dataset


def get_transforms(is_train: bool, input_size: int = 32) -> A.Compose:
    """Return Albumentations preprocessing/augmentation pipeline.

    Args:
        is_train: When True, returns a stronger augmentation pipeline.
        input_size: Final square image size (H=W=input_size).

    Returns:
        Albumentations Compose object.
    """

    if is_train:
        return A.Compose(
            [
                # Scale jittering (~ +/- 4px when input_size=32).
                A.RandomScale(scale_limit=(-0.125, 0.125), p=0.5),
                A.Resize(input_size, input_size),

                # Image quality / compression artifacts (common for screenshots & web).
                A.GaussNoise(p=0.2),
                A.GaussianBlur(blur_limit=(1, 2), p=0.3),
                A.ImageCompression(
                    compression_type="jpeg",
                    quality_range=(70, 95),
                    p=0.2,
                ),

                # Mild color jitter (icons can vary slightly across UIs).
                A.ColorJitter(
                    brightness=0.1,
                    contrast=0.2,
                    saturation=0.0,
                    hue=0.0,
                    p=0.3,
                ),

                # Small occlusion: helps with noise / partial overlays.
                A.CoarseDropout(
                    num_holes_range=(1, 1),
                    hole_height_range=(0.05, 0.1),
                    hole_width_range=(0.05, 0.1),
                    fill=0,
                    p=0.3,
                ),

                # Normalization + to tensor.
                A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ToTensorV2(),
            ]
        )

    return A.Compose(
        [
            A.Resize(input_size, input_size),
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2(),
        ]
    )


class IconDataset(Dataset):
    """A minimal dataset for (image_path, label) pairs."""

    def __init__(
        self,
        image_paths: Sequence[str],
        labels: Sequence[int],
        transform: A.Compose | None = None,
    ):
        self.image_paths = list(image_paths)
        self.labels = list(labels)
        self.transform = transform

    def __len__(self) -> int:
        return len(self.image_paths)

    def __getitem__(self, idx: int):
        import cv2

        image_path = self.image_paths[idx]
        label = self.labels[idx]

        image = cv2.imread(image_path)
        if image is None:
            raise FileNotFoundError(f"Could not read image: {image_path}")

        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        if self.transform:
            image = self.transform(image=image)["image"]

        return image, label
