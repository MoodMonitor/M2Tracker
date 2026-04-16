import time
import uuid
from typing import Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from ..core.logging import (
    get_logger,
    request_id_var,
    client_ip_var,
    path_var,
    method_var,
)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs each request with correlation ID, timings, and client data via contextvars.

    Adds headers:
      - X-Request-ID
      - X-Process-Time (ms)
    """

    def __init__(self, app):
        super().__init__(app)
        self.logger = get_logger("app.api")

    async def dispatch(self, request: Request, call_next: Callable):
        start = time.perf_counter()
        req_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        client_ip = request.client.host if request.client else "-"
        method = request.method
        path = request.url.path
        query = request.url.query
        ua = request.headers.get("user-agent", "-")
        referer = request.headers.get("referer") or request.headers.get("referrer") or "-"

        # Bind context
        token_req = request_id_var.set(req_id)
        token_ip = client_ip_var.set(client_ip)
        token_path = path_var.set(path)
        token_method = method_var.set(method)

        # Expose on state
        request.state.request_id = req_id

        status = 500
        resp_bytes = None
        response = None
        try:
            response = await call_next(request)
            status = response.status_code
            # Try to get response size
            resp_bytes = response.headers.get("content-length")
            return response
        except Exception:
            self.logger.exception(
                f"unhandled_exception method={method} path={path} client={client_ip} request_id={req_id}"
            )
            raise
        finally:
            dur_ms = int((time.perf_counter() - start) * 1000)
            self.logger.info(
                f"request method={method} path={path} qs={'?' + query if query else ''} status={status} "
                f"duration_ms={dur_ms} client={client_ip} user_agent={ua} referer={referer} bytes={resp_bytes}"
            )
            # Attempt to set headers if response exists in scope
            try:
                if response is not None:
                    response.headers["X-Request-ID"] = req_id
                    response.headers["X-Process-Time"] = str(dur_ms)
            except Exception:
                pass
            # Reset context
            request_id_var.reset(token_req)
            client_ip_var.reset(token_ip)
            path_var.reset(token_path)
            method_var.reset(token_method)
