import json
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Tuple, Any

from sqlalchemy import and_, func, select

from .base import BaseRepository, timed_operation
from ..db.models import (
    SimpleItem24hTop10,
    SimpleItemDictionary,
    ShopDailyStats,
    ShopDailyWindowStats,
    DailyServerStats,
)

from ..core.redis_client import get_redis
from ..config import settings

class StatsRepository(BaseRepository):
    METRICS_DEFAULT: List[str] = [
        "price_up",
        "price_down",
        "amount_change_up",
        "amount_change_down",
        "shop_change_up",
        "shop_change_down",
    ]

    @timed_operation
    def get_24h_top10_for(
        self,
        server_id: int,
        as_of_date: datetime,
        metrics: Optional[List[str]] = None,
    ) -> Dict[str, List[Dict[str, Any]]]:
        metrics = metrics or self.METRICS_DEFAULT

        stmt = (
            select(
                SimpleItem24hTop10.metric_type,
                SimpleItem24hTop10.rank,
                SimpleItemDictionary.name.label("item_name"),
                SimpleItem24hTop10.price_now,
                SimpleItem24hTop10.price_prev,
                SimpleItem24hTop10.change_abs,
                SimpleItem24hTop10.change_pct,
                SimpleItem24hTop10.amount_now,
                SimpleItem24hTop10.amount_prev,
                SimpleItem24hTop10.shops_now,
                SimpleItem24hTop10.shops_prev,
            )
            .join(
                SimpleItemDictionary,
                and_(
                    SimpleItemDictionary.server_id == SimpleItem24hTop10.server_id,
                    SimpleItemDictionary.vid == SimpleItem24hTop10.item_vid,
                ),
            )
            .where(
                SimpleItem24hTop10.server_id == server_id,
                SimpleItem24hTop10.as_of_date == as_of_date,
                SimpleItem24hTop10.metric_type.in_(metrics),
            )
            .order_by(SimpleItem24hTop10.metric_type.asc(), SimpleItem24hTop10.rank.asc())
        )

        rows = self.db.execute(stmt).all()
        out: Dict[str, List[Dict[str, Any]]] = {m: [] for m in metrics}
        for r in rows:
            (
                metric_type,
                rank,
                item_name,
                price_now,
                price_prev,
                change_abs,
                change_pct,
                amount_now,
                amount_prev,
                shops_now,
                shops_prev,
            ) = r
            out[metric_type].append(
                {
                    "rank": int(rank) if rank is not None else None,
                    "item_name": item_name,
                    "price_now": float(price_now) if price_now is not None else None,
                    "price_prev": float(price_prev) if price_prev is not None else None,
                    "change_abs": float(change_abs) if change_abs is not None else None,
                    "change_pct": float(change_pct) if change_pct is not None else None,
                    "amount_now": int(amount_now) if amount_now is not None else None,
                    "amount_prev": int(amount_prev) if amount_prev is not None else None,
                    "shops_now": int(shops_now) if shops_now is not None else None,
                    "shops_prev": int(shops_prev) if shops_prev is not None else None,
                }
            )

        return out

    @timed_operation
    def get_shop_daily_stats(self, server_id: int, ref_date: datetime) -> Optional[ShopDailyStats]:
        stmt = select(ShopDailyStats).where(
            ShopDailyStats.server_id == server_id,
            ShopDailyStats.date == ref_date,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    @timed_operation
    def get_shop_window_stats(
        self, server_id: int, ref_date: datetime, window_days: int
    ) -> Optional[ShopDailyWindowStats]:
        stmt = select(ShopDailyWindowStats).where(
            ShopDailyWindowStats.server_id == server_id,
            ShopDailyWindowStats.date == ref_date,
            ShopDailyWindowStats.window_days == window_days,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    @timed_operation
    def get_shop_daily_stats_range(
        self, server_id: int, start_dt: datetime, end_dt: datetime
    ) -> List[ShopDailyStats]:
        stmt = (
            select(ShopDailyStats)
            .where(
                ShopDailyStats.server_id == server_id,
                ShopDailyStats.date >= start_dt,
                ShopDailyStats.date <= end_dt,
            )
            .order_by(ShopDailyStats.date.asc())
        )
        return self.db.execute(stmt).scalars().all()

    @timed_operation
    def get_server_daily_stats_range(
        self, server_id: int, start_dt: datetime, end_dt: datetime
    ) -> List[DailyServerStats]:
        stmt = (
            select(DailyServerStats)
            .where(
                DailyServerStats.server_id == server_id,
                DailyServerStats.date >= start_dt,
                DailyServerStats.date <= end_dt,
            )
            .order_by(DailyServerStats.date.asc())
        )
        return self.db.execute(stmt).scalars().all()


    @timed_operation
    async def get_cached_shop_window_stats(
            self, server_name: str, server_id: int, last_data_update: datetime, window_day: int
    ) -> Dict[str, Any]:
        """
        Fetch and cache the combined result of shop window and daily stats.
        The result is a dictionary ready for serialization, fetched from Redis
        or computed and then cached. It also caches the resolved reference date.
        """
        redis = get_redis()

        cache_key = (
            f"{settings.redis_prefix}:cache:{server_name}:shop_window:{window_day}:{last_data_update.isoformat()}"
        )

        if redis:
            cached_data = await redis.get(cache_key)
            if cached_data:
                try:
                    payload = json.loads(cached_data)
                    if "window_stats" in payload and "baseline_daily_stats" in payload:
                        return payload
                except (json.JSONDecodeError, TypeError):
                    self.logger.warning(
                        f"Invalid JSON in shop_window cache for key: {cache_key}. Refetching."
                    )

        # Cache miss: build the payload from scratch.
        anchor_dt = last_data_update - timedelta(days=window_day)
        # 1. Fetch baseline daily stats
        daily_rows = self.get_shop_daily_stats_range(
            server_id=server_id,
            start_dt=anchor_dt,
            end_dt=last_data_update,
        )

        baseline_daily_stats = [
            {
                "date": row.date.strftime("%Y-%m-%d") if row.date else "",
                "new_shops": int(row.new_shops) if row.new_shops is not None else 0,
                "disappeared_shops": int(row.disappeared_shops) if row.disappeared_shops is not None else 0,
                "continuing_shops": int(row.continuing_shops) if row.continuing_shops is not None else 0,
                "total_shops_count": int(row.total_shops_count) if row.total_shops_count is not None else None,
                "median_unique_items_per_shop": float(row.median_unique_items_per_shop)
                if row.median_unique_items_per_shop is not None
                else None,
            }
            for row in daily_rows
        ]

        # 2. Fetch windowed stats
        window_row = self.get_shop_window_stats(
            server_id=server_id,
            ref_date=last_data_update,
            window_days=window_day,
        )

        window_stats = self._format_window_stats(window_row)

        payload = {
            "window_stats": window_stats,
            "baseline_daily_stats": baseline_daily_stats,
        }

        if redis:
            try:
                await redis.set(cache_key, json.dumps(payload), ex=21600)
            except Exception as e:
                self.logger.error(
                    f"Failed to set shop_window cache for key {cache_key}: {e}"
                )

        return payload

    def _format_window_stats(self, window_row: Optional[ShopDailyWindowStats]) -> Optional[Dict[str, Any]]:
        """Convert a ShopDailyWindowStats ORM object to a dictionary."""
        if window_row is None:
            return None

        return {
            "unique_shops": int(window_row.unique_shops) if window_row.unique_shops is not None else None,
            "avg_presence_streak_days": float(window_row.avg_presence_streak_days) if window_row.avg_presence_streak_days is not None else None,
            "total_shops_count_avg": float(window_row.total_shops_count_avg) if window_row.total_shops_count_avg is not None else None,
            "total_shops_count_min": int(window_row.total_shops_count_min) if window_row.total_shops_count_min is not None else None,
            "total_shops_count_max": int(window_row.total_shops_count_max) if window_row.total_shops_count_max is not None else None,
            "median_unique_items_per_shop_avg": float(window_row.median_unique_items_per_shop_avg) if window_row.median_unique_items_per_shop_avg is not None else None,
            "median_unique_items_per_shop_min": float(window_row.median_unique_items_per_shop_min) if window_row.median_unique_items_per_shop_min is not None else None,
            "median_unique_items_per_shop_max": float(window_row.median_unique_items_per_shop_max) if window_row.median_unique_items_per_shop_max is not None else None,
        }