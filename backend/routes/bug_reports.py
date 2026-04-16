import asyncio
import hashlib

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from ..config import settings
from ..core.database import get_db
from ..core.exceptions import InvalidInputException, ServiceUnavailableException
from ..core.limiter import limiter
from ..core.redis_client import get_redis
from ..repos import RepositoryManager
from .auth import _verify_turnstile
from .schemas import BugReportPayload

router = APIRouter(prefix="/bug-reports", tags=["bug-reports"])


@router.post(
    "/submit",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a bug report from the frontend.",
)
@limiter.limit("2/5minutes")
async def submit_bug_report(
    request: Request,
    payload: BugReportPayload,
    session: Session = Depends(get_db),
):
    await _verify_turnstile(request, payload.context.turnstileToken, "", use_invisible=True)

    repos = RepositoryManager(session)

    await repos.bug_reports.save_bug_report_package(report_data=payload.model_dump())

    return Response(status_code=status.HTTP_202_ACCEPTED)