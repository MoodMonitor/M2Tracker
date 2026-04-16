import secrets
from typing import Optional

from fastapi import Security
from fastapi.security.api_key import APIKeyHeader, APIKeyQuery

from ..config import settings
from .exceptions import AuthenticationError, ForbiddenError

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
API_KEY_QUERY = APIKeyQuery(name="api_key", auto_error=False)


async def verify_api_key(
    api_key_header: Optional[str] = Security(API_KEY_HEADER),
    api_key_query: Optional[str] = Security(API_KEY_QUERY),
):
    """
    Dependency to verify the API key for internal endpoints.
    Accepts the key in the 'X-API-Key' header or as an 'api_key' query parameter.
    """
    if not settings.INTERNAL_API_KEY:
        raise AuthenticationError("API key is not defined.")

    api_key = api_key_header or api_key_query

    if api_key is None:
        raise AuthenticationError("API key is required in the 'X-API-Key' header or as the 'api_key' query parameter.")

    if not secrets.compare_digest(api_key, settings.INTERNAL_API_KEY):
        raise ForbiddenError("Invalid API key provided.")
