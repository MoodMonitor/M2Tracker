from typing import List, Optional

from pydantic import BaseModel, Field, model_validator


class ItemSuggestion(BaseModel):
    name: str = Field(description="The base name of the item.")
    vid: int = Field(description="The unique virtual ID of the item.")


class SimpleItemDailyStatOut(BaseModel):
    date: str
    price_q10: Optional[float] = None
    price_median: Optional[float] = None
    item_amount: Optional[int] = None
    shop_appearance_count: Optional[int] = None


class SimpleItemDailyWindowResponse(BaseModel):
    stats: List[SimpleItemDailyStatOut] = Field(default_factory=list)


class ItemNameSuggestionResponse(BaseModel):
    suggestions: List[str] = Field(default_factory=list)


class SimpleItemPriceQ10LastUpdateResponse(BaseModel):
    price_q10: Optional[float] = None


class AICalculatorItemIn(BaseModel):
    vid: Optional[int] = None
    name: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def check_vid_or_name_exists(cls, data):
        if not data.get('vid') and not data.get('name'):
            raise ValueError('Either "vid" or "name" must be provided for each item.')
        if data.get('vid') and data.get('name'):
            raise ValueError('Provide either "vid" or "name", not both.')
        return data


class AICalculatorRequest(BaseModel):
    server_name: str
    items: List[AICalculatorItemIn] = Field(..., max_length=50)


class AICalculatorPriceOut(BaseModel):
    vid: Optional[int] = Field(None, description="The unique virtual ID of the item.")
    name: str = Field(description="The name of the item. For items not found, this will be the name provided in the request.")
    price_q10: Optional[float] = Field(None, description="The Q10 price of the item, or null if not found.")



class BonusTypeSuggestionResponse(BaseModel):
    suggestions: List[str] = Field(default_factory=list)


class BonusFilterIn(BaseModel):
    name: str
    op: str = Field(
        "gte",
        description="Comparison operator: one of 'gt', 'gte', 'lt', 'lte', 'eq' (or '=')",
    )
    value: int = Field(..., ge=0)


class BonusItemSearchRequest(BaseModel):
    server_name: str
    window_days: int
    q: Optional[str] = Field(None, description="Item name substring (ILIKE)")
    item_vid: Optional[int] = Field(None, description="Optional specific item ID to search for. Overrides 'q' if provided.")
    sort_by: str = Field("last_seen", description="One of: last_seen, amount, price")
    sort_dir: str = Field("desc", description="One of: asc, desc")
    filters: List[BonusFilterIn] = Field(default_factory=list)
    limit: int = Field(15, ge=1, le=15)
    offset: int = Field(0, ge=0)


class BonusValueOut(BaseModel):
    name: str
    value: int


class BonusItemSightingOut(BaseModel):
    item_name: str
    price: float
    item_count: int
    last_seen: str  # YYYY-MM-DD
    bonuses: List[BonusValueOut] = Field(default_factory=list)


class BonusItemSearchResponse(BaseModel):
    count: int
    has_more: bool
    results: List[BonusItemSightingOut] = Field(default_factory=list)