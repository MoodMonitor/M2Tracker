import logging
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from ..config import settings
from .metrics import instrument_sqlalchemy_engine

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.database_url,
    pool_size=settings.pool_size,
    max_overflow=settings.max_overflow,
    pool_timeout=settings.pool_timeout,
    pool_recycle=settings.pool_recycle,
    pool_pre_ping=True,
    pool_use_lifo=True,
    pool_reset_on_return="rollback",
    connect_args={
        "connect_timeout": settings.connect_timeout_s,
        "read_timeout": settings.read_timeout_s,
        "write_timeout": settings.write_timeout_s,
    },
    future=True,
)


def _set_session_timeouts(dbapi_connection, _connection_record) -> None:
    """Set per-session MySQL timeouts when supported by the server.

    - MAX_EXECUTION_TIME applies to SELECT statements (ms).
    - innodb_lock_wait_timeout controls lock wait timeout (s).
    """
    try:
        with dbapi_connection.cursor() as cursor:
            try:
                cursor.execute(
                    f"SET SESSION MAX_EXECUTION_TIME={int(settings.statement_timeout_ms)}"
                )
            except Exception as e:
                logger.debug("Could not set MAX_EXECUTION_TIME: %s", e)

            try:
                cursor.execute(
                    f"SET SESSION innodb_lock_wait_timeout={int(settings.lock_wait_timeout_s)}"
                )
            except Exception as e:
                logger.debug("Could not set innodb_lock_wait_timeout: %s", e)
    except Exception as e:
        logger.debug("Could not configure session timeouts (cursor error): %s", e)


event.listen(engine, "connect", _set_session_timeouts)

if settings.metrics_enabled:
    try:
        instrument_sqlalchemy_engine(engine)
    except Exception as e:
        logger.debug("Could not enable SQLAlchemy metrics: %s", e)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.rollback()
        except Exception as e:
            logger.debug("DB rollback error: %s", e)

        try:
            db.close()
        except Exception as e:
            logger.warning("DB close error: %s", e)
