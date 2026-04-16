"""Export a trained embedding CNN to ONNX.

This is a utility script that was used during development.
It's kept here because ONNX is the target format for web deployment.

It does *not* retrain anything.
"""

from __future__ import annotations

import os
from pathlib import Path

import torch
from torchvision.datasets import ImageFolder

from .model import EmbeddingModel


def export_embedding_model_to_onnx(
    checkpoint_path: str,
    output_path: str,
    train_dir_for_num_classes: str,
    embedding_size: int = 256,
    input_size: int = 32,
    opset_version: int = 13,
) -> None:
    checkpoint_path = str(checkpoint_path)
    output_path = str(output_path)

    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    train_dataset_raw = ImageFolder(root=train_dir_for_num_classes)
    num_classes = len(train_dataset_raw.classes)

    model = EmbeddingModel(num_classes=num_classes, embedding_size=embedding_size)
    model.load_state_dict(torch.load(checkpoint_path, map_location=torch.device("cpu")))
    model.eval()

    dummy_input = torch.randn(1, 3, input_size, input_size, requires_grad=False)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes={"input": {0: "batch"}, "embedding": {0: "batch"}},
    )

