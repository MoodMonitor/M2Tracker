from typing import List, Optional

from pydantic import BaseModel, Field, condecimal


class CurrencyInfo(BaseModel):
    name: str
    symbol: str
    threshold: condecimal(max_digits=50, decimal_places=0)


class ServerInfoOut(BaseModel):
    name: str
    status: bool
    type: Optional[str] = None
    currencies: List[CurrencyInfo] = Field(default_factory=list)
    discord_url: Optional[str] = None
    forum_url: Optional[str] = None
    website_url: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None  # YYYY-MM-DD
    last_data_update: Optional[str] = None  # YYYY-MM-DD HH:MM, adjusted and floored


class DashboardInitResponse(BaseModel):
    server: Optional[ServerInfoOut] = None
    other_servers: List[str] = Field(default_factory=list)