import asyncio
import json
import hashlib
import uuid
from pathlib import Path

from .base import BaseRepository, timed_operation
from ..config import settings


class FeedbackRepository(BaseRepository):

    def _get_storage_path(self) -> Path:
        path = Path(settings.feedback_storage_path).resolve()
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _safe_child_path(base_path: Path, filename: str) -> Path:
        candidate = (base_path / filename).resolve()
        if not candidate.is_relative_to(base_path):
            raise ValueError("Invalid storage path computed for feedback payload")
        return candidate

    @timed_operation
    async def save_general_feedback(self, feedback_data: dict) -> str:
        """
        Asynchronously saves the general feedback JSON data to the storage path.
        Returns the generated unique ID for the feedback.
        """
        feedback_id = f"general-{uuid.uuid4().hex}"
        storage_path = self._get_storage_path()

        json_path = self._safe_child_path(storage_path, f"{feedback_id}.json")

        await asyncio.to_thread(
            json_path.write_text,
            json.dumps(feedback_data, indent=2, ensure_ascii=False),
            encoding='utf-8'
        )
        return feedback_id

    @timed_operation
    async def save_feedback_package(self, image_bytes: bytes, feedback_data: dict) -> tuple[str, str]:
        """
        Asynchronously saves the image and JSON data to the configured storage path.
        Returns a tuple containing:
        - The generated unique ID for the feedback package.
        - The SHA-256 hash of the image content.
        """
        feedback_id = uuid.uuid4().hex
        storage_path = self._get_storage_path()

        image_path = self._safe_child_path(storage_path, f"{feedback_id}.png")
        json_path = self._safe_child_path(storage_path, f"{feedback_id}.json")

        # Calculate image hash
        image_hash = hashlib.sha256(image_bytes).hexdigest()

        # Run blocking I/O in a separate thread to avoid blocking the event loop
        await asyncio.to_thread(image_path.write_bytes, image_bytes)
        await asyncio.to_thread(json_path.write_text, json.dumps(feedback_data, indent=2, ensure_ascii=False),
                                encoding='utf-8')

        return feedback_id, image_hash