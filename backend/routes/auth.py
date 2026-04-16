import secrets
import time
import json
from typing import Any, Dict, Tuple
import hashlib

import httpx
from fastapi import APIRouter, Request, Response, Depends, status
import user_agents
from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from redis.exceptions import RedisError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import settings
from ..core.encoding import base64url_decode, base64url_encode
from .schemas import (
    AuthDashboardRequest,
    AuthDashboardResponse,
    AuthChartWorkerRequest,
    AuthChartWorkerResponse,
    AIAssetsKeyResponse,
)
from .utils.encryption import (
    generate_secure_random_string,
    encrypted_json_response,
    _get_key_enc_from_request,
)
from ..core.exceptions import AuthenticationError, InvalidInputException, ServiceUnavailableException
from ..core.redis_client import get_redis
from ..core.limiter import limiter
from ..core.request_utils import get_client_ip, get_masked_ip

router = APIRouter()

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def _verify_turnstile(request: Request, token: str, cdata_to_match: str, use_invisible: bool = False):
    """Verify a Cloudflare Turnstile token and its associated cdata."""
    secret = settings.turnstile_secret_invisible if use_invisible else settings.turnstile_secret

    if not secret:
        widget_name = "Invisible Turnstile" if use_invisible else "Turnstile"
        raise ServiceUnavailableException(f"{widget_name} service is not configured on the server.")

    client_ip = get_client_ip(request)
    data = {"secret": secret, "response": token}
    if client_ip:
        data["remoteip"] = client_ip

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(TURNSTILE_VERIFY_URL, data=data, timeout=settings.turnstile_timeout_s)
        r.raise_for_status()
        body: Dict[str, Any] = r.json()
    except httpx.RequestError:
        raise ServiceUnavailableException("Could not contact Turnstile verification service.")
    except ValueError:
        raise ServiceUnavailableException("Turnstile verification service returned invalid JSON.")

    if not body.get("success"):
        errors = body.get("error-codes") or []
        raise AuthenticationError(f"Turnstile verification failed. Error codes: {errors}")

    if body.get("cdata") != cdata_to_match:
        raise AuthenticationError("Turnstile token challenge mismatch (cdata).")


def _perform_ecdh_and_derive_keys(
    client_pubkey_b64: str, info_enc: bytes, info_sig: bytes
) -> Tuple[str, str, bytes, bytes]:
    """
    Perform X25519 key exchange and derive encryption/signing keys via HKDF.

    Returns: (server_public_key_b64, salt_b64, key_enc_bytes, key_sig_bytes).
    """
    server_private_key = x25519.X25519PrivateKey.generate()
    server_public_key = server_private_key.public_key()
    server_pubkey_bytes = server_public_key.public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )

    try:
        client_pubkey_bytes = base64url_decode(client_pubkey_b64)
        client_public_key = x25519.X25519PublicKey.from_public_bytes(client_pubkey_bytes)
    except (TypeError, ValueError):
        raise InvalidInputException("Invalid client public key format.")

    try:
        shared_secret = server_private_key.exchange(client_public_key)
    except ValueError:
        raise InvalidInputException("Key exchange failed, likely due to an invalid client public key.")

    salt = secrets.token_bytes(16)
    key_enc = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info_enc).derive(shared_secret)
    key_sig = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info_sig).derive(shared_secret)

    return base64url_encode(server_pubkey_bytes), base64url_encode(salt), key_enc, key_sig


def _get_ip_session_key(redis_prefix: str, client_ip: str) -> str:
    """Build the Redis key for tracking sessions by IP."""
    return f"{redis_prefix}:ip_sessions:{client_ip}"


async def _enforce_session_limit(redis, client_ip: str):
    """
    Enforce the per-IP session limit. If exceeded, remove the oldest sessions.
    """
    if not settings.max_sessions_per_ip > 0:
        return

    ip_session_key = _get_ip_session_key(settings.redis_prefix, client_ip)

    # Fetch all session IDs for the IP (oldest first).
    raw_session_ids = await redis.zrange(ip_session_key, 0, -1)
    session_ids = [
        sid.decode("utf-8") if isinstance(sid, bytes) else sid
        for sid in raw_session_ids
    ]

    num_to_remove = len(session_ids) - settings.max_sessions_per_ip + 1 if settings.max_sessions_per_ip > 0 else 0
    if num_to_remove <= 0:
        return

    sids_to_remove = session_ids[:num_to_remove]

    pipe = redis.pipeline()
    for sid in sids_to_remove:
        pipe.delete(f"{settings.redis_prefix}:auth:{sid}")

        cursor = '0'
        while cursor != 0:
            cursor, keys = await redis.scan(cursor=cursor, match=f"{settings.redis_prefix}:nonce:{sid}:*")
            if keys:
                pipe.delete(*keys)

        pipe.zrem(ip_session_key, sid)

    try:
        await pipe.execute()
    except RedisError:
        pass


@router.post(
    "/auth/dashboard",
    response_model=AuthDashboardResponse,
    tags=["auth"],
    summary="Verify Turnstile token and issue session public key + salt/sid/ttl",
)
@limiter.limit("5/minute")
async def auth_dashboard(request: Request, payload: AuthDashboardRequest, response: Response) -> AuthDashboardResponse:
    await _verify_turnstile(request, payload.token, payload.client_pubkey)

    server_pubkey_b64, salt_b64, key_enc, key_sig = _perform_ecdh_and_derive_keys(
        client_pubkey_b64=payload.client_pubkey,
        info_enc=b"keyEnc",
        info_sig=b"keySig",
    )

    client_ip = get_client_ip(request)
    if settings.max_sessions_per_ip > 0:
        if not client_ip:
            raise InvalidInputException("Could not determine client IP address for session creation.")

        redis = get_redis()
        if not redis:
            raise ServiceUnavailableException("Session storage is unavailable.")
        await _enforce_session_limit(redis, client_ip)

    sid = generate_secure_random_string(18)
    sliding_ttl_ms = settings.auth_session_ttl_ms
    max_age_ms = settings.auth_session_max_age_ms

    redis_mapping = {
        "main_keys": json.dumps({
            "key_sig": base64url_encode(key_sig),
            "key_enc": base64url_encode(key_enc),
        }),
        "salt": salt_b64,
        "client_pubkey": payload.client_pubkey,
        "server_pubkey": server_pubkey_b64,
        "created_at": str(int(time.time() * 1000)),
        "last_active": str(int(time.time() * 1000)),
    }

    # Add session binding hash if enabled
    if settings.session_binding_enabled:
        masked_ip = get_masked_ip(
            client_ip,
            settings.session_binding_ipv4_mask,
            settings.session_binding_ipv6_mask,
        )
        bind_string = f"{masked_ip}"
        redis_mapping["session_bind_hash"] = hashlib.sha256(bind_string.encode("utf-8")).hexdigest()

    try:
        redis = get_redis()
        if not redis:
            raise ServiceUnavailableException("Session storage is unavailable.")

        now_ms = int(time.time() * 1000)
        key = f"{settings.redis_prefix}:auth:{sid}"

        pipe = redis.pipeline()
        pipe.hset(key, mapping=redis_mapping)
        pipe.expire(key, max_age_ms // 1000)

        if settings.max_sessions_per_ip > 0 and client_ip:
            ip_session_key = _get_ip_session_key(settings.redis_prefix, client_ip)
            pipe.zadd(ip_session_key, {sid: now_ms})
            pipe.expire(ip_session_key, max_age_ms // 1000)

        await pipe.execute()
    except RedisError:
        raise ServiceUnavailableException("Session storage is unavailable.")

    return AuthDashboardResponse(
        server_pubkey=server_pubkey_b64,
        salt=salt_b64,
        sid=sid,
        ttl=sliding_ttl_ms,
    )


@router.post(
    "/auth/chart-worker",
    response_model=AuthChartWorkerResponse,
    tags=["auth"],
    summary="Establish a secondary, short-lived key set for a worker (e.g., for charts).",
    description="This endpoint must be called with a valid main session signature (X-Sig). "
                "It performs a new ECDH handshake to generate 'worker_keys' which are added to the existing session.",
)
@limiter.limit("5/minute")
async def auth_chart_worker(request: Request, payload: AuthChartWorkerRequest, response: Response) -> AuthChartWorkerResponse:
    secure_session = getattr(request.state, "secure_session", None)
    if not secure_session or not secure_session.get("sid"):
        raise AuthenticationError("A valid main session is required to authorize a worker.")
    sid = secure_session["sid"]

    await _verify_turnstile(request, payload.token, payload.client_pubkey)

    server_pubkey_b64, salt_b64, key_enc_worker, key_sig_worker = _perform_ecdh_and_derive_keys(
        client_pubkey_b64=payload.client_pubkey,
        info_enc=b"keyEnc_worker",
        info_sig=b"keySig_worker",
    )

    redis = get_redis()
    if not redis:
        raise ServiceUnavailableException("Session storage is unavailable.")

    key = f"{settings.redis_prefix}:auth:{sid}"
    worker_keys_ttl_ms = settings.worker_keys_ttl_ms
    expires_at_ms = int(time.time() * 1000) + worker_keys_ttl_ms

    worker_keys_data = {
        "key_sig": base64url_encode(key_sig_worker),
        "key_enc": base64url_encode(key_enc_worker),
    }

    try:
        await redis.hset(key, mapping={
            "worker_keys": json.dumps(worker_keys_data),
            "worker_keys_expires_at": str(expires_at_ms),
            "last_active": str(int(time.time() * 1000)),
        })
    except RedisError:
        raise ServiceUnavailableException("Session storage update failed.")

    return AuthChartWorkerResponse(
        server_pubkey=server_pubkey_b64,
        salt=salt_b64,
        ttl=worker_keys_ttl_ms,
    )


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["auth"],
    summary="Log out and invalidate the current session.",
)
@limiter.limit("5/minute")
async def logout(request: Request, response: Response):
    """
    Logs the user out by deleting their session from Redis and clearing the session cookie.
    This endpoint must be protected by the main session signature.
    """
    secure_session = getattr(request.state, "secure_session", None)
    if not secure_session or not (sid := secure_session.get("sid")):
        raise AuthenticationError("No active session to log out.")

    redis = get_redis()
    if redis:
        client_ip = get_client_ip(request)
        key = f"{settings.redis_prefix}:auth:{sid}"

        pipe = redis.pipeline()
        pipe.delete(key)
        if client_ip and settings.max_sessions_per_ip > 0:
            ip_session_key = _get_ip_session_key(settings.redis_prefix, client_ip)
            pipe.zrem(ip_session_key, sid)

        try:
            await pipe.execute()
        except RedisError:
            pass

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/auth/status",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["auth"],
    summary="Check if the current session is active and valid.",
    description="A lightweight endpoint to verify the session cookie and its signature. "
                "If the session is valid, it returns 204 No Content. "
                "If the session is invalid, expired, or the signature is wrong, "
                "the SigVerificationMiddleware will return a 401 Unauthorized error. "
                "This endpoint is protected by X-Sig."
)
@limiter.limit("5/minute")
async def get_session_status(request: Request):
    """
    Checks the validity of the current session. The actual verification is performed
    by the SigVerificationMiddleware. If the middleware passes, the session is considered valid.
    """
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/auth/ai",
    response_model=AIAssetsKeyResponse,
    tags=["auth", "ai"],
    summary="Provides an encrypted key for AI assets. (Requires valid session)",
)
@limiter.limit("5/minute")
async def get_ai_assets_key(
        request: Request,
) -> AIAssetsKeyResponse:
    """
    Provides the static key for decrypting AI assets, encrypted with the user's session key.

    This endpoint is protected by the main session signature (X-Sig). It retrieves the
    static AI assets key from the server configuration, encrypts it using the client's
    session encryption key (`keyEnc`), and returns it in a JSON response.

    The response format is `{"encrypted_key": "base64url_encoded_payload"}` where the
    payload is `[12-byte-iv] + [encrypted-key]`. The client must use its `keyEnc`
    to decrypt this payload.
    """
    if not settings.AI_ASSETS_KEY_B64:
        raise ServiceUnavailableException(
            detail="AI asset encryption key is not configured on the server."
        )

    session_key_enc = await _get_key_enc_from_request(request)

    iv = secrets.token_bytes(12)
    aesgcm = AESGCM(session_key_enc)
    ai_assets_key_bytes = base64url_decode(settings.AI_ASSETS_KEY_B64)
    encrypted_ai_key = aesgcm.encrypt(iv, ai_assets_key_bytes, None)

    encrypted_payload = base64url_encode(iv + encrypted_ai_key)
    return AIAssetsKeyResponse(encrypted_key=encrypted_payload)
