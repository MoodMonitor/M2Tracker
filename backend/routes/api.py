from fastapi import APIRouter

from . import stats, simple_items, bonus_items, dashboard, homepage, feedback, bug_reports

router = APIRouter()

# Dashboard-related routers
router.include_router(stats.router, prefix="/dashboard")
router.include_router(simple_items.router, prefix="/dashboard")
router.include_router(bonus_items.router, prefix="/dashboard")
router.include_router(feedback.secure_router, prefix="/dashboard")
router.include_router(feedback.public_router)
router.include_router(dashboard.router)  # This router already defines the "/dashboard" prefix.

# Other top-level routers
router.include_router(homepage.router)
router.include_router(bug_reports.router)

@router.get("/health", tags=["meta"], summary="Health check")
async def health():
    return {"status": "ok"}