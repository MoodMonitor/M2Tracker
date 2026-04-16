from datetime import datetime
import json
from typing import List, Optional, Tuple, Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from .base import BaseRepository, timed_operation
from ..db.models import Server, ServerVotes, ServerCurrency
from ..core.redis_client import get_redis
from ..config import settings


def _get_cache_key(server_name: str) -> str:
    """Return the Redis cache key for server metadata."""
    return f"{settings.redis_prefix}:cache:{server_name}:server_meta"

class MockServer:
    """
    Stand-in for a Server object when loaded from cache.
    All attributes, including `last_data_update`, come from cache.
    The `currencies` relationship is not cached and can be loaded separately.
    """
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        self.currencies = []

    def to_json(self) -> str:
        """Serialize to JSON, including 'last_data_update'."""
        return json.dumps({
            "server_id": self.server_id,
            "name": self.name,
            "status": self.status,
            "type": self.type,
            "discord_url": getattr(self, 'discord_url', None),
            "forum_url": getattr(self, 'forum_url', None),
            "website_url": getattr(self, 'website_url', None),
            "description": getattr(self, 'description', None),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_data_update": self.last_data_update.isoformat() if self.last_data_update else None,
            "allowed_windows": getattr(self, 'allowed_windows', None),
        })

    @classmethod
    def from_cached_json(cls, data: str) -> "MockServer":
        """Create a MockServer instance from cached JSON."""
        obj_data = json.loads(data)
        if obj_data.get("created_at"):
            obj_data["created_at"] = datetime.fromisoformat(obj_data["created_at"])
        if obj_data.get("last_data_update"):
            obj_data["last_data_update"] = datetime.fromisoformat(obj_data["last_data_update"])
        return cls(**obj_data)

class ServerRepository(BaseRepository):
    def __init__(self, db: Session):
        super().__init__(db)
        self._request_cache: dict[str, Server | None] = {}

    def _serialize_real_server(self, server: Server) -> str:
        """Serialize a SQLAlchemy Server using the same shape as MockServer."""
        return MockServer(**server.__dict__).to_json()

    @timed_operation
    def get_id_by_name(self, name: str) -> Optional[int]:
        return self.db.execute(select(Server.server_id).where(Server.name == name)).scalar_one_or_none()

    @timed_operation
    def list_other_server_names(self, current_name: str) -> List[str]:
        stmt = select(Server.name).where(Server.name != current_name).order_by(Server.name.asc())
        return self.db.execute(stmt).scalars().all()

    def allowed_windows_set(self, server: Server) -> set:
        try:
            return set(server.allowed_windows or [])
        except TypeError:
            return set()

    def is_window_allowed(self, server: Server, window_day: int) -> bool:
        allowed = self.allowed_windows_set(server)
        return (window_day in allowed) if allowed else True

    def _increment_vote_counts(self, names: List[str], now: datetime) -> int:
        if not names:
            return 0
        cleaned = self._dedupe_trimmed_strings(names, max_items=20)
        if not cleaned:
            return 0

        existing_rows = self.db.execute(select(ServerVotes).where(ServerVotes.name.in_(cleaned))).scalars().all()
        existing_names = {r.name for r in existing_rows}

        if existing_names:
            self.db.execute(
                update(ServerVotes)
                .where(ServerVotes.name.in_(list(existing_names)))
                .values(total_votes=ServerVotes.total_votes + 1, last_vote_at=now)
            )

        for name in cleaned:
            if name not in existing_names:
                self.db.add(ServerVotes(name=name, total_votes=1, last_vote_at=now, created_at=now))

        return len(cleaned)

    @timed_operation
    def increment_votes_for(self, server_names: List[str]) -> int:
        now = datetime.utcnow()
        with self.transaction():
            count = self._increment_vote_counts(server_names, now)
            return count

    @timed_operation
    def list_all_servers_basic(self) -> List[Tuple]:
        stmt = select(
            Server.server_id,
            Server.name,
            Server.status,
            Server.type,
            Server.created_at,
            Server.last_data_update,
        ).order_by(Server.name.asc())
        return self.db.execute(stmt).all()

    @timed_operation
    def list_vote_servers(self) -> List[Tuple]:
        stmt = select(
            ServerVotes.id,
            ServerVotes.name,
            ServerVotes.total_votes,
            ServerVotes.last_vote_at,
            ServerVotes.created_at,
        ).order_by(ServerVotes.total_votes.desc(), ServerVotes.last_vote_at.desc())
        return self.db.execute(stmt).all()

    @staticmethod
    async def invalidate_server_cache(server_name: str) -> bool:
        """Invalidate Redis cache for a single server's metadata."""
        redis = get_redis()
        if not redis:
            return False
        cache_key = _get_cache_key(server_name)
        deleted_count = await redis.delete(cache_key)
        return deleted_count > 0

    @timed_operation
    async def get_by_name(self, name: str) -> Optional[Server]:
        if name in self._request_cache:
            return self._request_cache[name]

        redis = get_redis()
        cache_key = _get_cache_key(name)
        
        if redis:
            cached_data = await redis.get(cache_key)
            if cached_data:
                try:
                    server_obj = MockServer.from_cached_json(cached_data)
                    self._request_cache[name] = server_obj
                    return server_obj
                except (json.JSONDecodeError, TypeError):
                    self.logger.warning(
                        f"Invalid JSON in server_meta cache for key: {cache_key}. Refetching."
                    )

        server = self.db.execute(select(Server).where(Server.name == name)).scalar_one_or_none()
        
        if server and redis:
            await redis.set(cache_key, self._serialize_real_server(server), ex=3600)

        self._request_cache[name] = server
        return server

    @timed_operation
    def get_by_name_with_currencies(self, name: str) -> Optional[Server]:
        """Fetch a server together with its currencies via eager loading."""
        stmt = (
            select(Server)
            .where(Server.name == name)
            .options(selectinload(Server.currencies))
        )
        return self.db.execute(stmt).scalar_one_or_none()

    @timed_operation
    def increment_dashboard_views(self, server_id: int) -> Optional[int]:
        """Increment dashboard views for a server (atomic update)."""
        with self.transaction():
            update_stmt = (
                update(Server)
                .where(Server.server_id == server_id)
                .values(dashboard_views=Server.dashboard_views + 1)
            )
            self.db.execute(update_stmt)

    @timed_operation
    def get_currencies_for_server(self, server_id: int) -> List[ServerCurrency]:
        """Fetch currencies for a server."""
        stmt = (
            select(ServerCurrency)
            .where(ServerCurrency.server_id == server_id)
            .order_by(ServerCurrency.currency_id.asc())
        )
        return self.db.execute(stmt).scalars().all()
