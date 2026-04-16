"""Runtime recognizer for item icons using embedding similarity.

This is the *inference* side of the CNN part of the pipeline.

It loads:
- a trained embedding model (.pth)
- a feature database: averaged embeddings per item class (.pkl)

Then for each ROI icon crop, it:
- computes query embedding
- compares to the DB using cosine similarity
- returns top-k best matches.
"""

from __future__ import annotations

import logging
import os
import pickle
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch
from torch.utils.data import DataLoader
from torchvision.datasets import ImageFolder
from tqdm import tqdm

from .dataset import get_transforms
from .model import EmbeddingModel


@dataclass(frozen=True)
class RecognizerConfig:
    """Minimal runtime config.

    Keep this small: it should be easy to pass from other parts of the pipeline.
    """

    embedding_size: int = 256
    input_size: int = 32
    batch_size: int = 128


class Recognizer:
    """Find the most similar item icon using an embedding database."""

    def __init__(
        self,
        model_path: str,
        features_db_path: str,
        icons_path: str,
        config: RecognizerConfig | Dict[str, Any],
        dataset_path: str | None = None,
        device: str | None = None,
    ):
        self.config = (
            config
            if isinstance(config, RecognizerConfig)
            else RecognizerConfig(
                embedding_size=int(config["embedding_size"]),
                input_size=int(config["input_size"]),
                batch_size=int(config.get("batch_size", 128)),
            )
        )

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.logger = logging.getLogger(f"logger.{self.__class__.__name__}")

        # Model init requires num_classes (used by MobileNetV2 definition).
        num_classes = len(os.listdir(icons_path))
        self.model = EmbeddingModel(num_classes=num_classes, embedding_size=self.config.embedding_size)
        self.model.load_state_dict(torch.load(model_path, map_location=self.device))
        self.model.to(self.device)
        self.model.eval()

        # Must match validation preprocessing.
        self.transform = get_transforms(is_train=False, input_size=self.config.input_size)

        self.features_db_path = features_db_path
        self.icons_path = icons_path
        self.db = self._load_or_create_features_db(dataset_path)

    def _load_or_create_features_db(self, dataset_path: str | None) -> Dict[str, Any]:
        if os.path.exists(self.features_db_path):
            self.logger.info("Loading feature database: %s", self.features_db_path)
            with open(self.features_db_path, "rb") as f:
                return pickle.load(f)

        if not dataset_path:
            raise FileNotFoundError(
                f"Feature database not found: {self.features_db_path} and dataset_path was not provided."
            )

        self.logger.info("No feature database found. Creating a new one...")
        return self.create_features_database(dataset_path)

    def create_features_database(self, dataset_path: str) -> Dict[str, Any]:
        """Create an averaged embedding per class using samples from an ImageFolder dataset."""

        import cv2

        self.logger.info("Loading icon samples from: %s", dataset_path)
        full_dataset = ImageFolder(root=dataset_path)

        # Map class index -> original folder name (usually item_id).
        class_to_id_map = {v: k for k, v in full_dataset.class_to_idx.items()}

        embeddings_per_class: List[torch.Tensor] = []
        item_ids: List[str] = []

        self.logger.info("Averaging embeddings for %d classes...", len(full_dataset.classes))

        with torch.no_grad():
            for class_idx, class_id_str in tqdm(class_to_id_map.items(), desc="Averaging embeddings per class"):
                indices_for_class = [i for i, label in enumerate(full_dataset.targets) if label == class_idx]
                if not indices_for_class:
                    continue

                paths_for_class = [full_dataset.samples[i][0] for i in indices_for_class]
                loader = DataLoader(paths_for_class, batch_size=self.config.batch_size, shuffle=False)

                class_embeddings: List[torch.Tensor] = []
                for image_paths_batch in loader:
                    batch_images = []
                    for path in image_paths_batch:
                        image = cv2.imread(path)
                        if image is None:
                            continue
                        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                        batch_images.append(self.transform(image=image)["image"])

                    if not batch_images:
                        continue

                    images_tensor = torch.stack(batch_images).to(self.device)
                    class_embeddings.append(self.model(images_tensor).cpu())

                if not class_embeddings:
                    continue

                avg_embedding = torch.mean(torch.cat(class_embeddings), dim=0, keepdim=True)
                avg_embedding = torch.nn.functional.normalize(avg_embedding, p=2, dim=1)

                embeddings_per_class.append(avg_embedding)
                item_ids.append(class_id_str)

        if not embeddings_per_class:
            raise RuntimeError("Could not create feature database (no embeddings computed).")

        all_embeddings = torch.cat(embeddings_per_class)
        db = {"embeddings": all_embeddings, "item_ids": item_ids}

        with open(self.features_db_path, "wb") as f:
            pickle.dump(db, f)

        self.logger.info("Saved feature database: %s", self.features_db_path)
        return db

    def find_best_match(self, roi_image: np.ndarray, top_k: int = 1) -> Optional[List[Tuple[str, float]]]:
        """Return top-k best matches for a BGR ROI crop."""

        import cv2

        if roi_image is None:
            return None

        roi_rgb = cv2.cvtColor(roi_image, cv2.COLOR_BGR2RGB)
        img_tensor = self.transform(image=roi_rgb)["image"].unsqueeze(0).to(self.device)

        with torch.no_grad():
            query_embedding = self.model(img_tensor)

        db_embeddings = self.db["embeddings"].to(self.device)
        similarities = torch.matmul(query_embedding, db_embeddings.T).squeeze(0)

        scores, indices = torch.topk(similarities, k=top_k)
        return [(self.db["item_ids"][idx.item()], float(score.item())) for score, idx in zip(scores, indices)]
