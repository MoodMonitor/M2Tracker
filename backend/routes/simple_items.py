
from fastapi import APIRouter, Query, Depends, Request, HTTPException, status
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from ..core.database import get_db
from ..core.logging import get_logger
from .schemas import (
    ItemSuggestion,
    SimpleItemPriceQ10LastUpdateResponse,
    AICalculatorRequest,
    AICalculatorPriceOut,
)
from ..core.exceptions import NotFoundException
from ..repos import RepositoryManager, simple_items
from ..core.limiter import limiter
from .utils.common import normalize_query, get_server_or_404, validate_window_days, ensure_last_data_update, compute_anchor_dt
from .utils.encryption import partially_encrypted_json_response, encrypted_json_response

router = APIRouter(prefix="/simple_items", tags=["simple_items"])
logger = get_logger("app.api.simple_items")


@router.get(
    "/suggest",
    response_model=List[ItemSuggestion],
    summary="Suggest simple item names from simple_items_dictionary by substring (ILIKE)",
)
@limiter.limit("15/minute")
async def get_simple_item_name_suggestions(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    q: str = Query(..., min_length=3, max_length=64, description="Search query for item names (min 3 chars)"),
    limit: int = Query(10, ge=1, le=10, description="Max number of suggestions to return (up to 10)"),
    session: Session = Depends(get_db),
):
    q_norm = normalize_query(q, 3, 64, "Query too short; minimum 3 characters after trimming")

    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)

    results = await repos.simple_items.search_simple_item_names_from_redis(server.name, q_norm, limit=limit)
    return [ItemSuggestion(name=name, vid=vid) for name, vid in results]


@router.get(
    "/daily-window",
    summary="Get daily_simple_item_stats for a server, window, and specific item name (partially encrypted)",
)
@limiter.limit("7/minute")
async def get_simple_item_daily_window(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    window_day: int = Query(..., description="Window size in days (must be allowed for the server)"),
    item_vid: int = Query(..., description="The unique virtual ID of the item, obtained from the /suggest endpoint."),
    session: Session = Depends(get_db),
):
    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)

    validate_window_days(repos, server, window_day, field_name="window_day")

    ensure_last_data_update(server)

    item = repos.simple_items.get_simple_item_by_vid(server.server_id, item_vid)

    if not item:
        raise NotFoundException(f"Item with ID '{item_vid}' not found on server '{server_name}'.")

    # Best-effort search counter
    try:
        repos.simple_items.increment_search_count(server.server_id, item.vid)
    except SQLAlchemyError as exc:
        logger.warning("search_count_increment_failed server_id=%s item_vid=%s err=%s", server.server_id, item.vid, exc)

    anchor_dt = compute_anchor_dt(server.last_data_update, window_day)
    rows = repos.simple_items.get_simple_item_daily_stats_range(
        server_id=server.server_id,
        item_vid=item.vid,
        start_dt=anchor_dt,
        end_dt=server.last_data_update,
    )

    payload = {
        "stats": [
            {
                "date": r.date.strftime("%Y-%m-%d") if r.date else "",
                "price_q10": float(r.price_q10) if r.price_q10 is not None else None,
                "price_median": float(r.price_median) if r.price_median is not None else None,
                "item_amount": int(r.item_amount) if r.item_amount is not None else None,
                "shop_appearance_count": int(r.shop_appearance_count) if r.shop_appearance_count is not None else None,
            }
            for r in rows
        ],
    }

    return await partially_encrypted_json_response(
        request=request,
        content=payload,
        list_key="stats",
        plaintext_keys={"date"},
    )


@router.get(
    "/price-q10/last-update",
    response_model=SimpleItemPriceQ10LastUpdateResponse,
    summary="Get price_q10 for an item strictly at server.last_data_update",
)
@limiter.limit("10/minute")
async def get_simple_item_price_q10_last_update(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    item_vid: int = Query(..., description="The unique virtual ID of the item, obtained from the /suggest endpoint."),
    session: Session = Depends(get_db),
):
    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)
    ensure_last_data_update(server)

    prices_map = await repos.simple_items.get_cached_bulk_simple_item_prices_q10(
        server_name=server.name,
        server_id=server.server_id,
        at_dt=server.last_data_update,
        vids=[item_vid]
    )
    price_data = prices_map.get(item_vid)

    if not price_data or price_data[0] == "__NOT_FOUND__":
        raise NotFoundException(f"Item with ID '{item_vid}' not found on server '{server_name}'.")

    try:
        repos.simple_items.increment_search_count(server.server_id, item_vid)
    except SQLAlchemyError as exc:
        logger.warning("search_count_increment_failed server_id=%s item_vid=%s err=%s", server.server_id, item_vid, exc)

    price_q10 = price_data[1]
    return SimpleItemPriceQ10LastUpdateResponse(
        price_q10=price_q10,
    )


@router.post(
    "/ai-calculator/prices",
    summary="Get latest Q10 prices for a bulk list of simple items (by VID) for AI calculator. (Encrypted)",
)
@limiter.limit("2/minute")
async def get_ai_calculator_prices(
    request: Request,
    payload: AICalculatorRequest,
    session: Session = Depends(get_db),
):
    repos = RepositoryManager(session)

    if len(payload.items) > 45:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The number of items in a single request cannot exceed 45.",
        )
    server = await get_server_or_404(repos, payload.server_name)
    ensure_last_data_update(server)

    vids_to_fetch = [item.vid for item in payload.items if item.vid is not None and item.vid > 0]

    prices_by_vid = await repos.simple_items.get_cached_bulk_simple_item_prices_q10(
        server_name=server.name,
        server_id=server.server_id,
        at_dt=server.last_data_update,
        vids=vids_to_fetch,
    )

    response_list: List[AICalculatorPriceOut] = []
    for item_in in payload.items:
        if item_in.vid is not None:
            price_data = prices_by_vid.get(item_in.vid)
            if price_data:
                name_from_db, price = price_data
                if name_from_db != "__NOT_FOUND__":
                    response_list.append(AICalculatorPriceOut(vid=item_in.vid, name=name_from_db, price_q10=price))
                else:
                    response_list.append(
                        AICalculatorPriceOut(
                            vid=item_in.vid,
                            name=item_in.name or f"Unknown Item (VID: {item_in.vid})",
                            price_q10=None,
                        )
                    )
            else:
                response_list.append(
                    AICalculatorPriceOut(
                        vid=item_in.vid,
                        name=item_in.name or f"Unknown Item (VID: {item_in.vid})",
                        price_q10=None,
                    )
                )

    response_data = [item.model_dump() for item in response_list]
    return await encrypted_json_response(request=request, content=response_data)
