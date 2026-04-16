from fastapi import APIRouter, Depends, FastAPI, Request, Response, status, Body
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse
from typing import List
from sqlalchemy.orm import Session

from ..config import settings
from ..core.database import get_db
from ..core.redis_client import get_redis
from ..core.metrics import (
    metrics_endpoint,
    metrics_summary_endpoint,
    metrics_ui_endpoint,
    set_metrics_ignore_paths,
)
from .homepage import _invalidate_homepage_cache
from ..core.security import verify_api_key
from ..repos import RepositoryManager, ServerRepository


def create_internal_router(app: FastAPI) -> APIRouter:
    """Creates and configures the router for internal, protected endpoints."""
    router = APIRouter(
        tags=["internal"],
        dependencies=[Depends(verify_api_key)],
        include_in_schema=False
    )

    @router.post("/cache/invalidate-all", status_code=status.HTTP_204_NO_CONTENT)
    async def invalidate_all_cache(
        request: Request,
        server_names: List[str] = Body(None, embed=True, description="Optional list of server names to invalidate cache for."),
        invalidate_global: bool = Body(False, embed=True, description="Set to true to invalidate global caches like homepage.")
    ):
        """
        Invalidates all caches. Can target specific servers or global caches.

        - If `server_names` is provided, it invalidates all cache entries for those servers.
          It will also invalidate the global homepage cache as it contains server data.
        - If `invalidate_global` is true, it invalidates all global caches.
        """
        redis = get_redis()
        if not redis:
            return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content="Redis is not available.")

        if server_names:
            # Invalidate cache for specified servers
            for server_name in server_names:
                async for key in redis.scan_iter(f"{settings.redis_prefix}:cache:{server_name}:*"):
                    await redis.delete(key)
                await ServerRepository.invalidate_server_cache(server_name)

        if invalidate_global:
            # Invalidate all global keys
            async for key in redis.scan_iter(f"{settings.redis_prefix}:cache:global:*"):
                await redis.delete(key)

        # Refresh the homepage when cache contents change
        if server_names or invalidate_global:
            await _invalidate_homepage_cache()

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/cache/refresh-search-indices", status_code=status.HTTP_200_OK)
    async def refresh_search_indices(
        request: Request,
        server_names: List[str] = Body(..., embed=True, description="List of server names to refresh search indices for."),
        session: Session = Depends(get_db)
    ):
        """
        Refreshes the Redis search indices for item and bonus names for the specified servers.
        This is a potentially long-running operation.
        """
        repos = RepositoryManager(session)
        results = {}

        for server_name in server_names:
            server = await repos.servers.get_by_name(server_name)
            if not server:
                results[server_name] = {"status": "error", "reason": "Server not found"}
                continue

            server_results = {}
            # Refresh indices for simple_items
            simple_res = await repos.simple_items.refresh_simple_item_search_index(server.server_id, server.name)
            server_results["simple_items"] = simple_res

            # Refresh indices for bonus_items
            bonus_items_res = await repos.bonus_items.refresh_bonus_items_search_index(server.server_id, server.name)
            server_results["bonus_items"] = bonus_items_res

            # Refresh indices for bonus_types
            bonus_types_res = await repos.bonus_items.refresh_bonus_types_search_index(server.server_id, server.name)
            server_results["bonus_types"] = bonus_types_res
            results[server_name] = server_results

        return results

    return router


def register_docs_and_metrics_routes(app: FastAPI):
    """
    Registers documentation (Swagger, ReDoc) and metrics endpoints directly on the app.
    These are protected by the internal API key.
    """
    if settings.metrics_enabled:
        base = settings.metrics_path.rstrip("/") or "/metrics"
        app.add_api_route(base, metrics_endpoint, tags=["internal"], dependencies=[Depends(verify_api_key)])
        app.add_api_route(f"{base}/summary", metrics_summary_endpoint, tags=["internal"], dependencies=[Depends(verify_api_key)])
        app.add_api_route(f"{base}/ui", metrics_ui_endpoint, tags=["internal"], dependencies=[Depends(verify_api_key)])
        try:
            set_metrics_ignore_paths([base, "/favicon.ico"])
        except Exception:
            pass

    @app.get("/docs", tags=["internal"], dependencies=[Depends(verify_api_key)], include_in_schema=False)
    async def custom_swagger_ui_html():
        response = get_swagger_ui_html(
            openapi_url=app.openapi_url, title=app.title + " - Swagger UI"
        )

        csp_policy = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
            "img-src 'self' data: fastapi.tiangolo.com;"
        )
        response.headers["Content-Security-Policy"] = csp_policy
        return response

    @app.get("/redoc", tags=["internal"], dependencies=[Depends(verify_api_key)], include_in_schema=False)
    async def redoc_html():
        return get_redoc_html(openapi_url=app.openapi_url, title=app.title + " - ReDoc")

    app.openapi_url = "/openapi.json"
    @app.get(app.openapi_url, tags=["internal"], dependencies=[Depends(verify_api_key)], include_in_schema=False)
    async def get_open_api_endpoint():
        return get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)