"""Training script (metric learning) for the icon embedding model.

Training details:
- Backbone: MobileNetV2
- Losses:
  - ArcFace (primary, learned class prototypes)
  - Triplet Margin (secondary, with mining)
- Sampling:
  - PxK (MPerClassSampler): P classes per batch, K samples per class

The end result is an embedding model that supports nearest-neighbor matching.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import torch
import torch.optim as optim
from pytorch_metric_learning import losses, miners, samplers
from pytorch_metric_learning.utils.accuracy_calculator import AccuracyCalculator
from torch.utils.data import DataLoader
from torchvision.datasets import ImageFolder
from tqdm import tqdm

from .dataset import IconDataset, get_transforms
from .model import EmbeddingModel


@dataclass
class TrainConfig:
    train_dir: str
    val_dir: str
    num_epochs: int = 200
    embedding_size: int = 256

    # PxK sampler
    p_sampler: int = 32
    k_sampler: int = 4

    learning_rate: float = 1e-3
    weight_decay: float = 1e-4

    arcface_margin: float = 0.5
    arcface_scale: float = 30.0

    input_size: int = 32
    model_save_path: str = "embedding_model.pth"
    early_stopping_patience: int = 10

    @property
    def batch_size(self) -> int:
        return int(self.p_sampler * self.k_sampler)


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler("training.log"), logging.StreamHandler()],
    )


def train_one_epoch(
    model: EmbeddingModel,
    arcface_loss: losses.ArcFaceLoss,
    triplet_loss: losses.TripletMarginLoss,
    miner: miners.TripletMarginMiner,
    train_loader: DataLoader,
    optimizer: optim.Optimizer,
    device: str,
) -> float:
    model.train()
    running_loss = 0.0

    for i, (images, labels) in enumerate(tqdm(train_loader, desc="Training")):
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad(set_to_none=True)

        embeddings = model(images)
        loss_arc = arcface_loss(embeddings, labels)

        hard_pairs = miner(embeddings, labels)
        loss_triplet = triplet_loss(embeddings, labels, hard_pairs)

        loss = loss_arc + 0.3 * loss_triplet
        loss.backward()
        optimizer.step()

        running_loss += float(loss.item())

    return running_loss / max(1, len(train_loader))


def _get_all_embeddings(dataset, model: EmbeddingModel, device: str, batch_size: int):
    model.eval()
    embeddings, labels = [], []
    with torch.no_grad():
        dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=False)
        for images, lbls in dataloader:
            embeddings.append(model(images.to(device)).cpu())
            labels.append(lbls.cpu())

    return torch.cat(embeddings), torch.cat(labels)


def validate_precision_at_1(model: EmbeddingModel, train_dataset: IconDataset, val_dataset: IconDataset, device: str, batch_size: int) -> float:
    unique_labels = sorted(set(train_dataset.labels))
    reference_indices = [train_dataset.labels.index(label) for label in unique_labels]
    reference_subset = torch.utils.data.Subset(train_dataset, reference_indices)

    logging.info("Generating embeddings for reference and validation sets...")
    ref_emb, ref_lbl = _get_all_embeddings(reference_subset, model, device, batch_size)
    qry_emb, qry_lbl = _get_all_embeddings(val_dataset, model, device, batch_size)

    accuracy_calculator = AccuracyCalculator(include=("precision_at_1",), k=5)
    accuracies = accuracy_calculator.get_accuracy(
        query=qry_emb.numpy(),
        query_labels=qry_lbl.numpy().astype(np.int64),
        reference=ref_emb.numpy(),
        reference_labels=ref_lbl.numpy().astype(np.int64),
    )
    return float(accuracies.get("precision_at_1"))


def train(config: TrainConfig) -> None:
    setup_logging()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logging.info("Using device: %s", device)

    train_dataset_raw = ImageFolder(root=config.train_dir)
    val_dataset_raw = ImageFolder(root=config.val_dir)
    num_classes = len(train_dataset_raw.classes)
    logging.info("Found %d classes", num_classes)

    train_transform = get_transforms(is_train=True, input_size=config.input_size)
    val_transform = get_transforms(is_train=False, input_size=config.input_size)

    train_paths = [s[0] for s in train_dataset_raw.samples]
    train_labels = [s[1] for s in train_dataset_raw.samples]
    val_paths = [s[0] for s in val_dataset_raw.samples]
    val_labels = [s[1] for s in val_dataset_raw.samples]

    train_dataset = IconDataset(train_paths, train_labels, transform=train_transform)
    val_dataset = IconDataset(val_paths, val_labels, transform=val_transform)

    train_sampler = samplers.MPerClassSampler(labels=train_dataset.labels, m=config.k_sampler, length_before_new_iter=len(train_dataset))

    train_loader = DataLoader(train_dataset, batch_size=config.batch_size, sampler=train_sampler, num_workers=4, pin_memory=True)

    model = EmbeddingModel(num_classes=num_classes, embedding_size=config.embedding_size).to(device)

    arcface_loss = losses.ArcFaceLoss(
        num_classes=num_classes,
        embedding_size=config.embedding_size,
        margin=config.arcface_margin,
        scale=config.arcface_scale,
    ).to(device)

    triplet_loss = losses.TripletMarginLoss(margin=0.3).to(device)
    miner: miners.TripletMarginMiner = miners.TripletMarginMiner(margin=0.3, type_of_triplets="semihard")

    optimizer = optim.AdamW(list(model.parameters()) + list(arcface_loss.parameters()), lr=config.learning_rate, weight_decay=config.weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=config.num_epochs)

    best_p_at_1 = 0.0
    epochs_without_improvement = 0
    best_model_state = None

    for epoch in range(config.num_epochs):
        logging.info("--- Epoch %d/%d ---", epoch + 1, config.num_epochs)

        if epoch == 40:
            miner = miners.TripletMarginMiner(margin=0.3, type_of_triplets="hard")
            logging.info("Switched Triplet Miner to HARD mining.")

        train_loss = train_one_epoch(model, arcface_loss, triplet_loss, miner, train_loader, optimizer, device)
        logging.info("Avg train loss: %.6f", train_loss)

        p_at_1 = validate_precision_at_1(model, train_dataset, val_dataset, device, config.batch_size)
        logging.info("Validation P@1: %.4f", p_at_1)

        scheduler.step()

        if p_at_1 > best_p_at_1:
            best_p_at_1 = p_at_1
            epochs_without_improvement = 0
            best_model_state = model.state_dict()
        else:
            epochs_without_improvement += 1

        if epochs_without_improvement >= config.early_stopping_patience:
            logging.info("Early stopping triggered.")
            break

    if best_model_state is None:
        raise RuntimeError("Training finished without saving any model state.")

    torch.save(best_model_state, config.model_save_path)
    logging.info("Saved model: %s", config.model_save_path)


if __name__ == "__main__":
    # Example paths (keep as placeholders; customize locally if you want to train).
    cfg = TrainConfig(train_dir=r"path\\to\\train", val_dir=r"path\\to\\val")
    train(cfg)
