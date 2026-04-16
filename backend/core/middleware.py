from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi.middleware import SlowAPIMiddleware

from ..config import settings
from ..middlewares.sig_verification import SigVerificationMiddleware
from ..middlewares.security_headers import SecurityHeadersMiddleware
from ..middlewares.cache import CacheControlMiddleware
from .metrics import MetricsMiddleware

def register_middleware(app: FastAPI):
    allow_origins = [o.strip() for o in settings.cors_allow_origins.split(',')] if settings.cors_allow_origins else []

    allow_credentials = bool(allow_origins) and "*" not in allow_origins

    allowed_headers = [
        "Content-Type",
        "Authorization",
        "X-Sig",
        "X-TS",
        "X-Nonce",
        "X-UA-Hash",
        "X-Client-Type", # For worker identification
        "X-SID",         # For worker session identification
        "X-ENC",
        "X-Client-Id",
        "X-Sw-Version",
        "x-sw-cache-status",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=allowed_headers,
        max_age=300,
        expose_headers=["X-Session-Expires-At", "X-Request-ID", "X-Process-Time", "X-Enc", "X-IV"],
    )

    # Rate limiting and security verification should come before general metrics.
    if settings.rate_limit_enabled:
        app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(SigVerificationMiddleware)

    if settings.metrics_enabled:
        app.add_middleware(MetricsMiddleware)

    app.add_middleware(CacheControlMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)