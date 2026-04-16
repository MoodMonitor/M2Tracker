import asyncio
import json
import uuid
from pathlib import Path

from .base import BaseRepository, timed_operation
from ..config import settings


class BugReportRepository(BaseRepository):
    def _get_storage_path(self) -> Path:
        path = Path(settings.bug_report_storage_path).resolve()
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _safe_child_path(base_path: Path, filename: str) -> Path:
        candidate = (base_path / filename).resolve()
        if not candidate.is_relative_to(base_path):
            raise ValueError("Invalid storage path computed for bug report payload")
        return candidate

    @timed_operation
    async def save_bug_report_package(self, report_data: dict) -> str:
        """
        Asynchronously saves the report JSON to the configured storage path.
        Returns the generated unique ID for the report package.
        """
        report_id = uuid.uuid4().hex
        storage_path = self._get_storage_path()
        json_path = self._safe_child_path(storage_path, f"{report_id}.json")

        await asyncio.to_thread(
            json_path.write_text,
            json.dumps(report_data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return report_id