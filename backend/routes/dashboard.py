from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..repos import RepositoryManager, ServerRepository
from .schemas import DashboardInitResponse, ServerInfoOut
from .utils.common import get_server_or_404
from .utils.cache import cached_endpoint
from ..core.request_utils import get_client_ip
from ..core.limiter import limiter


router = APIRouter(prefix="/dashboard", tags=["dashboard"])

def _format_created_at(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.date().isoformat()


def _format_last_update(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    # subtract 1 hour, then floor to full hour
    adj = (dt - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    return adj.strftime("%Y-%m-%d %H:%M")


@router.get(
    "/init",
    response_model=DashboardInitResponse,
    summary="Initialize dashboard: current server info and other server names",
)
@cached_endpoint(server_name_param="server_name", ttl_s=60 * 10)
@limiter.limit("10/minute")
async def init_dashboard(
    request: Request,
    server_name: str = Query(..., description="Exact server name from servers.name"),
    db: Session = Depends(get_db),
):
    repos = RepositoryManager(db)

    server = await get_server_or_404(repos, server_name)

    currencies = repos.servers.get_currencies_for_server(server.server_id)

    server_info = ServerInfoOut(
        name=server.name,
        status=bool(server.status),
        type=server.type,
        currencies=[
            {"name": c.name, "symbol": c.symbol, "threshold": c.threshold} for c in currencies
        ],
        discord_url=server.discord_url,
        forum_url=server.forum_url,
        website_url=server.website_url,
        description=server.description,
        created_at=_format_created_at(server.created_at),
        last_data_update=_format_last_update(server.last_data_update),
    )

    other_servers = repos.servers.list_other_server_names(server.name)

    return DashboardInitResponse(
        server=server_info,
        other_servers=other_servers,
    )


def get_ping_key(request: Request) -> str:
    """
    Creates a unique key for rate limiting based on client IP and server name.
    This allows per-user, per-server rate limiting.
    """
    ip = get_client_ip(request) or "unknown_ip"
    server_name = request.query_params.get("server_name", "unknown_server")
    return f"{ip}:{server_name}"


@router.post(
    "/ping",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Signal a user visit to increment the dashboard view counter.",
)
@limiter.limit("1/5minutes", key_func=get_ping_key)  # Limit to one ping per user/server every 5 minutes
async def ping_dashboard(
    request: Request,
    server_name: str = Query(..., description="Exact server name from servers.name"),
    db: Session = Depends(get_db),
):
    """
    A lightweight, non-cached endpoint for the frontend to signal an active user session.
    Its primary purpose is to increment the dashboard view counter.
    It is rate-limited to prevent abuse.
    """
    repos = RepositoryManager(db)
    server = await get_server_or_404(repos, server_name)

    repos.servers.increment_dashboard_views(server.server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
