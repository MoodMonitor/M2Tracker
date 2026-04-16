from datetime import timedelta, datetime
from typing import Any

from ...core.exceptions import InvalidInputException, NotFoundException


def normalize_query(q: str, min_len: int, max_len: int, too_short_message: str) -> str:
    """Trim and validate query length; return the normalized query."""
    q_norm = (q or "").strip()
    if len(q_norm) < min_len:
        raise InvalidInputException(too_short_message)
    if len(q_norm) > max_len:
        q_norm = q_norm[:max_len]
    return q_norm


async def get_server_or_404(repos: Any, server_name: str):
    """Fetch server by exact name or raise 404."""
    server = await repos.servers.get_by_name(server_name)
    if not server:
        raise NotFoundException(f"Server '{server_name}' not found in database.")
    return server


def validate_window_days(repos: Any, server: Any, window_days: int, field_name: str = "window_day") -> None:
    """Validate window_days and enforce allowed windows if configured."""
    if not isinstance(window_days, int) or window_days <= 0:
        raise InvalidInputException(f"{field_name} must be a positive integer, but got: {window_days}")
    allowed = repos.servers.allowed_windows_set(server)
    if allowed and window_days not in allowed:
        raise InvalidInputException(f"{field_name}={window_days} is not allowed for server '{server.name}'. Allowed: {sorted(allowed)}")


def ensure_last_data_update(server: Any) -> None:
    """Ensure server has last_data_update set or raise 404."""
    if not getattr(server, "last_data_update", None):
        raise NotFoundException(f"Server '{server.name}' has no data updates (last_data_update is null).")


def compute_anchor_dt(last_update: datetime, days: int) -> datetime:
    """Compute anchor datetime as last_update minus given number of days."""
    return last_update - timedelta(days=days)