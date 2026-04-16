import functools
import hashlib
import json
from typing import Callable
import asyncio

from fastapi import Request, Response
from fastapi.encoders import jsonable_encoder

from ...config import settings
from ...core.logging import get_logger
from ...core.redis_client import get_redis

logger = get_logger("app.api.cache")

DEFAULT_CACHE_TTL_S = 60 * 60 * 1

def _generate_cache_key(
    func_name: str,
    query_params: dict,
    body_payload: dict = None,
    server_name: str = None,
) -> str:
    """Build a stable cache key from query params and optional body payload."""
    # Sort params to keep the key stable across dict ordering.
    sorted_params = sorted(query_params.items())

    if body_payload:
        sorted_params.extend(sorted(body_payload.items()))

    params_str = json.dumps(sorted_params, separators=(",", ":"))

    # Hash to keep the key short.
    params_hash = hashlib.sha256(params_str.encode("utf-8")).hexdigest()[:16]

    if server_name:
        return f"{settings.redis_prefix}:cache:{server_name}:{func_name}:{params_hash}"
    return f"{settings.redis_prefix}:cache:global:{func_name}:{params_hash}"


def cached_endpoint(
    server_name_param: str = "server_name",
    ttl_s: int = DEFAULT_CACHE_TTL_S,
    global_cache: bool = False,
):
    """Cache endpoint responses in Redis with active invalidation."""
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(request: Request, *args, **kwargs):
            redis = get_redis()
            if not redis or not settings.redis_enabled:
                logger.warning("Redis is unavailable, skipping cache.")
                return await func(request, *args, **kwargs)

            query_params = dict(request.query_params)
            body_payload = kwargs.get("payload")

            if global_cache:
                cache_key = _generate_cache_key(
                    func_name=func.__name__,
                    query_params=query_params,
                    body_payload=body_payload.dict() if body_payload else None,
                )
            else:
                server_name: str = kwargs.get(server_name_param)
                if not server_name:
                    logger.error(
                        f"Cache decorator on '{func.__name__}' could not find '{server_name_param}' in kwargs."
                    )
                    return await func(request, *args, **kwargs)

                cache_key = _generate_cache_key(
                    func_name=func.__name__,
                    query_params=query_params,
                    body_payload=body_payload.dict() if body_payload else None,
                    server_name=server_name,
                )

            try:
                cached_response = await redis.get(cache_key)
                if cached_response:
                    logger.info(f"Cache HIT for endpoint {func.__name__} with key {cache_key}")
                    return Response(content=cached_response, media_type="application/json")
            except Exception as e:
                logger.error(f"Redis GET failed for key {cache_key}: {e}. Proceeding without cache.")
                return await func(request, *args, **kwargs)

            logger.debug(f"Cache MISS for key: {cache_key}")

            lock_key = f"{cache_key}:lock"
            lock_acquired = await redis.set(lock_key, "1", ex=10, nx=True)

            if lock_acquired:
                logger.debug(f"Lock acquired for key: {lock_key}. Regenerating cache.")
                try:
                    response_content = await func(request, *args, **kwargs)

                    if isinstance(response_content, Response):
                        if response_content.media_type == "application/json":
                            response_body = response_content.body
                            await redis.set(cache_key, response_body, ex=ttl_s)
                        return response_content

                    json_compatible_content = jsonable_encoder(response_content)
                    response_body_str = json.dumps(
                        json_compatible_content,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                    await redis.set(cache_key, response_body_str, ex=ttl_s)
                    return Response(content=response_body_str, media_type="application/json")
                finally:
                    await redis.delete(lock_key)
            else:
                logger.debug(
                    f"Could not acquire lock for {lock_key}, waiting for cache to be populated."
                )
                for _ in range(25):
                    await asyncio.sleep(0.2)
                    cached_response = await redis.get(cache_key)
                    if cached_response:
                        logger.info(
                            f"Cache populated by another process. Serving from cache for key {cache_key}"
                        )
                        return Response(content=cached_response, media_type="application/json")

                logger.warning(
                    f"Waited for cache on key {cache_key}, but it was not populated. Serving request without cache."
                )
                return await func(request, *args, **kwargs)

        return wrapper
    return decorator