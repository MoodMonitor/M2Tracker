from backend.routes.utils.cache import _generate_cache_key
from backend.config import settings


def test_generate_cache_key_is_stable(monkeypatch):
    monkeypatch.setattr(settings, "redis_prefix", "testprefix")
    params_a = {"b": "2", "a": "1"}
    params_b = {"a": "1", "b": "2"}

    key_a = _generate_cache_key("endpoint", params_a, server_name="srv")
    key_b = _generate_cache_key("endpoint", params_b, server_name="srv")

    assert key_a == key_b


def test_generate_cache_key_separates_global_and_server(monkeypatch):
    monkeypatch.setattr(settings, "redis_prefix", "testprefix")
    params = {"q": "abc"}

    key_server = _generate_cache_key("endpoint", params, server_name="srv")
    key_global = _generate_cache_key("endpoint", params, server_name=None)

    assert ":cache:srv:" in key_server
    assert ":cache:global:" in key_global

