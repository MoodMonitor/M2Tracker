from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Callable
from ..config import settings


class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        response = await call_next(request)
        # Enforce cache policy for all responses (proxies/CDNs should respect origin header)
        policy = getattr(settings, "cache_control_policy", "no-store")
        response.headers["Cache-Control"] = policy
        # Extra legacy headers that sometimes help intermediaries
        if policy in ("no-store", "no-cache", "private, max-age=0, must-revalidate"):
            response.headers.setdefault("Pragma", "no-cache")
            response.headers.setdefault("Expires", "0")
        return response