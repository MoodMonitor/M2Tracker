import os
import time
from datetime import datetime

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.db.models import (
    Base,
    Server,
    SimpleItemDictionary,
    BonusItemDictionary,
    BonusTypesDictionary,
)


def _wait_for_mysql(db_url: str, timeout_s: int = 60) -> None:
    engine = create_engine(db_url, pool_pre_ping=True)
    deadline = time.time() + timeout_s
    last_exc: Exception | None = None
    while time.time() < deadline:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except Exception as e:
            last_exc = e
            time.sleep(1)
    raise RuntimeError(f"MySQL not ready after {timeout_s}s: {last_exc}")


@pytest.fixture(scope="session")
def test_env() -> dict:
    """Env vars for integration tests. Must be set before importing backend app modules."""
    return {
        "ENVIRONMENT": "test",
        "DEBUG": "true",
        "RATE_LIMIT_ENABLED": "false",
        "METRICS_ENABLED": "false",
        "INTERNAL_API_KEY": "test-internal-key",
        "SECURE_PATHS": "",  # disable signature/session middleware for integration tests
        "REDIS_ENABLED": "true",
        "REDIS_URL": os.getenv("TEST_REDIS_URL", "redis://127.0.0.1:6380/0"),
        "DB_URL": os.getenv(
            "TEST_DB_URL",
            "mysql+pymysql://root:root@127.0.0.1:3307/m2tracker_test?charset=utf8mb4",
        ),
        "REDIS_PREFIX": "dbmp_test",
    }


@pytest.fixture(scope="session", autouse=True)
def _apply_test_env(test_env: dict):
    for k, v in test_env.items():
        os.environ[k] = str(v)


@pytest.fixture(scope="session")
def db_url(test_env: dict) -> str:
    return test_env["DB_URL"]


@pytest.fixture(scope="session")
def db_engine(db_url: str):
    _wait_for_mysql(db_url)
    engine = create_engine(db_url, future=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db_session(db_engine):
    SessionLocal = sessionmaker(
        bind=db_engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _clean_db(db_session):
    db_session.execute(text("SET FOREIGN_KEY_CHECKS=0"))
    for tbl in reversed(Base.metadata.sorted_tables):
        db_session.execute(text(f"TRUNCATE TABLE {tbl.name}"))
    db_session.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    db_session.commit()


@pytest.fixture()
def seed_minimal_data(db_session):
    now = datetime.utcnow().replace(microsecond=0)
    server = Server(
        name="TestServer",
        status=True,
        type="test",
        created_at=now,
        last_data_update=now,
        allowed_windows=[14],
    )
    db_session.add(server)
    db_session.flush()  # get server_id

    # minimal dictionaries to build redis indices
    simple_items = [
        SimpleItemDictionary(
            server_id=server.server_id, vid=1001, name="Zelazny Miecz", search_count=0
        ),
        SimpleItemDictionary(
            server_id=server.server_id, vid=1002, name="Srebrny Miecz", search_count=0
        ),
    ]
    bonus_items = [
        BonusItemDictionary(
            server_id=server.server_id, vid=2001, name="Niebieski Koral", search_count=0
        ),
        BonusItemDictionary(
            server_id=server.server_id, vid=2002, name="Czerwony Koral", search_count=0
        ),
    ]
    bonus_types = [
        BonusTypesDictionary(server_id=server.server_id, name="Siła"),
        BonusTypesDictionary(server_id=server.server_id, name="Witalność"),
    ]

    db_session.add_all(simple_items + bonus_items + bonus_types)
    db_session.commit()
    return server


@pytest.fixture()
def app(seed_minimal_data):
    from backend.main import create_app

    return create_app()


@pytest.fixture()
async def client(app):
    import httpx
    await app.router.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await app.router.shutdown()
