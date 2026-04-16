from typing import List, Optional, Literal
from pydantic import BaseModel, Field, field_validator
import bleach


class BoxCoords(BaseModel):
    x: float
    y: float
    width: float
    height: float


class Recognition(BaseModel):
    boxId: str
    itemName: Optional[str] = None
    itemVid: Optional[int] = None
    quantity: Optional[int] = None
    suggestions: List[str] = Field(default_factory=list)


class DeletedDetection(BaseModel):
    id: str
    x: float
    y: float
    width: float
    height: float


class ItemCorrection(BaseModel):
    boxId: str
    originalSuggestions: List[str]
    finalItemName: str
    finalItemVid: int
    boxCoords: BoxCoords


class QuantityCorrection(BaseModel):
    boxId: str
    originalQuantity: int
    finalQuantity: int
    boxCoords: BoxCoords


class UserActions(BaseModel):
    deletedDetections: List[DeletedDetection] = Field(default_factory=list)
    itemCorrections: List[ItemCorrection] = Field(default_factory=list)
    quantityCorrections: List[QuantityCorrection] = Field(default_factory=list)


class FeedbackData(BaseModel):
    version: str
    timestamp: str
    serverName: str
    originalRecognitions: List[Recognition]
    finalRecognitions: List[Recognition]
    userActions: UserActions


class GeneralFeedbackContext(BaseModel):
    """Optional context for general feedback, e.g., linking to a bug report."""
    parentReportId: Optional[str] = Field(None, max_length=64, description="ID of a related bug report.")


class GeneralFeedbackPayload(BaseModel):
    """Schema for general user feedback submissions."""
    category: Literal['ux', 'content', 'suggestion', 'other', 'unexpected_problem_comment'] = Field(..., description="The category of the feedback.")
    comment: str = Field(..., min_length=10, max_length=2048, description="The user's comment.")
    turnstileToken: str = Field(..., description="Cloudflare Turnstile response token for verification.")
    context: Optional[GeneralFeedbackContext] = Field(None, description="Optional context for the feedback.")

    @field_validator("comment", mode="before")
    @classmethod
    def sanitize_comment(cls, v: str) -> str:
        if not v:
            return v
        return bleach.clean(v, tags=[], strip=True)