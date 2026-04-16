"""Quantity recognition (digit OCR) for item icons.

This module is intentionally *simple* and fast.
It reads stack quantities shown on item icons (e.g. 5, 97, 1000) using:

- a small ROI crop (bottom part of the icon)
- binarization (threshold)
- contour detection
- template matching against 0..9 glyph templates

It is not a general OCR system.
It is a pragmatic decoder for Metin2-style UI numbers.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np


def _require_cv2():
    try:
        import cv2  # type: ignore

        return cv2
    except ModuleNotFoundError as e:  # pragma: no cover
        raise ModuleNotFoundError(
            "OpenCV (cv2) is required for number recognition. Install e.g. 'opencv-python'."
        ) from e


@dataclass(frozen=True)
class NumberReaderConfig:
    """Config for NumberReader.

    Args:
        threshold_value: Binary threshold (0-255). Higher -> fewer pixels survive.
        min_contour_area: Filter out tiny blobs.
        confidence_threshold: Max allowed SQDIFF_NORMED score for a digit match.
          Lower is stricter. 0.0 is a perfect template match.
        crop_start_ratio: How much of the icon height is skipped from the top.
          Default 0.55 means we keep the bottom 45%.
    """

    threshold_value: int = 200
    min_contour_area: float = 0.0
    confidence_threshold: float = 0.05
    crop_start_ratio: float = 0.55


class NumberReader:
    """Read stack quantities from an item icon image using template matching."""

    def __init__(self, templates_dir: str, config: NumberReaderConfig | None = None):
        self.logger = logging.getLogger(f"logger.{self.__class__.__name__}")
        self.config = config or NumberReaderConfig()

        self.templates_dir = str(templates_dir)
        self.templates = self._load_templates(self.templates_dir)
        if not self.templates:
            self.logger.error("No digit templates loaded from '%s'", self.templates_dir)

    def _load_templates(self, templates_dir: str) -> Dict[str, np.ndarray]:
        """Load 0..9 digit templates (grayscale PNG) from a directory."""

        cv2 = _require_cv2()

        templates: Dict[str, np.ndarray] = {}
        if not os.path.isdir(templates_dir):
            self.logger.error("Templates directory not found: %s", templates_dir)
            return templates

        for filename in os.listdir(templates_dir):
            if not filename.endswith(".png"):
                continue

            digit = os.path.splitext(filename)[0]
            if digit not in {str(i) for i in range(10)}:
                continue

            file_path = os.path.join(templates_dir, filename)
            img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
            if img is None:
                self.logger.warning("Could not read template: %s", file_path)
                continue

            templates[digit] = img

        self.logger.info("Loaded %d digit templates from %s", len(templates), templates_dir)
        return templates

    def _preprocess_icon(self, icon_bgr: np.ndarray) -> np.ndarray:
        """Crop bottom area, grayscale, and binarize."""

        cv2 = _require_cv2()

        h = int(icon_bgr.shape[0])
        crop_y = int(h * float(self.config.crop_start_ratio))
        bottom = icon_bgr[crop_y:, :]

        gray = cv2.cvtColor(bottom, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, int(self.config.threshold_value), 255, cv2.THRESH_BINARY)
        return thresh

    def _find_contours(self, binary_img: np.ndarray) -> List[np.ndarray]:
        """Find digit contours and sort them left-to-right."""

        cv2 = _require_cv2()

        contours, _ = cv2.findContours(binary_img.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = [c for c in contours if cv2.contourArea(c) > float(self.config.min_contour_area)]
        return sorted(contours, key=lambda c: cv2.boundingRect(c)[0])

    def read_from_icon(self, icon_bgr: np.ndarray) -> Optional[str]:
        """Read quantity from an icon BGR image.

        Returns:
            - string digits (e.g. "97", "1000")
            - None if no digit-like contours were found

        Note:
            If digits are present but none match templates under the threshold,
            this returns "1" (a pragmatic default used in the original pipeline).
        """

        if icon_bgr is None:
            return None

        binary = self._preprocess_icon(icon_bgr)
        contours = self._find_contours(binary)
        if not contours:
            return None

        digits: List[str] = []

        cv2 = _require_cv2()

        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            roi = binary[y : y + h, x : x + w]

            best_digit: str | None = None
            best_score = float("inf")

            for digit, template in self.templates.items():
                # Current implementation expects exact glyph sizes.
                if roi.shape[:2] != template.shape[:2]:
                    continue

                score = float(cv2.minMaxLoc(cv2.matchTemplate(roi, template, cv2.TM_SQDIFF_NORMED))[0])
                if score < best_score:
                    best_score = score
                    best_digit = digit

            if best_digit is not None and best_score <= float(self.config.confidence_threshold):
                digits.append(best_digit)

        return "".join(digits) if digits else "1"

    def read_from_file(self, image_path: str) -> Optional[str]:
        """Convenience wrapper: read quantity from an image file."""

        cv2 = _require_cv2()

        img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if img is None:
            self.logger.error("Could not read image: %s", image_path)
            return None
        return self.read_from_icon(img)


def default_templates_dir() -> str:
    """Return default templates directory relative to this file."""

    return str(Path(__file__).resolve().parent / "number_templates")

