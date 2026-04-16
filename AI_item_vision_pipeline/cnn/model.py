"""Embedding CNN for item icon recognition.

This model is not a classic softmax classifier.
It produces an L2-normalized embedding vector, which is later compared to a database
of known item embeddings using cosine similarity.

Backbone: MobileNetV2 (tiny & fast).
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from .mobilenetv2 import MobileNetV2


class EmbeddingModel(nn.Module):
    """MobileNetV2-based embedding extractor."""

    def __init__(self, num_classes: int, embedding_size: int = 128):
        super().__init__()

        # Backbone pre-trained-style architecture (trained from scratch for icon embeddings).
        self.backbone = MobileNetV2(num_classes=num_classes)
        backbone_out_features = self.backbone.linear.in_features

        # Remove the original classifier head.
        self.backbone.linear = nn.Identity()

        # Small embedding head.
        self.embedding_head = nn.Sequential(
            nn.Linear(backbone_out_features, embedding_size),
            nn.BatchNorm1d(embedding_size),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.backbone(x)
        embedding = self.embedding_head(features)
        return F.normalize(embedding, p=2, dim=1)

