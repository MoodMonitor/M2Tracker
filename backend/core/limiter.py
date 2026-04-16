from fastapi import Request
from slowapi import Limiter
from ..config import settings
from urllib.parse import quote_plus
from .request_utils import get_client_ip


if settings.redis_sock:
    url = f"redis+unix://:{settings.redis_password}@{settings.redis_sock}"
else:
    url = settings.redis_url

limiter = Limiter(
    key_func=get_client_ip,
    storage_uri=url,
    enabled=settings.rate_limit_enabled,
    default_limits=["60/1minute"]
)