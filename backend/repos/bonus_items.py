from datetime import datetime
from typing import Dict, List, Optional, Tuple
import re

from sqlalchemy import and_, exists, func, select

from .base import BaseRepository, timed_operation
from .search_helpers import (
    build_search_key,
    rebuild_name_vid_index,
    rebuild_names_index,
    scan_name_vid_index,
    scan_names_index,
)
from ..config import settings
from ..core.redis_client import get_redis
from ..db.models import (
    BonusItemDictionary,
    BonusTypesDictionary,
    BonusItemSighting,
    UniqueBonusCombination,
    UniqueCombinationValues,
)

class BonusItemsRepository(BaseRepository):
    @timed_operation
    def search_bonus_item_names(
        self, server_id: int, q: str, limit: int = 10
    ) -> List[BonusItemDictionary]:
        """Return up to `limit` item names matching `q` using LIKE."""
        words = re.split(r"[\s\+]+", q)
        if not words:
            return []

        lim = self._sanitize_limit(limit, minimum=1, maximum=10)

        conditions = [
            BonusItemDictionary.name.like(f"%{self._escape_like(word)}%")
            for word in words if word
        ]

        stmt = (
            select(BonusItemDictionary)
            .where(BonusItemDictionary.server_id == server_id)
            .where(and_(*conditions))
            .order_by(
                BonusItemDictionary.search_count.desc(),
                BonusItemDictionary.name.asc(),
            )
            .limit(lim)
        )
        return self.db.execute(stmt).scalars().all()

    @timed_operation
    async def search_bonus_item_names_from_redis(
        self, server_name: str, q: str, limit: Optional[int] = 10
    ) -> List[Tuple[str, int]]:
        """Search bonus item names in Redis index (ZSET)."""
        redis = get_redis()
        if not redis:
            self.logger.warning(
                "Redis not available, falling back to DB search for bonus_item_names."
            )
            server_id = await self.get_server_id_by_name(server_name)
            if not server_id:
                return []
            rows = self.search_bonus_item_names(server_id, q, limit)
            return [(r.name, r.vid) for r in rows]

        key = build_search_key(server_name, "bonus_items")
        return await scan_name_vid_index(redis, key, q, limit)

    @timed_operation
    async def search_bonus_type_names_from_redis(
        self, server_name: str, q: str, limit: int = 10
    ) -> List[str]:
        """Search bonus type names in Redis index (ZSET)."""
        redis = get_redis()
        if not redis:
            server_id = await self.get_server_id_by_name(server_name)
            if not server_id:
                return []
            return [r.name for r in self.search_bonus_type_names(server_id, q, limit)]

        key = build_search_key(server_name, "bonus_types")
        return await scan_names_index(redis, key, q, limit)

    @timed_operation
    def get_bonus_item_by_vid(self, server_id: int, vid: int) -> Optional[BonusItemDictionary]:
        """Return a single dictionary entry by its unique virtual ID (vid)."""
        stmt = (
            select(BonusItemDictionary)
            .where(
                BonusItemDictionary.server_id == server_id, BonusItemDictionary.vid == vid
            )
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    @timed_operation
    def search_bonus_type_names(
        self, server_id: int, q: str, limit: int = 10
    ) -> List[BonusTypesDictionary]:
        """Suggest bonus type names by substring."""
        if not q:
            return []

        lim = self._sanitize_limit(limit, minimum=1, maximum=10)

        stmt = (
            select(BonusTypesDictionary)
            .where(
                BonusTypesDictionary.server_id == server_id,
                BonusTypesDictionary.name.ilike(f"%{self._escape_like(q)}%")
            )
            .order_by(BonusTypesDictionary.name.asc())
            .limit(lim)
        )
        return self.db.execute(stmt).scalars().all()

    @timed_operation
    def search_bonus_item_sightings(
        self,
        server_id: int,
        start_dt: datetime,
        end_dt: datetime,
        item_q: Optional[str],
        item_vid: Optional[int],
        item_vids: Optional[List[int]],
        filters: List[Tuple[str, str, int]],
        sort_by: str,
        sort_dir: str,
        limit: int = 16,
        offset: int = 0,
    ) -> List[Tuple]:
        """Search bonus item sightings with optional item and bonus filters."""
        stmt = (
            select(
                BonusItemSighting.sighting_id,
                BonusItemSighting.price,
                BonusItemSighting.item_count,
                BonusItemSighting.first_seen_at,
                BonusItemSighting.last_seen_at,
                UniqueBonusCombination.item_vid,
                BonusItemDictionary.name.label("item_name"),
                UniqueBonusCombination.combination_id,
            )
            .join(UniqueBonusCombination, BonusItemSighting.combination_id == UniqueBonusCombination.combination_id)
            .join(
                BonusItemDictionary,
                and_(
                    BonusItemDictionary.server_id == UniqueBonusCombination.server_id,
                    BonusItemDictionary.vid == UniqueBonusCombination.item_vid,
                ),
            )
            .where(
                UniqueBonusCombination.server_id == server_id,
                BonusItemSighting.last_seen_at >= start_dt,
                BonusItemSighting.last_seen_at <= end_dt,
            )
        )

        # Item filters: prefer explicit VID, then list of VIDs, then substring query.
        if item_vid is not None:
            stmt = stmt.where(UniqueBonusCombination.item_vid == item_vid)
        elif item_vids:
            stmt = stmt.where(UniqueBonusCombination.item_vid.in_(item_vids))
        elif item_q:
            words = re.split(r"[\s\+]+", item_q)
            if words:
                conditions = [
                    BonusItemDictionary.name.like(f"%{self._escape_like(word)}%")
                    for word in words if word
                ]
                if conditions:
                    stmt = stmt.where(and_(*conditions))


        # Bonus filters: require existence of each (bonus_name, op, value)
        for bonus_name, op, val in (filters or []):
            bname = (bonus_name or "").strip()
            if not bname:
                continue
            op_lc = (op or "").lower()
            if op_lc == "gt":
                cond_val = UniqueCombinationValues.value > val
            elif op_lc == "gte":
                cond_val = UniqueCombinationValues.value >= val
            elif op_lc == "lt":
                cond_val = UniqueCombinationValues.value < val
            elif op_lc == "lte":
                cond_val = UniqueCombinationValues.value <= val
            elif op_lc == "eq":
                cond_val = UniqueCombinationValues.value == val
            else:
                # Default to >= for unexpected operators.
                cond_val = UniqueCombinationValues.value >= val
            exists_subq = (
                select(UniqueCombinationValues.combination_id)
                .join(BonusTypesDictionary, UniqueCombinationValues.bonus_id == BonusTypesDictionary.bonus_id)
                .where(
                    UniqueCombinationValues.combination_id == UniqueBonusCombination.combination_id,
                    BonusTypesDictionary.server_id == server_id,
                    func.lower(BonusTypesDictionary.name) == func.lower(bname),
                    cond_val,
                )
                .limit(1)
            )
            stmt = stmt.where(exists(exists_subq))

        # Sorting
        sort_col = BonusItemSighting.last_seen_at
        if (sort_by or "").lower() == "price":
            sort_col = BonusItemSighting.price
        elif (sort_by or "").lower() == "amount":
            sort_col = BonusItemSighting.item_count

        order = sort_col.asc() if (sort_dir or "").lower() == "asc" else sort_col.desc()
        stmt = stmt.order_by(order)

        # Limit/offset (allow lookahead: up to 16 to detect has_more when client limit is 15)
        lim = self._sanitize_limit(limit, minimum=1, maximum=16)
        off = self._sanitize_offset(offset)
        stmt = stmt.limit(lim).offset(off)

        return self.db.execute(stmt).all()

    @timed_operation
    def get_bonuses_for_combinations(self, combination_ids: List[int]) -> Dict[int, List[Tuple[str, int]]]:
        """Return mapping combination_id -> list of (bonus_name, value)."""
        if not combination_ids:
            return {}
        # Preserve multiplicity: return all rows ordered by stored bonus_index
        stmt = (
            select(
                UniqueCombinationValues.combination_id,
                BonusTypesDictionary.name,
                UniqueCombinationValues.value,
            )
            .join(BonusTypesDictionary, UniqueCombinationValues.bonus_id == BonusTypesDictionary.bonus_id)
            .where(UniqueCombinationValues.combination_id.in_(combination_ids))
            .order_by(
                UniqueCombinationValues.combination_id.asc(),
                UniqueCombinationValues.bonus_index.asc(),
            )
        )
        rows = self.db.execute(stmt).all()
        result: Dict[int, List[Tuple[str, int]]] = {}
        for comb_id, name, value in rows:
            result.setdefault(int(comb_id), []).append((str(name), int(value)))
        return result

    @timed_operation
    def _get_all_bonus_item_names_for_indexing(self, server_id: int) -> List[Tuple[str, int]]:
        """Fetch all bonus item names (name, vid) for indexing."""
        stmt = select(BonusItemDictionary.name, BonusItemDictionary.vid).where(BonusItemDictionary.server_id == server_id)
        return self.db.execute(stmt).all()

    @timed_operation
    def _get_all_bonus_type_names_for_indexing(self, server_id: int) -> List[str]:
        """Fetch all bonus type names for indexing."""
        stmt = select(BonusTypesDictionary.name).where(BonusTypesDictionary.server_id == server_id)
        return self.db.execute(stmt).scalars().all()

    async def refresh_bonus_items_search_index(self, server_id: int, server_name: str) -> dict:
        """Rebuild the Redis search index for bonus items."""
        redis = get_redis()
        if not redis:
            return {"status": "error", "reason": "Redis not available"}

        items = self._get_all_bonus_item_names_for_indexing(server_id)
        key = build_search_key(server_name, "bonus_items")
        count = await rebuild_name_vid_index(
            redis,
            key,
            items,
            settings.redis_indexing_chunk_size,
        )
        return {"status": "ok", "indexed": count, "key": key}

    async def refresh_bonus_types_search_index(self, server_id: int, server_name: str) -> dict:
        """Rebuild the Redis search index for bonus types."""
        redis = get_redis()
        if not redis:
            return {"status": "error", "reason": "Redis not available"}

        bonus_types = self._get_all_bonus_type_names_for_indexing(server_id)
        key = build_search_key(server_name, "bonus_types")
        count = await rebuild_names_index(redis, key, bonus_types)
        return {"status": "ok", "indexed": count, "key": key}
