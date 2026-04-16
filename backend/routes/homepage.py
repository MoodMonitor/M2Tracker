from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..config import settings
from ..core.limiter import limiter
from ..core.redis_client import get_redis
from .utils.cache import cached_endpoint
from ..repos import RepositoryManager
from .auth import _verify_turnstile
from .schemas import HomepageInitResponse, HomeServerOut, UpdateItemOut, VoteServerOut, VoteRequest, VoteResponse


router = APIRouter(prefix="/homepage", tags=["homepage"])

async def _invalidate_homepage_cache():
    """Remove cached entries for /homepage/init."""
    redis = get_redis()
    if redis:
        async for key in redis.scan_iter(f"{settings.redis_prefix}:cache:global:homepage_init:*"):
            await redis.delete(key)


def _humanize_last_update(dt: datetime | None, now: datetime | None = None) -> str | None:
    if not dt:
        return None
    now = now or datetime.utcnow()
    d_today = now.date()
    d_item = dt.date()
    if d_item == d_today:
        return "dzisiaj"
    if d_item == (d_today - timedelta(days=1)):
        return "wczoraj"
    days = (d_today - d_item).days
    if days < 0:
        return "dzisiaj"
    return f"{days} dni temu"


@router.get("/init", response_model=HomepageInitResponse, summary="Homepage bootstrap data")
@cached_endpoint(global_cache=True, ttl_s=60 * 60)
@limiter.limit("7/minute")
async def homepage_init(request: Request, session: Session = Depends(get_db)):
    repos = RepositoryManager(session)
    rows = repos.servers.list_all_servers_basic()
    rows = sorted(rows, key=lambda r: r[0])
    servers: List[HomeServerOut] = []
    for server_id, name, status, type_, created_at, last_data_update in rows:
        servers.append(
            HomeServerOut(
                name=name,
                status=bool(status),
                type=type_,
                created_at=created_at.date().isoformat() if created_at else None,
                last_data_update_human=_humanize_last_update(last_data_update),
            )
        )

    update_rows = repos.get_latest_updates(limit=10)
    updates: List[UpdateItemOut] = [
        UpdateItemOut(
            type=str(u.type),
            id=int(u.entry_id),
            content=str(u.content) if u.content else "",
            title=str(u.title),
            created_at=u.created_at.date().isoformat(),
        )
        for u in update_rows
    ]

    response_model = HomepageInitResponse(servers=servers, updates=updates)
    return response_model


@router.get("/vote-servers", response_model=List[VoteServerOut], summary="Get list of servers for voting")
@cached_endpoint(global_cache=True, ttl_s=60 * 5)
@limiter.limit("7/minute")
async def get_vote_servers(request: Request, session: Session = Depends(get_db)):
    """
    Returns a list of servers available for voting, sorted by total votes.
    This data is cached for a short period due to frequent updates.
    """
    repos = RepositoryManager(session)
    vote_rows = repos.servers.list_vote_servers()
    vote_rows = sorted(vote_rows, key=lambda r: int(r[2] or 0), reverse=True)
    vote_servers = [
        VoteServerOut(name=str(name), total_votes=int(total_votes or 0))
        for (_id, name, total_votes, _last_vote_at, _created_at) in vote_rows
    ]
    return vote_servers


@router.post("/vote", response_model=VoteResponse, summary="Vote for one or multiple servers (1 per day per IP)")
@limiter.limit("1/day")
async def vote_servers(
    request: Request,
    payload: VoteRequest,
    session: Session = Depends(get_db),
) -> VoteResponse:
    """
    Allows a user (identified by IP) to vote once per day.
    The rate limiting is handled by the slowapi decorator.
    """
    repos = RepositoryManager(session)

    await _verify_turnstile(request, payload.turnstile_token, "", use_invisible=True)

    try:
        voted_count = repos.servers.increment_votes_for(payload.servers)
        return VoteResponse(allowed=True, voted_count=int(voted_count), retry_after_seconds=None)
    except Exception:
        raise
