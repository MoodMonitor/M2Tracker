import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def init_logger(logs_path, log_file_name, max_history_files=2, include_thread_name=False):
    """Create a reusable logger with stream + rotating file handlers."""
    logs_dir = Path(logs_path)
    logs_dir.mkdir(parents=True, exist_ok=True)

    log_filename = f"{log_file_name}.log" if not str(log_file_name).endswith(".log") else str(log_file_name)
    log_file_path = logs_dir / log_filename

    logger_name = f"logger.{log_file_name}"
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if logger.handlers:
        return logger

    log_format = "%(asctime)s | %(levelname)s | %(name)s"
    if include_thread_name:
        log_format += " | %(threadName)s"
    log_format += " | %(message)s"
    formatter = logging.Formatter(log_format)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        log_file_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=max_history_files,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)
    return logger