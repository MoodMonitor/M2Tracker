from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from typing import Callable

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds common security headers to all responses.
    """
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

        # Conservative CSP baseline; adjust when frontend requirements change.
        csp_policy = (
            "default-src 'self';"
            "script-src 'self';"
            "style-src 'self' 'unsafe-inline';"
            "img-src 'self' data:;"
            "object-src 'none';"
            "frame-ancestors 'none';"
            "form-action 'self';"
            "base-uri 'self';"
        )
        response.headers.setdefault("Content-Security-Policy", csp_policy)

        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

        return response