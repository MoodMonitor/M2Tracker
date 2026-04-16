from fastapi import APIRouter, Query, Depends, Request
from typing import List, Optional
from datetime import timedelta
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.limiter import limiter
from .schemas import (
    ItemSuggestion,
    BonusTypeSuggestionResponse,
    BonusItemSearchRequest,
    BonusItemSearchResponse,
    BonusItemSightingOut,
    BonusValueOut,
)
from ..core.exceptions import InvalidInputException
from ..repos import RepositoryManager
from .utils.common import normalize_query, get_server_or_404, validate_window_days, ensure_last_data_update

router = APIRouter(prefix="/bonus_items", tags=["bonus_items"])


@router.get(
    "/suggest",
    response_model=List[ItemSuggestion],
    summary="Suggest bonus item names from bonus_items_dictionary by substring (ILIKE)",
)
@limiter.limit("10/minute")
async def get_bonus_item_name_suggestions(
    request: Request,
    server_name: str,
    q: str = Query(..., min_length=1, max_length=64, description="Substring to search for (min 2 chars after trim)"),
    limit: int = Query(10, ge=1, le=15),
    session: Session = Depends(get_db),
):
    q_norm = normalize_query(q, 2, 64, "Query too short; min length is 2 characters after trim")

    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)

    results = await repos.bonus_items.search_bonus_item_names_from_redis(server.name, q_norm, limit=limit)
    return [ItemSuggestion(name=name, vid=vid) for name, vid in results]


@router.get(
    "/bonus-types/suggest",
    response_model=BonusTypeSuggestionResponse,
    summary="Suggest bonus type names from bonus_types_dictionary by substring (ILIKE)",
)
@limiter.limit("10/minute")
async def suggest_bonus_types(
    request: Request,
    server_name: str = Query(..., description="Server name, exact match from servers.name"),
    q: str = Query(..., min_length=1, max_length=64, description="Substring to search for (min 2 chars after trim)"),
    limit: int = Query(10, ge=1, le=10, description="Max number of suggestions to return (up to 10)"),
    session: Session = Depends(get_db),
):
    q_norm = normalize_query(q, 2, 64, "Query too short; minimum 2 characters after trimming")

    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, server_name)

    suggestions = await repos.bonus_items.search_bonus_type_names_from_redis(server.name, q_norm, limit=limit)

    return BonusTypeSuggestionResponse(suggestions=suggestions)


@router.post(
    "/search",
    response_model=BonusItemSearchResponse,
    summary="Search bonus item sightings with optional item substring, bonus filters, and sorting within a window",
)
@limiter.limit("10/minute")
async def search_bonus_items(
    request: Request,
    payload: BonusItemSearchRequest,
    session: Session = Depends(get_db),
):
    repos = RepositoryManager(session)
    server = await get_server_or_404(repos, payload.server_name)

    validate_window_days(repos, server, payload.window_days, field_name="window_days")

    ensure_last_data_update(server)

    # Sorting validation
    sort_by_norm = (payload.sort_by or "last_seen").lower()
    # Backward compatibility: map 'date' -> 'last_seen'
    if sort_by_norm == "date":
        sort_by_norm = "last_seen"
    allowed_sort_by = {"last_seen", "price", "amount"}
    if sort_by_norm not in allowed_sort_by:
        raise InvalidInputException(f"Invalid sort_by value: '{payload.sort_by}'. Allowed: {allowed_sort_by}")
    sort_dir_norm = (payload.sort_dir or "desc").lower()
    if sort_dir_norm not in {"asc", "desc"}:
        raise InvalidInputException(f"Invalid sort_dir value: '{payload.sort_dir}'. Allowed: asc, desc")

    # Time window
    end_dt = server.last_data_update
    anchor_dt = end_dt - timedelta(days=payload.window_days)

    # Prepare filters
    filt_tuples = []
    for f in payload.filters or []:
        op = (f.op or "gte").lower()
        if op == "=":
            op = "eq"
        allowed_ops = {"gt", "gte", "lt", "lte", "eq"}
        if op not in allowed_ops:
            raise InvalidInputException(f"Invalid filter operator: '{f.op}'. Allowed: {allowed_ops}")
        name = (f.name or "").strip()
        if not name:
            raise InvalidInputException("Filter name must not be empty.")
        filt_tuples.append((name, op, int(f.value)))

    item_q_norm = (payload.q or "").strip() if payload.q else None
    item_vids_from_redis: Optional[List[int]] = None

    # --- OPTIMIZATION ---
    # If the user is searching by name (q) and not by a specific VID,
    # first use Redis to find the matching VIDs.
    if item_q_norm and payload.item_vid is None:
        # Retrieve ALL matching VIDs without limit, so that sorting by price/amount works correctly.
        # Passing `limit=None` to the repository method removes the restriction.
        redis_results = await repos.bonus_items.search_bonus_item_names_from_redis(
            server.name, item_q_norm, limit=None
        )
        item_vids_from_redis = [vid for name, vid in redis_results]

        # If Redis found nothing, we can immediately return an empty response.
        if not item_vids_from_redis:
            return BonusItemSearchResponse(count=0, has_more=False, results=[])

    # Fetch one extra row to determine if there's a next page
    fetch_limit = repos._sanitize_limit(payload.limit + 1, 1, 16)
    rows = repos.bonus_items.search_bonus_item_sightings(
        server_id=server.server_id,
        start_dt=anchor_dt,
        end_dt=end_dt,
        item_q=item_q_norm,
        item_vid=payload.item_vid,
        item_vids=item_vids_from_redis,
        filters=filt_tuples,
        sort_by=sort_by_norm,
        sort_dir=sort_dir_norm,
        limit=fetch_limit,
        offset=payload.offset,
    )

    # Determine has_more and slice to requested limit
    has_more = len(rows) > payload.limit
    rows_page = rows[:payload.limit]
    # Fetch bonuses per combination_id for the page and attach to results
    comb_ids = [int(r[7]) for r in rows_page if r[7] is not None]
    bonuses_map = repos.bonus_items.get_bonuses_for_combinations(comb_ids)
    results = []
    for r in rows_page:
        comb_id = int(r[7]) if r[7] is not None else None
        bonuses_list = [
            BonusValueOut(name=b_name, value=b_val)
            for (b_name, b_val) in bonuses_map.get(comb_id, [])
        ] if comb_id is not None else []
        results.append(
            BonusItemSightingOut(
                price=float(r[1]) if r[1] is not None else 0.0,
                item_count=int(r[2]) if r[2] is not None else 0,
                item_name=str(r[6]) if r[6] is not None else "",
                last_seen=(r[4].date().isoformat() if r[4] is not None else ""),
                bonuses=bonuses_list,
            )
        )
    return BonusItemSearchResponse(
        count=len(results),
        has_more=has_more,
        results=results,
    )
