from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field, field_validator
import bleach


class ConsoleEntry(BaseModel):
    level: str
    message: str
    args: Optional[str] = None
    timestamp: str


class BreadcrumbEntry(BaseModel):
    type: str
    data: Optional[Dict[str, Any]] = None
    timestamp: str


class NetworkInfo(BaseModel):
    effectiveType: Optional[str] = None
    downlink: Optional[float] = None
    rtt: Optional[float] = None
    saveData: Optional[bool] = None


class ScreenInfo(BaseModel):
    width: int
    height: int
    pixelRatio: float


class ErrorMetadata(BaseModel):
    deviceMemory: Optional[int] = None
    language: str
    network: Optional[NetworkInfo] = None
    online: bool
    platform: str
    referrer: str
    screen: ScreenInfo
    timestamp: str
    timezoneOffset: int
    url: str
    userAgent: str


class BugReportContext(BaseModel):
    turnstileToken: str
    problemType: Optional[str] = None
    # Allow arbitrary extra fields in context.
    class Config:
        extra = 'allow'


class BugReportPayload(BaseModel):
    kind: Literal['js', 'promise', 'fetch', 'manual']
    message: str
    stack: Optional[str] = None
    comment: Optional[str] = Field(None, max_length=2048)
    context: BugReportContext
    consoleLogs: Optional[List[ConsoleEntry]] = Field(default_factory=list)
    breadcrumbs: Optional[List[BreadcrumbEntry]] = Field(default_factory=list)
    metadata: ErrorMetadata

    @field_validator("comment", "message", mode="before")
    @classmethod
    def sanitize_text_fields(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        # Removes all HTML tags, leaving only plain text,
        # which prevents XSS attacks if this data were to be displayed in the admin panel.
        return bleach.clean(v, tags=[], strip=True)