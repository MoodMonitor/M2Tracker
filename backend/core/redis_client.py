from typing import Optional

from redis.asyncio import Redis
from redis.exceptions import RedisError

try:
    from fakeredis import aioredis as fakeredis
except ImportError:
    fakeredis = None

_redis: Optional[Redis] = None


async def init_redis(
    url: str | None = None,
    unix_socket_path: str | None = None,
    password: str | None = None,
) -> None:
    global _redis
    if _redis is not None:
        return

    # If no URL or socket is provided, fall back to in-memory Redis (tests/dev).
    if not url and not unix_socket_path:
        _redis = fakeredis.FakeRedis(decode_responses=True) if fakeredis else None
        return

    try:
        if unix_socket_path:
            _redis = Redis(
                unix_socket_path=unix_socket_path,
                password=password,
                decode_responses=True,
            )
        else:
            _redis = Redis.from_url(url, decode_responses=True)

        await _redis.ping()
    except (RedisError, OSError, TypeError, ValueError):
        try:
            if _redis:
                await _redis.close()
        except RedisError:
            pass
        _redis = None


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        try:
            await _redis.close()
        finally:
            _redis = None


def get_redis() -> Optional[Redis]:
    return _redis