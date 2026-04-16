#
import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI

# Load .env file if it exists (development)
try:
    from dotenv import load_dotenv
    env_path = Path(".env")
    if env_path.exists():
        load_dotenv(env_path)
        logging.info(f"Loaded environment from {env_path}")
except ImportError:
    # python-dotenv not installed - expecting env vars from system/container
    pass

from .core.logging import configure_logging
from .config import settings
from .core.limiter import limiter
from .core.redis_client import init_redis, close_redis
from .core.exceptions import register_exception_handlers
from .core.middleware import register_middleware
from .routes.api import router as api_router
from .routes.internal import create_internal_router, register_docs_and_metrics_routes
from .routes.auth import router as auth_router
from .repos import RepositoryManager
from .core.database import SessionLocal
from .db.models import Server

logger = logging.getLogger("app.main")

def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title=settings.api_title,
        version=settings.api_version,
        description=settings.api_description,
        debug=settings.debug,
        docs_url=None,
        redoc_url=None,
    )

    @app.on_event("startup")
    async def on_startup():
        """
        Event handler for application startup.
        Initializes Redis and refreshes search indices.
        """
        # Initialize Redis connection
        if settings.redis_enabled:
            await init_redis(
                url=settings.redis_url,
                unix_socket_path=settings.redis_sock,
                password=settings.redis_password
            )

        logger.info("Application startup: Refreshing search indices...")
        db = SessionLocal()
        repos = RepositoryManager(db)
        try:
            servers = db.query(Server).all()
            if not servers:
                logger.warning("No servers found in the database. Skipping search index refresh.")
                return

            for server in servers:
                logger.info(f"Refreshing search indices for server: {server.name}")
                await repos.simple_items.refresh_simple_item_search_index(server.server_id, server.name)
                await repos.bonus_items.refresh_bonus_items_search_index(server.server_id, server.name)
                await repos.bonus_items.refresh_bonus_types_search_index(server.server_id, server.name)
                logger.info(f"Successfully refreshed indices for server: {server.name}")

        except Exception as e:
            logger.error(f"Failed to refresh search indices during startup: {e}", exc_info=True)
        finally:
            db.close()

    @app.on_event("shutdown")
    async def on_shutdown():
        await close_redis()

    # Set up rate limiter state
    if settings.rate_limit_enabled:
        app.state.limiter = limiter

    # Register all middleware
    register_middleware(app)

    # Register all exception handlers
    register_exception_handlers(app)

    # --- Create all routers first ---
    internal_router = create_internal_router(app)

    # --- Register API Routers ---
    # Auth router is at the root level (e.g., /auth/dashboard)
    app.include_router(auth_router)  # outside API v1
    # Main API router is prefixed with /api/v1
    app.include_router(api_router, prefix="/api/v1")
    # Internal router for cache invalidation etc.
    app.include_router(internal_router, prefix="/internal")

    # --- Register Docs & Metrics at the root level ---
    register_docs_and_metrics_routes(app)

    return app


app = create_app()
