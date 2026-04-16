from typing import List, Optional

from pydantic import BaseModel, Field


class HomeServerOut(BaseModel):
    name: str
    status: bool
    type: Optional[str] = None
    created_at: Optional[str] = None  # YYYY-MM-DD
    last_data_update_human: Optional[str] = None  # today/yesterday/X days ago


class VoteServerOut(BaseModel):
    name: str
    total_votes: int


class UpdateItemOut(BaseModel):
    type: str  # 'news' | 'changelog'
    id: int
    title: str
    content: str
    created_at: str  # YYYY-MM-DD


class HomepageInitResponse(BaseModel):
    servers: List[HomeServerOut] = Field(default_factory=list)
    updates: List[UpdateItemOut] = Field(default_factory=list)


class VoteRequest(BaseModel):
    servers: List[str] = Field(default_factory=list)
    turnstile_token: str = Field(..., description="Cloudflare Turnstile response token for verification.")


class VoteResponse(BaseModel):
    allowed: bool
    voted_count: int = 0
    retry_after_seconds: int | None = None