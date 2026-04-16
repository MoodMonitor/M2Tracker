import time
from typing import Iterable, Optional

from redis.asyncio import Redis

from ..config import settings


def build_search_key(server_name: str, index_type: str) -> str:
    return f"{settings.redis_prefix}:search:{server_name}:{index_type}"


def _as_str(value: str | bytes) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return value


def _capitalized_words(value: str) -> str:
    return " ".join(word.capitalize() for word in value.split())


async def scan_name_vid_index(
    redis: Redis,
    key: str,
    q: str,
    limit: Optional[int],
) -> list[tuple[str, int]]:
    q_lower = q.lower()
    results: list[tuple[str, int]] = []

    async for member, _score in redis.zscan_iter(key, match=f"*{q_lower}*"):
        try:
            name_lower, vid_str = _as_str(member).rsplit("::", 1)
            results.append((_capitalized_words(name_lower), int(vid_str)))
            if limit is not None and len(results) >= limit:
                break
        except (TypeError, ValueError):
            continue

    results.sort()
    if limit is not None:
        return results[:limit]
    return results


async def scan_names_index(
    redis: Redis,
    key: str,
    q: str,
    limit: int,
) -> list[str]:
    q_lower = q.lower()
    results: list[str] = []

    async for member, _score in redis.zscan_iter(key, match=f"*{q_lower}*"):
        results.append(_capitalized_words(_as_str(member)))
        if len(results) >= limit:
            break

    results.sort()
    return results


async def rebuild_name_vid_index(
    redis: Redis,
    key: str,
    values: Iterable[tuple[str, int]],
    chunk_size: int,
) -> int:
    temp_key = f"{key}:temp:{int(time.time())}"

    count = 0
    pipe = redis.pipeline()
    for name, vid in values:
        member = f"{name.lower()}::{vid}"
        pipe.zadd(temp_key, {member: 0})
        count += 1
        if count % chunk_size == 0:
            await pipe.execute()
            pipe = redis.pipeline()

    if count % chunk_size != 0:
        await pipe.execute()

    if count == 0:
        await redis.delete(key)
        return 0

    await redis.rename(temp_key, key)
    return count


async def rebuild_names_index(
    redis: Redis,
    key: str,
    values: Iterable[str],
) -> int:
    normalized = [name.lower() for name in values]
    if not normalized:
        await redis.delete(key)
        return 0

    temp_key = f"{key}:temp:{int(time.time())}"
    pipe = redis.pipeline()
    pipe.zadd(temp_key, {name: 0 for name in normalized})
    await pipe.execute()
    await redis.rename(temp_key, key)
    return len(normalized)
