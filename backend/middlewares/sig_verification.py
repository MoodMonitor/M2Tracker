import binascii
import hashlib
import json
import hmac
import time
from typing import Callable, Iterable, Optional

from fastapi import Request, status
from redis.exceptions import RedisError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import Message

from ..core.metrics import AUTH_FAILURES_TOTAL, PROMETHEUS_AVAILABLE
from ..config import settings
from ..core.encoding import base64url_decode, base64url_encode
from ..core.redis_client import get_redis
from ..core.request_utils import get_client_ip, get_masked_ip

from ..core.logging import get_logger

logger = get_logger("app.api.sig_middleware")


def _path_is_secure(path: str, prefixes_csv: str) -> bool:
    prefixes: Iterable[str] = (p.strip() for p in prefixes_csv.split(",") if p and p.strip())
    return any(path.startswith(p) for p in prefixes)


def _log_and_return_error(
    status_code: int,
    detail: str,
    request: Request,
    reason: Optional[str] = None,
) -> JSONResponse:
    """Log auth errors and return a generic JSON response."""
    client = request.client.host if request.client else "-"
    logger.warning(
        "auth_error status=%s detail='%s' path='%s' client='%s'",
        status_code,
        detail,
        request.url.path,
        client,
    )
    if PROMETHEUS_AVAILABLE and reason:
        path = request.url.path
        AUTH_FAILURES_TOTAL.labels(path=path, reason=reason).inc()

    return JSONResponse(
        status_code=status_code,
        content={"detail": "Failed to pass verification"},
    )


class SigVerificationMiddleware(BaseHTTPMiddleware):
    """
    Verify request signature (X-Sig) and protect against replay attacks:
      - Required headers: X-Sig, X-TS, X-Nonce.
      - Canonical string: method|path|body_hash|ts|nonce
      - body_hash = base64url(sha256(body or "")).
      - HMAC = HMAC_SHA256(key_sig, canon), constant-time compare.
      - Replay: Redis SET NX nonce:{sid}:{nonce} EX {ttl}.

    Middleware is active only for paths defined in Settings.secure_paths.
    """

    def __init__(self, app):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable):
        start_time = time.perf_counter()
        path = request.url.path
        client = request.client.host if request.client else "-"

        if request.method == "OPTIONS":
            return await call_next(request)

        if not _path_is_secure(path, settings.secure_paths):
            return await call_next(request)

        body: bytes = await request.body()
        await self._restore_body(request, body)

        redis = get_redis()
        if redis is None:
            return _log_and_return_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Secure session storage unavailable",
                request,
                reason="redis_unavailable",
            )

        sid, sid_error = self._extract_sid(request)
        if sid_error:
            return sid_error

        session_key = f"{settings.redis_prefix}:auth:{sid}"
        session_data, session_error = await self._get_session_data(redis, session_key, request)
        if session_error:
            return session_error

        bind_error = self._validate_session_binding(request, session_data, sid)
        if bind_error:
            return bind_error

        now_ms = int(time.time() * 1000)
        timing_error = self._validate_session_timing(request, session_data, now_ms)
        if timing_error:
            return timing_error

        key_sig_b64, key_enc_b64, keys_error = self._select_signature_keys(
            request,
            path,
            session_data,
            now_ms,
        )
        if keys_error:
            return keys_error

        ts_val_ms, ts_error = self._validate_timestamp(request, now_ms)
        if ts_error:
            return ts_error

        nonce, nonce_error = self._validate_nonce(request)
        if nonce_error:
            return nonce_error

        body_hash = self._compute_body_hash(path, body)
        canon = self._build_canonical(request, body_hash, ts_val_ms, nonce)

        signature_error = self._verify_signature(request, key_sig_b64, canon)
        if signature_error:
            return signature_error

        nonce_persist_error = await self._persist_nonce_and_refresh_activity(
            redis,
            sid,
            nonce,
            session_key,
            now_ms,
            request,
        )
        if nonce_persist_error:
            return nonce_persist_error

        request.state.secure_session = {
            "sid": sid,
            "key_sig": key_sig_b64,
            "key_enc": key_enc_b64,
        }

        verification_end_time = time.perf_counter()

        response = await call_next(request)

        call_next_end_time = time.perf_counter()

        new_expires_at = now_ms + settings.auth_session_ttl_ms
        response.headers["X-Session-Expires-At"] = str(new_expires_at)

        overhead_ms = int((verification_end_time - start_time) * 1000)
        downstream_ms = int((call_next_end_time - verification_end_time) * 1000)
        total_dur_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            "sig_verified path='%s' client='%s' total_dur_ms=%s "
            "overhead_ms=%s downstream_ms=%s",
            path,
            client,
            total_dur_ms,
            overhead_ms,
            downstream_ms,
        )
        return response

    @staticmethod
    def _extract_sid(request: Request) -> tuple[Optional[str], Optional[JSONResponse]]:
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Missing Authorization header",
                request,
                reason="missing_auth_header",
            )

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
            return None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Invalid Authorization header format. Expected 'Bearer <sid>'",
                request,
                reason="invalid_auth_header",
            )
        return parts[1], None

    @staticmethod
    async def _get_session_data(
        redis,
        session_key: str,
        request: Request,
    ) -> tuple[Optional[dict], Optional[JSONResponse]]:
        try:
            session_data = await redis.hgetall(session_key)
        except RedisError as e:
            logger.error("Redis connection error during session fetch: %s", e)
            return None, _log_and_return_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Session storage query failed",
                request,
                reason="redis_error",
            )

        if not session_data:
            return None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Invalid or expired session",
                request,
                reason="invalid_sid",
            )

        return session_data, None

    @staticmethod
    def _validate_session_binding(
        request: Request,
        session_data: dict,
        sid: str,
    ) -> Optional[JSONResponse]:
        if not settings.session_binding_enabled:
            return None

        stored_bind_hash = session_data.get("session_bind_hash")
        if not stored_bind_hash:
            return None

        client_ip = get_client_ip(request)
        masked_ip = get_masked_ip(
            client_ip,
            settings.session_binding_ipv4_mask,
            settings.session_binding_ipv6_mask,
        )
        current_bind_hash = hashlib.sha256(masked_ip.encode("utf-8")).hexdigest()

        if hmac.compare_digest(stored_bind_hash, current_bind_hash):
            return None

        user_agent_str = request.headers.get("user-agent", "")
        logger.warning(
            "session_binding_failed sid='%s' client='%s' ua='%s'",
            sid,
            client_ip,
            user_agent_str,
        )
        return _log_and_return_error(
            status.HTTP_401_UNAUTHORIZED,
            "Session binding validation failed",
            request,
            reason="session_binding_failed",
        )

    @staticmethod
    def _validate_session_timing(
        request: Request,
        session_data: dict,
        now_ms: int,
    ) -> Optional[JSONResponse]:
        try:
            created_at = int(session_data.get("created_at", 0))
            last_active = int(session_data.get("last_active", 0))
        except (TypeError, ValueError):
            return _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Corrupted session state",
                request,
                reason="corrupted_session",
            )

        if now_ms > created_at + settings.auth_session_max_age_ms:
            return _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Session has expired (max age reached)",
                request,
                reason="session_expired_max_age",
            )

        if now_ms > last_active + settings.auth_session_ttl_ms:
            return _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Session has expired (inactivity)",
                request,
                reason="session_expired_inactivity",
            )

        return None

    @staticmethod
    def _load_keys_from_json(raw_keys: Optional[str], key_name: str) -> tuple[Optional[str], Optional[str]]:
        if not raw_keys:
            return None, None
        parsed = json.loads(raw_keys)
        return parsed.get("key_sig"), parsed.get("key_enc")

    def _select_signature_keys(
        self,
        request: Request,
        path: str,
        session_data: dict,
        now_ms: int,
    ) -> tuple[Optional[str], Optional[str], Optional[JSONResponse]]:
        try:
            key_sig_b64, key_enc_b64 = self._load_keys_from_json(
                session_data.get("main_keys"),
                "main_keys",
            )
        except (json.JSONDecodeError, TypeError, ValueError):
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Corrupted session state",
                request,
                reason="corrupted_keys",
            )

        if not key_sig_b64 or not key_enc_b64:
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Corrupted session state",
                request,
                reason="corrupted_keys",
            )

        if not _path_is_secure(path, settings.worker_key_paths):
            return key_sig_b64, key_enc_b64, None

        worker_keys_json = session_data.get("worker_keys")
        worker_expires_at = session_data.get("worker_keys_expires_at")
        if not worker_keys_json or not worker_expires_at:
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Worker keys required but not found in session.",
                request,
                reason="worker_keys_missing",
            )

        try:
            worker_expires_at_ms = int(worker_expires_at)
        except (TypeError, ValueError):
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Corrupted worker keys in session.",
                request,
                reason="corrupted_worker_keys",
            )

        if now_ms > worker_expires_at_ms:
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Worker keys have expired.",
                request,
                reason="worker_keys_expired",
            )

        try:
            worker_key_sig_b64, worker_key_enc_b64 = self._load_keys_from_json(worker_keys_json, "worker_keys")
        except (json.JSONDecodeError, TypeError, ValueError):
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Corrupted worker keys in session.",
                request,
                reason="corrupted_worker_keys",
            )

        if not worker_key_sig_b64 or not worker_key_enc_b64:
            return None, None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Corrupted worker keys in session.",
                request,
                reason="corrupted_worker_keys",
            )

        return worker_key_sig_b64, worker_key_enc_b64, None

    @staticmethod
    def _validate_timestamp(request: Request, now_ms: int) -> tuple[Optional[int], Optional[JSONResponse]]:
        ts_header = request.headers.get("X-TS")
        if not ts_header:
            return None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Missing X-TS",
                request,
                reason="missing_xts",
            )

        try:
            ts_val_ms = int(ts_header)
        except (TypeError, ValueError):
            return None, _log_and_return_error(
                status.HTTP_400_BAD_REQUEST,
                "Invalid X-TS format",
                request,
                reason="invalid_xts",
            )

        if abs(now_ms - ts_val_ms) > settings.request_sig_skew_ms:
            return None, _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "X-TS outside allowed window",
                request,
                reason="xts_skew",
            )

        return ts_val_ms, None

    @staticmethod
    def _validate_nonce(request: Request) -> tuple[Optional[str], Optional[JSONResponse]]:
        nonce = request.headers.get("X-Nonce")
        if nonce:
            return nonce, None

        return None, _log_and_return_error(
            status.HTTP_401_UNAUTHORIZED,
            "Missing X-Nonce",
            request,
            reason="missing_nonce",
        )

    @staticmethod
    def _compute_body_hash(path: str, body: bytes) -> str:
        if _path_is_secure(path, settings.sig_exclude_body_hash_paths):
            return ""
        digest = hashlib.sha256(body or b"").digest()
        return base64url_encode(digest)

    @staticmethod
    def _build_canonical(request: Request, body_hash: str, ts_val_ms: int, nonce: str) -> str:
        return "|".join([
            request.method.upper(),
            request.url.path,
            body_hash,
            str(ts_val_ms),
            nonce,
        ])

    @staticmethod
    def _verify_signature(
        request: Request,
        key_sig_b64: str,
        canon: str,
    ) -> Optional[JSONResponse]:
        try:
            key_sig = base64url_decode(key_sig_b64)
        except (binascii.Error, TypeError, ValueError):
            return _log_and_return_error(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Invalid server session key",
                request,
                reason="invalid_server_key",
            )

        x_sig = request.headers.get("X-Sig")
        if not x_sig:
            return _log_and_return_error(
                status.HTTP_401_UNAUTHORIZED,
                "Missing X-Sig",
                request,
                reason="missing_xsig",
            )

        mac = hmac.new(key_sig, canon.encode("utf-8"), hashlib.sha256).digest()
        mac_b64 = base64url_encode(mac)
        if hmac.compare_digest(mac_b64, x_sig):
            return None

        return _log_and_return_error(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid signature",
            request,
            reason="invalid_xsig",
        )

    @staticmethod
    async def _persist_nonce_and_refresh_activity(
        redis,
        sid: str,
        nonce: str,
        session_key: str,
        now_ms: int,
        request: Request,
    ) -> Optional[JSONResponse]:
        nonce_key = f"{settings.redis_prefix}:nonce:{sid}:{nonce}"
        try:
            nonce_ttl_s = max(1, settings.nonce_ttl_ms // 1000)
            nonce_added = await redis.set(nonce_key, "1", ex=nonce_ttl_s, nx=True)
            if not nonce_added:
                return _log_and_return_error(
                    status.HTTP_401_UNAUTHORIZED,
                    "Replay detected",
                    request,
                    reason="replay_detected",
                )

            await redis.hset(session_key, "last_active", str(now_ms))
        except RedisError as e:
            logger.error(
                "Redis connection error during nonce check/session update: %s",
                e,
            )
            return _log_and_return_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Session state update failed",
                request,
                reason="redis_error",
            )

        return None


    @staticmethod
    async def _restore_body(request: Request, body: bytes) -> None:
        async def receive() -> Message:
            return {"type": "http.request", "body": body, "more_body": False}
        request._receive = receive
