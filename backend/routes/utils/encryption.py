import binascii
import json
import os
import secrets
import time
from typing import Any, Dict, Optional, Set

from fastapi import Request
from fastapi.responses import Response, JSONResponse
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from redis.exceptions import RedisError

from ...config import settings
from ...core.encoding import base64url_decode, base64url_encode
from ...core.redis_client import get_redis
from ...core.exceptions import (
    APIException,
    AuthenticationError,
    ServiceUnavailableException,
)
from ...core.logging import get_logger

logger = get_logger("app.utils.encryption")


def generate_secure_random_string(nbytes: int) -> str:
    """Generate a secure random string of specified bytes."""
    return base64url_encode(secrets.token_bytes(nbytes))


async def _get_key_enc_from_request(request: Request) -> bytes:
    """Load and decode key_enc from request.state.secure_session or Redis via sid."""
    secure_session = getattr(request.state, "secure_session", None)
    key_enc_b64: Optional[str] = None
    if secure_session and secure_session.get("key_enc"):
        key_enc_b64 = secure_session["key_enc"]
    else:
        auth_header = request.headers.get("Authorization")
        sid: Optional[str] = None
        if auth_header:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                sid = parts[1]

        if not sid:
            raise AuthenticationError("Secure session required, but no valid Authorization header was found.")

        redis = get_redis()
        if not redis:
            raise ServiceUnavailableException("Session storage is unavailable for encryption key retrieval.")
        try:
            data = await redis.hgetall(f"{settings.redis_prefix}:auth:{sid}")  # type: ignore
        except RedisError as e:
            raise ServiceUnavailableException(f"Session lookup failed for sid {sid}: {e}")

        if data and data.get("main_keys"):
            try:
                main_keys = json.loads(data["main_keys"])
                key_enc_b64 = main_keys.get("key_enc")
            except (json.JSONDecodeError, TypeError):
                key_enc_b64 = None
        else:
            key_enc_b64 = None

        if not key_enc_b64:
            raise AuthenticationError(
                f"Secure session invalid, expired, or missing encryption key for sid {sid}."
            )

    try:
        key = base64url_decode(key_enc_b64)
    except (binascii.Error, TypeError, ValueError) as e:
        raise APIException(f"Could not decode encryption key from session: {e}")
    if len(key) not in (16, 24, 32):
        raise APIException(f"Unsupported AES-GCM key length encountered: {len(key)} bytes.")
    return key


async def encrypted_bytes_response(
    request: Request,
    content: bytes,
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
    media_type: str = "application/octet-stream",
) -> Response:
    """Encrypt bytes and return a Response with X-Enc and X-IV headers."""
    key = await _get_key_enc_from_request(request)
    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, content, None)

    hdrs: Dict[str, str] = {}
    if headers:
        hdrs.update(headers)
    hdrs["X-Enc"] = "1"
    hdrs["X-IV"] = base64url_encode(iv)

    return Response(content=ciphertext, status_code=status_code, headers=hdrs, media_type=media_type)


async def encrypted_json_response(
    request: Request,
    content: Any,
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
) -> Response:
    """Encrypt JSON content and return a Response with X-Enc and X-IV headers."""
    body = json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return await encrypted_bytes_response(
        request=request,
        content=body,
        status_code=status_code,
        headers=headers,
        media_type="application/octet-stream",
    )

async def partially_encrypted_json_response(
    request: Request,
    content: Dict[str, Any],
    list_key: str,
    plaintext_keys: Set[str],
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
) -> JSONResponse:
    """
    Encrypt selected fields inside a list under content[list_key].

    For each list element (dict):
    - Keys in plaintext_keys remain in plaintext.
    - Remaining keys are grouped, encrypted, and stored in encrypted_values.
    - Each element includes an iv field.

    Returns a JSONResponse with the transformed content.
    """
    start_time = time.perf_counter()
    key = await _get_key_enc_from_request(request)
    aesgcm = AESGCM(key)

    original_list = content.get(list_key)
    if not isinstance(original_list, list):
        raise ValueError(f"Key '{list_key}' in content for partial encryption is not a list.")

    processed_list = []
    for item in original_list:
        if not isinstance(item, dict):
            processed_list.append(item)
            continue

        plaintext_part = {k: v for k, v in item.items() if k in plaintext_keys}
        to_encrypt_part = {k: v for k, v in item.items() if k not in plaintext_keys}

        to_encrypt_body = json.dumps(
            to_encrypt_part, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")

        iv = os.urandom(12)
        ciphertext = aesgcm.encrypt(iv, to_encrypt_body, None)

        new_item = {
            **plaintext_part,
            "iv": base64url_encode(iv),
            "encrypted_values": base64url_encode(ciphertext),
        }
        processed_list.append(new_item)

    new_content = content.copy()
    new_content[list_key] = processed_list

    duration_ms = int((time.perf_counter() - start_time) * 1000)
    logger.info(
        f"partially_encrypted_response path='{request.url.path}' list_key='{list_key}' "
        f"items_count={len(processed_list)} duration_ms={duration_ms}"
    )

    return JSONResponse(content=new_content, status_code=status_code, headers=headers)
