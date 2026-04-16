import pytest

from backend.core.security import verify_api_key
from backend.core.exceptions import AuthenticationError, ForbiddenError
from backend.config import settings


@pytest.mark.asyncio
async def test_verify_api_key_allows_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "")
    await verify_api_key(api_key_header=None, api_key_query=None)


@pytest.mark.asyncio
async def test_verify_api_key_requires_key(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "secret")
    with pytest.raises(AuthenticationError):
        await verify_api_key(api_key_header=None, api_key_query=None)


@pytest.mark.asyncio
async def test_verify_api_key_rejects_invalid(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "secret")
    with pytest.raises(ForbiddenError):
        await verify_api_key(api_key_header="wrong", api_key_query=None)


@pytest.mark.asyncio
async def test_verify_api_key_accepts_valid(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "secret")
    await verify_api_key(api_key_header="secret", api_key_query=None)

