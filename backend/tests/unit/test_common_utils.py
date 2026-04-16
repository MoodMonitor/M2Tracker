from datetime import datetime, timedelta

import pytest

from backend.routes.utils.common import (
    normalize_query,
    validate_window_days,
    ensure_last_data_update,
    compute_anchor_dt,
)
from backend.core.exceptions import InvalidInputException, NotFoundException


class DummyServers:
    def __init__(self, allowed_windows):
        self._allowed_windows = allowed_windows

    def allowed_windows_set(self, _server):
        return set(self._allowed_windows) if self._allowed_windows else set()


class DummyRepos:
    def __init__(self, allowed_windows):
        self.servers = DummyServers(allowed_windows)


class DummyServer:
    def __init__(self, name, last_data_update=None):
        self.name = name
        self.last_data_update = last_data_update


def test_normalize_query_trims_and_validates():
    assert normalize_query("  abc ", 3, 10, "too short") == "abc"

    with pytest.raises(InvalidInputException):
        normalize_query("  a ", 3, 10, "too short")


def test_normalize_query_truncates_to_max_len():
    assert normalize_query("abcdefghij", 1, 5, "too short") == "abcde"


def test_validate_window_days_allows_configured_values():
    repos = DummyRepos([7, 14])
    server = DummyServer("Test")

    validate_window_days(repos, server, 7)
    validate_window_days(repos, server, 14)

    with pytest.raises(InvalidInputException):
        validate_window_days(repos, server, 30)


def test_validate_window_days_requires_positive_int():
    repos = DummyRepos([7])
    server = DummyServer("Test")

    with pytest.raises(InvalidInputException):
        validate_window_days(repos, server, 0)

    with pytest.raises(InvalidInputException):
        validate_window_days(repos, server, -1)


def test_ensure_last_data_update():
    server = DummyServer("NoData", last_data_update=None)
    with pytest.raises(NotFoundException):
        ensure_last_data_update(server)


def test_compute_anchor_dt():
    now = datetime(2024, 1, 10, 12, 0, 0)
    assert compute_anchor_dt(now, 7) == now - timedelta(days=7)

