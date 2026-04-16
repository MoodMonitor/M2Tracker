import functools
import logging
import threading
import time
from contextlib import contextmanager
from typing import Iterable, List, Optional, TypeVar

from sqlalchemy.orm import Session

from ..core.metrics import (
    PROMETHEUS_AVAILABLE,
    REPO_METHOD_DURATION_SECONDS,
    REPO_METHOD_MAX_DURATION_SECONDS,
    REPO_METHOD_MIN_DURATION_SECONDS,
)

T = TypeVar("T")


class BaseRepository: ...


_repo_min_max_state = {}
_repo_min_max_lock = threading.Lock()


def timed_operation(func):
    """Time a repository method and record metrics when enabled."""
    @functools.wraps(func)
    def wrapper(self: "BaseRepository", *args, **kwargs):
        method_name = func.__name__
        start = time.perf_counter()
        try:
            return func(self, *args, **kwargs)
        finally:
            if PROMETHEUS_AVAILABLE:
                duration = time.perf_counter() - start
                repo_name = self.__class__.__name__
                labels = {"repo": repo_name, "method": method_name}
                try:
                    REPO_METHOD_DURATION_SECONDS.labels(**labels).observe(duration)

                    key = (repo_name, method_name)
                    with _repo_min_max_lock:
                        state = _repo_min_max_state.setdefault(
                            key, {"min": float("inf"), "max": float("-inf")}
                        )

                        if duration < state["min"]:
                            state["min"] = duration
                            REPO_METHOD_MIN_DURATION_SECONDS.labels(**labels).set(duration)

                        if duration > state["max"]:
                            state["max"] = duration
                            REPO_METHOD_MAX_DURATION_SECONDS.labels(**labels).set(duration)
                except Exception as e:
                    self.logger.warning(
                        "Failed to record repo metric for %s.%s: %s",
                        repo_name,
                        method_name,
                        e,
                    )
    return wrapper


class BaseRepository:
    """Base class with shared logger and timing helpers."""

    def __init__(self, db: Session):
        self.db = db
        self.logger = logging.getLogger(f"app.repo.{self.__class__.__name__}")

    @contextmanager
    def transaction(self):
        """Context manager for database transactions."""
        try:
            yield
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    @staticmethod
    def _sanitize_limit(limit: int, minimum: int = 1, maximum: int = 50) -> int:
        try:
            val = int(limit)
        except Exception:
            val = minimum
        return max(minimum, min(maximum, val))

    @staticmethod
    def _sanitize_offset(offset: int) -> int:
        try:
            val = int(offset)
        except Exception:
            val = 0
        return max(0, val)

    @staticmethod
    def _escape_like(value: Optional[str]) -> str:
        raw = (value or "").strip()
        return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    @staticmethod
    def _dedupe_trimmed_strings(values: Iterable[str], max_items: int = 20) -> List[str]:
        seen = set()
        out: List[str] = []
        for v in values or []:
            if not v:
                continue
            s = str(v).strip()
            if not s:
                continue
            low = s.lower()
            if low in seen:
                continue
            seen.add(low)
            out.append(s)
            if len(out) >= max_items:
                break
        return out
