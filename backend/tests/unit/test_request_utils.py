from starlette.requests import Request
import pytest

from backend.core.request_utils import get_client_ip, get_masked_ip
from backend.config import settings


@pytest.fixture(autouse=True)
def _restore_trusted_proxies():
    original = settings.trusted_proxy_ips
    try:
        yield
    finally:
        settings.trusted_proxy_ips = original


def _make_request(headers=None, client=("203.0.113.5", 1234)):
    headers = headers or {}
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": client,
    }
    return Request(scope)


def test_get_client_ip_prefers_x_forwarded_for_from_trusted_proxy():
    settings.trusted_proxy_ips = "203.0.113.5"
    request = _make_request({"X-Forwarded-For": "198.51.100.10, 10.0.0.1"})
    assert get_client_ip(request) == "198.51.100.10"


def test_get_client_ip_uses_x_real_ip():
    settings.trusted_proxy_ips = "203.0.113.5"
    request = _make_request({"X-Real-Ip": "192.0.2.55"})
    assert get_client_ip(request) == "192.0.2.55"


def test_get_client_ip_falls_back_to_client():
    settings.trusted_proxy_ips = "127.0.0.1,::1"
    request = _make_request()
    assert get_client_ip(request) == "203.0.113.5"


def test_get_client_ip_ignores_spoofed_headers_from_untrusted_peer():
    settings.trusted_proxy_ips = "127.0.0.1,::1"
    request = _make_request({"X-Forwarded-For": "198.51.100.10", "X-Real-Ip": "192.0.2.55"})
    assert get_client_ip(request) == "203.0.113.5"


def test_get_client_ip_supports_trusted_proxy_cidr():
    settings.trusted_proxy_ips = "203.0.113.0/24"
    request = _make_request({"X-Forwarded-For": "198.51.100.10"})
    assert get_client_ip(request) == "198.51.100.10"


def test_get_masked_ip_ipv4():
    assert get_masked_ip("192.168.1.10", 24) == "192.168.1"


def test_get_masked_ip_invalid_or_zero_mask():
    assert get_masked_ip("192.168.1.10", 0) == ""
    assert get_masked_ip("bad-ip", 24) == "bad-ip"

