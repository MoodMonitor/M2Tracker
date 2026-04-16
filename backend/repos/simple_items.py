from datetime import datetime, timedelta
from typing import List, Optional, Tuple, Dict
import re
import json

from redis.exceptions import RedisError
from sqlalchemy import select, update, and_

from .base import BaseRepository, timed_operation
from .search_helpers import build_search_key, rebuild_name_vid_index, scan_name_vid_index
from ..core.redis_client import get_redis
from ..config import settings
from ..db.models import (
    SimpleItemDictionary,
    DailySimpleItemStats,
)

class SimpleItemsRepository(BaseRepository):
    @timed_operation
    def search_simple_item_names(
        self, server_id: int, q: str, limit: int = 10
    ) -> List[SimpleItemDictionary]:
        """Return up to `limit` item names matching `q` using LIKE.
        FULLTEXT is not used due to innodb_ft_min_token_size=3.
        """
        words = re.split(r'[\s\+]+', q)
        if not words:
            return []

        lim = self._sanitize_limit(limit, minimum=1, maximum=10)

        conditions = [
            SimpleItemDictionary.name.like(f"%{self._escape_like(word)}%")
            for word in words if word
        ]

        stmt = (
            select(SimpleItemDictionary)
            .where(SimpleItemDictionary.server_id == server_id)
            .where(and_(*conditions))
            .order_by(
                SimpleItemDictionary.search_count.desc(),
                SimpleItemDictionary.name.asc(),
            )
            .limit(lim)
        )
        return self.db.execute(stmt).scalars().all()

    @timed_operation
    async def search_simple_item_names_from_redis(
        self, server_name: str, q: str, limit: Optional[int] = 10
    ) -> List[Tuple[str, int]]:
        """Search item names in Redis index (ZSET)."""
        redis = get_redis()
        if not redis:
            self.logger.warning(
                "Redis not available, falling back to DB search for simple_item_names."
            )
            server_id = await self.get_server_id_by_name(server_name)
            if not server_id:
                return []
            rows = self.search_simple_item_names(server_id, q, limit)
            return [(r.name, r.vid) for r in rows]

        key = build_search_key(server_name, "simple_items")
        return await scan_name_vid_index(redis, key, q, limit)

    @timed_operation
    def get_simple_item_by_vid(self, server_id: int, vid: int) -> Optional[SimpleItemDictionary]:
        """Return a single dictionary entry by its unique virtual ID (vid)."""
        stmt = (
            select(SimpleItemDictionary)
            .where(
                SimpleItemDictionary.server_id == server_id, SimpleItemDictionary.vid == vid
            )
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    @timed_operation
    def _get_all_simple_item_names_for_indexing(self, server_id: int) -> List[Tuple[str, int]]:
        """Fetch all item names (name, vid) for indexing."""
        stmt = select(SimpleItemDictionary.name, SimpleItemDictionary.vid).where(SimpleItemDictionary.server_id == server_id)
        return self.db.execute(stmt).all()

    async def refresh_simple_item_search_index(self, server_id: int, server_name: str) -> dict:
        """Rebuild the Redis search index for simple item names."""
        redis = get_redis()
        if not redis:
            return {"status": "error", "reason": "Redis not available"}

        items = self._get_all_simple_item_names_for_indexing(server_id)
        key = build_search_key(server_name, "simple_items")
        count = await rebuild_name_vid_index(
            redis,
            key,
            items,
            settings.redis_indexing_chunk_size,
        )
        return {"status": "ok", "indexed": count, "key": key}

    @timed_operation
    def get_bulk_simple_item_prices_q10(
        self, server_id: int, at_dt: datetime, vids: List[int]
    ) -> List[Tuple[int, str, Optional[float]]]:
        """Return latest Q10 prices for a list of VIDs."""
        if not vids:
            return []

        # Keep the IN clause at a reasonable size.
        vids = list(set(vids))[:45]

        stmt = (
            select(
                SimpleItemDictionary.vid,
                SimpleItemDictionary.name,
                DailySimpleItemStats.price_q10,
            )
            .join(DailySimpleItemStats, and_(
                SimpleItemDictionary.server_id == DailySimpleItemStats.server_id,
                SimpleItemDictionary.vid == DailySimpleItemStats.item_vid
            ))
            .where(
                SimpleItemDictionary.server_id == server_id,
                DailySimpleItemStats.date == at_dt,
                SimpleItemDictionary.vid.in_(vids)
            )
        )

        return self.db.execute(stmt).all()

    @timed_operation
    async def get_cached_bulk_simple_item_prices_q10(
        self, server_name: str, server_id: int, at_dt: datetime, vids: List[int]
    ) -> Dict[int, Tuple[str, Optional[float]]]:
        """Return latest Q10 prices, using Redis cache when available."""
        if not vids:
            return {}

        unique_vids = list(set(vids))
        results: Dict[int, Tuple[str, Optional[float]]] = {}
        vids_to_fetch_from_db: List[int] = []

        redis = get_redis()
        at_dt_timestamp = int(at_dt.timestamp())
        cache_keys = {
            vid: f"{settings.redis_prefix}:cache:{server_name}:price_q10:{at_dt_timestamp}:{vid}"
            for vid in unique_vids
        }

        if redis:
            cached_values = await redis.mget(list(cache_keys.values()))
            for vid, cached_value in zip(unique_vids, cached_values):
                if cached_value is not None:
                    try:
                        name, price = json.loads(cached_value)
                        results[vid] = (name, price)
                    except (json.JSONDecodeError, TypeError, ValueError):
                        vids_to_fetch_from_db.append(vid)
                else:
                    vids_to_fetch_from_db.append(vid)
        else:
            vids_to_fetch_from_db = unique_vids

        if vids_to_fetch_from_db:
            db_results = self.get_bulk_simple_item_prices_q10(server_id, at_dt, vids_to_fetch_from_db)
            db_prices_by_vid = {vid: (name, price) for vid, name, price in db_results}

            pipe = redis.pipeline() if redis and vids_to_fetch_from_db else None
            for vid in vids_to_fetch_from_db:
                if vid in db_prices_by_vid:
                    name, price = db_prices_by_vid[vid]
                    results[vid] = (name, price)
                    if pipe:
                        serializable_price = float(price) if price is not None else None
                        cache_value = json.dumps([name, serializable_price])
                        pipe.set(cache_keys[vid], cache_value, ex=43200)
                else:
                    results[vid] = ("__NOT_FOUND__", None)
                    if pipe:
                        pipe.set(cache_keys[vid], json.dumps(["__NOT_FOUND__", None]), ex=3600)

            if pipe:
                try:
                    await pipe.execute()
                except RedisError as e:
                    self.logger.error(
                        f"Redis pipeline failed during cache set for simple_item_prices: {e}"
                    )

        return results

    @timed_operation
    def increment_search_count(self, server_id: int, item_vid: int, by: int = 1) -> None:
        """Atomically increment search_count for a simple item dictionary entry.
        Commits immediately; on error rolls back and re-raises.
        """
        with self.transaction():
            stmt = (
                update(SimpleItemDictionary)
                .where(
                    SimpleItemDictionary.server_id == server_id,
                    SimpleItemDictionary.vid == item_vid,
                )
                .values(search_count=SimpleItemDictionary.search_count + by)
            )
            self.db.execute(stmt)

    @timed_operation
    def get_simple_item_daily_stats_range(
        self, server_id: int, item_vid: int, start_dt: datetime, end_dt: datetime
    ) -> List[DailySimpleItemStats]:
        """Fetch daily stats rows for a simple item in [start_dt, end_dt], ascending by date."""
        stmt = (
            select(DailySimpleItemStats)
            .where(
                DailySimpleItemStats.server_id == server_id,
                DailySimpleItemStats.item_vid == item_vid,
                DailySimpleItemStats.date >= start_dt,
                DailySimpleItemStats.date <= end_dt,
            )
            .order_by(DailySimpleItemStats.date.asc())
        )
        return self.db.execute(stmt).scalars().all()

    @timed_operation
    def get_simple_item_daily_stat_at(
        self, server_id: int, item_vid: int, at_dt: datetime
    ) -> Optional[DailySimpleItemStats]:
        """Fetch a single daily stat row exactly at the given datetime."""
        stmt = (
            select(DailySimpleItemStats)
            .where(
                DailySimpleItemStats.server_id == server_id,
                DailySimpleItemStats.item_vid == item_vid,
                DailySimpleItemStats.date == at_dt,
            )
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()
