
import json
import logging
import logging.config
from logging import Logger
from typing import Any, Dict, Optional
import os
from datetime import datetime, timezone
import contextvars

from ..config import settings

# Context variables populated per-request in middleware
request_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("request_id", default=None)
client_ip_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("client_ip", default=None)
path_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("path", default=None)
method_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("method", default=None)


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Attach contextvars to each record
        record.request_id = request_id_var.get()
        record.client_ip = client_ip_var.get()
        record.path = path_var.get()
        record.method = method_var.get()
        record.service = "backend"
        return True


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
            "client_ip": getattr(record, "client_ip", None),
            "path": getattr(record, "path", None),
            "method": getattr(record, "method", None),
            "module": record.module,
            "func": record.funcName,
            "line": record.lineno,
            "service": getattr(record, "service", None),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _ensure_dir_for(path: Optional[str]) -> None:
    if not path:
        return
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def configure_logging() -> None:
    fmt_console = "%(asctime)s %(levelname)-8s [%(request_id)s] %(name)s: %(message)s"
    filter_name = "context_filter"

    _ensure_dir_for(settings.log_file)

    handlers: Dict[str, Dict[str, Any]] = {
        "console": {
            "class": "logging.StreamHandler",
            "level": settings.log_level.upper(),
            "formatter": "json" if settings.log_json else "console",
            "filters": [filter_name],
        },
    }

    if settings.log_file:
        handlers["file"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "level": settings.log_level.upper(),
            "filename": settings.log_file,
            "maxBytes": getattr(settings, "log_max_bytes", 5 * 1024 * 1024),
            "backupCount": getattr(settings, "log_backup_count", 5),
            "encoding": "utf-8",
            "formatter": "json" if settings.log_json else "console",
            "filters": [filter_name],
        }

    formatters: Dict[str, Dict[str, Any]] = {
        "console": {"format": fmt_console},
        "json": {"()": JSONFormatter},
    }

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {filter_name: {"()": ContextFilter}},
            "formatters": formatters,
            "handlers": handlers,
            "loggers": {
                "uvicorn": {"level": "WARNING"},
                "uvicorn.access": {"level": "WARNING"},
                "sqlalchemy.engine": {"level": "WARNING"},
                # Application loggers
                "app.api": {"handlers": list(handlers.keys()), "level": settings.log_level.upper(), "propagate": False},
                "app.repo": {"handlers": list(handlers.keys()), "level": settings.log_level.upper(), "propagate": False},
                "app.db": {"handlers": list(handlers.keys()), "level": settings.log_level.upper(), "propagate": False},
                "app.security": {"handlers": list(handlers.keys()), "level": settings.log_level.upper(), "propagate": False},
                # Root fallback
                "": {"handlers": list(handlers.keys()), "level": settings.log_level.upper()},
            },
        }
    )


def get_logger(name: str) -> Logger:
    return logging.getLogger(name)
