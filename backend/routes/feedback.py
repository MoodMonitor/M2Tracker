import io
import json
import asyncio
import hashlib

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status, HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..config import settings
from ..core.redis_client import get_redis
from ..core.database import get_db
from ..core.exceptions import InvalidInputException
from ..core.limiter import limiter
from ..repos import RepositoryManager
from ..routes.schemas import FeedbackData, GeneralFeedbackPayload
from ..utils.image_processing import ImageValidator
from .auth import _verify_turnstile

public_router = APIRouter(prefix="/feedback", tags=["feedback"])
secure_router = APIRouter(prefix="/feedback", tags=["feedback", "dashboard"])

feedback_processing_semaphore = asyncio.Semaphore(settings.feedback_concurrency_limit)

image_validator = ImageValidator(
    max_size_mb=settings.feedback_max_image_mb,
    max_dims=(settings.feedback_max_image_width, settings.feedback_max_image_height),
    allowed_formats={"PNG", "JPEG"}
)


@public_router.post(
    "/submit",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit general user feedback (e.g., suggestions, UX issues).",
)
@limiter.limit("3/minute")
async def submit_general_feedback(
    request: Request,
    payload: GeneralFeedbackPayload,
    session: Session = Depends(get_db),
):
    """
    Accepts general user feedback, verifies it, and saves it for review.

    - Requires Turnstile verification to prevent spam.
    - Saves feedback as a JSON file on the server.
    """
    await _verify_turnstile(request, payload.turnstileToken, "", use_invisible=True)

    repos = RepositoryManager(session)
    await repos.feedback.save_general_feedback(feedback_data=payload.model_dump())

    return Response(status_code=status.HTTP_202_ACCEPTED)


@secure_router.post(
    "/ai-calculator",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit feedback for the AI calculator, including an image and recognition data.",
)
@limiter.limit("2/minute")
async def submit_ai_calculator_feedback(
    request: Request,
    image: UploadFile = File(..., description="The original screenshot (.png or .jpg)."),
    feedback_data: str = Form(..., description="A JSON string containing feedback metadata."),
    session: Session = Depends(get_db),
    ):
    repos = RepositoryManager(session)
    if len(feedback_data) > (settings.feedback_max_json_kb * 1024):
        raise InvalidInputException(
            f"The 'feedback_data' JSON payload exceeds the size limit of {settings.feedback_max_json_kb} KB."
        )
    try:
        feedback_payload = FeedbackData.model_validate_json(feedback_data)
    except ValidationError as e:
        raise InvalidInputException(f"Invalid 'feedback_data' JSON structure: {e}")
    except json.JSONDecodeError:
        raise InvalidInputException("Field 'feedback_data' is not valid JSON.")

    image_content = await image.read()
    if not image_content:
        raise InvalidInputException("The submitted image is empty.")

    image_hash = hashlib.sha256(image_content).hexdigest()
    redis = get_redis()
    hash_key = f"{settings.redis_prefix}:feedback:img_hash:{image_hash}"

    actions = feedback_payload.userActions
    has_valuable_data = (
        actions.itemCorrections or
        actions.quantityCorrections or
        actions.deletedDetections
    )

    async def process_and_save():
        if redis:
            dedup_created = await redis.set(hash_key, 1, ex=settings.feedback_image_hash_ttl_s, nx=True)
            if not dedup_created:
                return False

        image_stream = io.BytesIO(image_content)
        try:
            sanitized_image_bytes = await image_validator.validate_and_sanitize(image_stream)

            await repos.feedback.save_feedback_package(
                image_bytes=sanitized_image_bytes,
                feedback_data=feedback_payload.model_dump()
            )
        except Exception:
            if redis:
                await redis.delete(hash_key)
            raise

        return True

    if has_valuable_data:
        try:
            async with asyncio.timeout(5):
                async with feedback_processing_semaphore:
                    processed = await process_and_save()
                    if processed is False:
                        return Response(status_code=status.HTTP_202_ACCEPTED)
        except asyncio.TimeoutError:
            if redis:
                await redis.delete(hash_key)
            pass
    else:
        if feedback_processing_semaphore.locked():
            return Response(status_code=status.HTTP_202_ACCEPTED)

        async with feedback_processing_semaphore:
            processed = await process_and_save()
            if processed is False:
                return Response(status_code=status.HTTP_202_ACCEPTED)

    return Response(status_code=status.HTTP_202_ACCEPTED)

