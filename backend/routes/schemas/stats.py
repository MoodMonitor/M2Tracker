from typing import List, Optional

from pydantic import BaseModel, Field


class Top10Entry(BaseModel):
    rank: int
    item_name: str
    price_now: Optional[float] = None
    price_prev: Optional[float] = None
    change_abs: Optional[float] = None
    change_pct: Optional[float] = None
    amount_now: Optional[int] = None
    amount_prev: Optional[int] = None
    shops_now: Optional[int] = None
    shops_prev: Optional[int] = None


class Top10Response(BaseModel):
    price_up: List[Top10Entry] = Field(default_factory=list)
    price_down: List[Top10Entry] = Field(default_factory=list)
    amount_change_up: List[Top10Entry] = Field(default_factory=list)
    amount_change_down: List[Top10Entry] = Field(default_factory=list)
    shop_change_up: List[Top10Entry] = Field(default_factory=list)
    shop_change_down: List[Top10Entry] = Field(default_factory=list)


class ShopDailyStatsOut(BaseModel):
    date: str  # Format: YYYY-MM-DD
    new_shops: int
    disappeared_shops: int
    continuing_shops: int
    total_shops_count: Optional[int] = None
    median_unique_items_per_shop: Optional[float] = None


class ShopDailyWindowStatsOut(BaseModel):
    unique_shops: Optional[int] = None
    avg_presence_streak_days: Optional[float] = None
    total_shops_count_avg: Optional[float] = None
    total_shops_count_min: Optional[int] = None
    total_shops_count_max: Optional[int] = None
    median_unique_items_per_shop_avg: Optional[float] = None
    median_unique_items_per_shop_min: Optional[float] = None
    median_unique_items_per_shop_max: Optional[float] = None


class ShopWindowResponse(BaseModel):
    window_stats: Optional[ShopDailyWindowStatsOut] = None
    baseline_daily_stats: List[ShopDailyStatsOut] = Field(default_factory=list)


class ServerDailyStatsOut(BaseModel):
    date: str
    total_simple_items_amount: Optional[int] = None
    unique_simple_items_amount: Optional[int] = None
    total_bonus_items_amount: Optional[int] = None
    unique_bonus_items_amount: Optional[int] = None


class ServerDailyWindowResponse(BaseModel):
    stats: List[ServerDailyStatsOut] = Field(default_factory=list)