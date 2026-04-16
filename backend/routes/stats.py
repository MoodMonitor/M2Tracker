from typing import Dict, List
from datetime import timedelta

from fastapi import APIRouter, Query, Depends, Request
from sqlalchemy.orm import Session

from ..core.database import get_db
from .schemas import (
    Top10Response,
    Top10Entry,
    ShopWindowResponse,
    ShopDailyStatsOut,
    ShopDailyWindowStatsOut,
    ServerDailyWindowResponse,
    ServerDailyStatsOut,
)
from ..repos import RepositoryManager
from .utils.encryption import encrypted_json_response
from ..core.limiter import limiter
from .utils.cache import cached_endpoint
from .utils.common import get_server_or_404, validate_window_days, ensure_last_data_update, compute_anchor_dt

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get(
    "/24h",
    response_model=Top10Response,
    response_model_exclude_none=True,
    summary="Get 24h Top10 stats for a server (slimmed fields per metric)",
)
@cached_endpoint(server_name_param="server_name")
@limiter.limit("10/minute")
async def get_24h_stats(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    session: Session = Depends(get_db),
):
    """Return all 24h Top10 metrics for the latest snapshot relative to server's last update."""
    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)

    data = repos.stats.get_24h_top10_for(server.server_id, server.last_data_update)

    allow_map: Dict[str, set[str]] = {
        "price_up": {"rank", "item_name", "price_now", "price_prev", "change_abs", "change_pct"},
        "price_down": {"rank", "item_name", "price_now", "price_prev", "change_abs", "change_pct"},
        "amount_change_up": {"rank", "item_name", "amount_now", "amount_prev", "change_abs", "change_pct"},
        "amount_change_down": {"rank", "item_name", "amount_now", "amount_prev", "change_abs", "change_pct"},
        "shop_change_up": {"rank", "item_name", "shops_now", "shops_prev", "change_abs"},
        "shop_change_down": {"rank", "item_name", "shops_now", "shops_prev", "change_abs"},
    }

    payload: Dict[str, List[Top10Entry]] = {}
    for metric, items in data.items():
        allowed = allow_map.get(metric, set())
        filtered_items: List[Top10Entry] = []
        for item in items:
            filtered = {k: v for k, v in item.items() if k in allowed}
            filtered_items.append(Top10Entry(**filtered))
        payload[metric] = filtered_items

    return Top10Response(**payload)


@router.get(
    "/shops/daily-window",
    summary="Get shop window + baseline daily stats for a server and window day (encrypted)",
)
@limiter.limit("10/minute")
async def get_shop_window_and_daily_stats_encoded(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    window_day: int = Query(..., description="Window size in days (must be allowed for the server)"),
    session: Session = Depends(get_db),
):
    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)

    validate_window_days(repos, server, window_day, field_name="window_day")

    ensure_last_data_update(server)

    payload = await repos.stats.get_cached_shop_window_stats(
        server_name=server.name,
        server_id=server.server_id,
        last_data_update=server.last_data_update,
        window_day=window_day,
    )

    if not payload.get("baseline_daily_stats") and not payload.get("window_stats"):
        return await encrypted_json_response(request, {"window_stats": None, "baseline_daily_stats": []})

    return await encrypted_json_response(request, payload)


@router.get(
    "/servers/daily-window",
    response_model=ServerDailyWindowResponse,
    summary="Get server daily stats for a server over a window [anchor, last_update]",
)
@cached_endpoint(server_name_param="server_name")
@limiter.limit("10/minute")
async def get_server_daily_window_stats(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    window_day: int = Query(..., description="Window size in days (must be allowed for the server)"),
    session: Session = Depends(get_db),
):
    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)
    validate_window_days(repos, server, window_day)
    ensure_last_data_update(server)

    anchor_dt = server.last_data_update - timedelta(days=window_day)

    rows = repos.stats.get_server_daily_stats_range(
        server_id=server.server_id,
        start_dt=anchor_dt,
        end_dt=server.last_data_update,
    )

    resp: Dict[str, object] = {
        "stats": [
            ServerDailyStatsOut(
                date=r.date.strftime("%Y-%m-%d") if r.date else "",
                total_simple_items_amount=int(r.total_simple_items_amount) if r.total_simple_items_amount is not None else None,
                unique_simple_items_amount=int(r.unique_simple_items_amount) if r.unique_simple_items_amount is not None else None,
                total_bonus_items_amount=int(r.total_bonus_items_amount) if r.total_bonus_items_amount is not None else None,
                unique_bonus_items_amount=int(r.unique_bonus_items_amount) if r.unique_bonus_items_amount is not None else None,
            )
            for r in rows
        ],
    }

    return ServerDailyWindowResponse(**resp)
