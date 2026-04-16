import logging
from http import HTTPStatus
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import TimeoutError as SATimeoutError, DBAPIError
from .request_utils import get_client_ip
from .metrics import RATE_LIMIT_HITS_TOTAL, PROMETHEUS_AVAILABLE

logger = logging.getLogger("app.api.errors")

class APIException(Exception):
    """Base exception for the application."""
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(self.detail)

class NotFoundException(APIException):
    """To be raised when a resource is not found (404)."""
    pass

class InvalidInputException(APIException):
    """To be raised for user input validation errors (400)."""
    pass


class ForbiddenError(APIException):
    """To be raised for authorization failures (403)."""
    pass

class ServiceUnavailableException(APIException):
    """To be raised when a dependent service is unavailable (503)."""
    pass


class AuthenticationError(APIException):
    """To be raised for authentication failures (401)."""
    pass


class ConflictError(APIException):
    """To be raised for resource conflicts (409), e.g., replay attacks."""
    pass


async def custom_rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """
    Global handler for 429 Too Many Requests.
    Returns a consistent JSON response instead of the default text,
    while preserving the 'Retry-After' header.
    """
    retry_after_seconds = exc.limit.limit.get_expiry()

    if PROMETHEUS_AVAILABLE:
        path = request.url.path
        RATE_LIMIT_HITS_TOTAL.labels(path=path).inc()

    detail_message = (
        "Rate limit exceeded. Please try again in "
        f"{retry_after_seconds} seconds."
    )
    response = JSONResponse(
        status_code=HTTPStatus.TOO_MANY_REQUESTS,
        content={"detail": detail_message},
    )
    response.headers["Retry-After"] = str(retry_after_seconds)
    if exc.headers:
        response.headers.update(exc.headers)
    return response


async def handle_sa_timeout(request: Request, exc: SATimeoutError):
    # Connection pool acquisition timeout and similar DB timeouts.
    return JSONResponse(
        status_code=HTTPStatus.GATEWAY_TIMEOUT,
        content={"detail": "Database timeout."},
    )


async def handle_dbapi_error(request: Request, exc: DBAPIError):
    code = None
    try:
        if getattr(exc, "orig", None) and getattr(exc.orig, "args", None):
            code = exc.orig.args[0]
    except (AttributeError, IndexError):
        code = None

    # Map common MySQL timeout/lock/deadlock errors to 503/504
    if code in (1205, 1213):  # lock wait timeout, deadlock
        return JSONResponse(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            content={"detail": "Database operation conflict. Please try again."},
        )
    if code in (2013, 2006):  # lost connection, server gone away
        return JSONResponse(
            status_code=HTTPStatus.GATEWAY_TIMEOUT,
            content={"detail": "Database connection timed out."},
        )

    logger.error(
        "Unhandled DBAPIError on path %s: %s",
        request.url.path,
        exc,
        exc_info=True,
        extra={
            "client_ip": get_client_ip(request),
            "db_error_code": code,
            "original_exception": str(getattr(exc, "orig", "N/A")),
        },
    )
    return JSONResponse(
        status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
        content={"detail": "A database error occurred."},
    )


_STATUS_DETAIL_MAP = {
    NotFoundException: (HTTPStatus.NOT_FOUND, "Resource not found."),
    InvalidInputException: (HTTPStatus.BAD_REQUEST, "Invalid input provided."),
    ServiceUnavailableException: (HTTPStatus.SERVICE_UNAVAILABLE, "Service temporarily unavailable."),
    AuthenticationError: (HTTPStatus.UNAUTHORIZED, "Authentication failed."),
    ConflictError: (HTTPStatus.CONFLICT, "A conflict occurred."),
    ForbiddenError: (HTTPStatus.FORBIDDEN, "Permission denied."),
}


async def api_exception_handler(request: Request, exc: APIException):
    """Generic handler for custom API exceptions to log details and return a generic response."""
    status_code, generic_detail = _STATUS_DETAIL_MAP.get(
        type(exc),
        (HTTPStatus.INTERNAL_SERVER_ERROR, "An internal server error occurred."),
    )

    logger.warning(
        "API exception on path %s: %s",
        request.url.path,
        exc.detail,
        extra={"client_ip": get_client_ip(request)},
    )
    return JSONResponse(status_code=status_code, content={"detail": generic_detail})


def register_exception_handlers(app: FastAPI):
    app.add_exception_handler(RateLimitExceeded, custom_rate_limit_exceeded_handler)
    app.add_exception_handler(SATimeoutError, handle_sa_timeout)
    app.add_exception_handler(DBAPIError, handle_dbapi_error)
    app.add_exception_handler(APIException, api_exception_handler)