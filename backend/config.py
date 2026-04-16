"""Application configuration loaded from environment variables."""

import os
from dataclasses import dataclass
from typing import Optional


_TRUE_VALUES = {"1", "true", "yes"}


def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in _TRUE_VALUES


def _csv_paths(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item and item.strip()]


@dataclass
class Settings:
    # Environment
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    # Database
    database_url: str = os.getenv("DB_URL")
    pool_size: int = int(os.getenv("DB_POOL_SIZE", "10"))
    max_overflow: int = int(os.getenv("DB_MAX_OVERFLOW", "25"))
    pool_timeout: int = int(os.getenv("DB_POOL_TIMEOUT", "30"))
    pool_recycle: int = int(os.getenv("DB_POOL_RECYCLE", "1800"))
    # DB driver-level timeouts (PyMySQL)
    connect_timeout_s: int = int(os.getenv("DB_CONNECT_TIMEOUT_S", "10"))
    read_timeout_s: int = int(os.getenv("DB_READ_TIMEOUT_S", "3"))
    write_timeout_s: int = int(os.getenv("DB_WRITE_TIMEOUT_S", "5"))
    # Server/session timeouts
    statement_timeout_ms: int = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "5000"))
    lock_wait_timeout_s: int = int(os.getenv("DB_LOCK_WAIT_TIMEOUT_S", "5"))

    # API
    api_title: str = os.getenv("API_TITLE", "M2Tracker API")
    api_version: str = os.getenv("API_VERSION", "1.0.0")
    api_description: str = os.getenv("API_DESCRIPTION", "M2Tracker API")
    debug: bool = _env_bool("DEBUG", "false")

    # Web server
    web_workers: Optional[int] = int(os.getenv("WEB_WORKERS")) if os.getenv("WEB_WORKERS") else 1

    # Rate limiting (slowapi + redis)
    rate_limit_enabled: bool = _env_bool("RATE_LIMIT_ENABLED", "true")
    rate_limit_global: str = os.getenv("RATE_LIMIT_GLOBAL", "60/minute")

    # Logging
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    log_json: bool = _env_bool("LOG_JSON", "true")
    log_file: Optional[str] = os.getenv("LOG_FILE", "apilog.log")

    # CORS
    cors_allow_origins: str = os.getenv("CORS_ALLOW_ORIGINS", "")

    # Metrics / Monitoring
    INTERNAL_API_KEY: str = os.getenv("INTERNAL_API_KEY", "")
    metrics_enabled: bool = _env_bool("METRICS_ENABLED", "true")
    metrics_path: str = os.getenv("METRICS_PATH", "/metrics")
    prometheus_multiproc_dir: Optional[str] = os.getenv("PROMETHEUS_MULTIPROC_DIR", None)

    # Redis
    redis_enabled: bool = _env_bool("REDIS_ENABLED", "true")
    redis_url: Optional[str] = os.getenv("REDIS_URL")
    redis_sock: Optional[str] = os.getenv("REDIS_SOCK")
    redis_password: Optional[str] = os.getenv("REDIS_PASSWORD")
    redis_prefix: str = os.getenv("REDIS_PREFIX", "dbmp")
    redis_indexing_chunk_size: int = int(os.getenv("REDIS_INDEXING_CHUNK_SIZE", "5000"))

    # Cloudflare Turnstile
    turnstile_secret: Optional[str] = os.getenv("TURNSTILE_SECRET")
    turnstile_secret_invisible: Optional[str] = os.getenv("TURNSTILE_SECRET_INVISIBLE")
    turnstile_timeout_s: int = int(os.getenv("TURNSTILE_TIMEOUT_S", "5"))

    # Auth session TTLs (milliseconds)
    auth_session_ttl_ms: int = int(os.getenv("AUTH_SESSION_TTL_MS", "600000"))  # 10 minutes
    auth_session_max_age_ms: int = int(os.getenv("AUTH_SESSION_MAX_AGE_MS", "7200000"))  # 2 hours

    # Secure signature verification (X-Sig)
    request_sig_skew_ms: int = int(os.getenv("REQUEST_SIG_SKEW_MS", "13000"))
    nonce_ttl_ms: int = int(os.getenv("NONCE_TTL_MS", "13000"))
    sig_exclude_body_hash_paths: str = os.getenv(
        "SIG_EXCLUDE_BODY_HASH_PATHS", "/api/v1/dashboard/feedback/ai-calculator"
    )
    secure_paths: str = os.getenv("SECURE_PATHS", "/api/v1/dashboard,/auth/chart-worker,/auth/logout,/auth/status")

    # Session Binding
    session_binding_enabled: bool = _env_bool("SESSION_BINDING_ENABLED", "true")
    session_binding_ipv4_mask: int = int(os.getenv("SESSION_BINDING_IPV4_MASK", "32"))
    session_binding_ipv6_mask: int = int(os.getenv("SESSION_BINDING_IPV6_MASK", "128"))
    # Proxy headers are trusted only when TCP peer is one of these IPs/CIDRs.
    trusted_proxy_ips: str = os.getenv("TRUSTED_PROXY_IPS", "127.0.0.1,::1")

    # Paths verified with worker keys
    worker_key_paths: str = os.getenv("WORKER_KEY_PATHS", "/api/v1/dashboard/simple_items/daily-window")
    worker_keys_ttl_ms: int = int(os.getenv("WORKER_KEYS_TTL_MS", "30000"))  # 30 seconds

    # Maximum concurrent sessions per IP. Set 0 to disable.
    max_sessions_per_ip: int = int(os.getenv("MAX_SESSIONS_PER_IP", "3"))

    # --- Feedback Endpoint Settings ---
    feedback_storage_path: str = os.getenv("FEEDBACK_STORAGE_PATH", "feedback_data")
    feedback_max_image_mb: float = float(os.getenv("FEEDBACK_MAX_IMAGE_MB", "1.0"))
    feedback_max_image_width: int = int(os.getenv("FEEDBACK_MAX_IMAGE_WIDTH", "800"))
    feedback_max_image_height: int = int(os.getenv("FEEDBACK_MAX_IMAGE_HEIGHT", "800"))
    feedback_max_json_kb: int = int(os.getenv("FEEDBACK_MAX_JSON_KB", "512"))

    # --- Concurrency Settings ---
    feedback_concurrency_limit: int = int(os.getenv("FEEDBACK_CONCURRENCY_LIMIT", "2"))
    feedback_image_hash_ttl_s: int = int(os.getenv("FEEDBACK_IMAGE_HASH_TTL_S", "86400"))

    # --- Bug Report Endpoint Settings ---
    bug_report_storage_path: str = os.getenv("BUG_REPORT_STORAGE_PATH", "bug_reports_data")
    bug_report_concurrency_limit: int = int(os.getenv("BUG_REPORT_CONCURRENCY_LIMIT", "2"))
    bug_report_hash_ttl_s: int = int(os.getenv("BUG_REPORT_HASH_TTL_S", "3600"))

    # --- AI Assets Encryption ---
    AI_ASSETS_KEY_B64: Optional[str] = os.getenv("AI_ASSETS_KEY_B64")

    def __post_init__(self) -> None:
        env = (self.ENVIRONMENT or "development").strip().lower()
    
        if not self.database_url:
            raise ValueError("DB_URL environment variable is required")
    
        if self.max_sessions_per_ip < 0:
            raise ValueError("MAX_SESSIONS_PER_IP cannot be negative")
    
        if self.session_binding_ipv4_mask < 0 or self.session_binding_ipv4_mask > 32:
            raise ValueError("SESSION_BINDING_IPV4_MASK must be between 0 and 32")
    
        if self.session_binding_ipv6_mask < 0 or self.session_binding_ipv6_mask > 128:
            raise ValueError("SESSION_BINDING_IPV6_MASK must be between 0 and 128")
    
        if self.request_sig_skew_ms <= 0:
            raise ValueError("REQUEST_SIG_SKEW_MS must be greater than 0")
    
        if self.nonce_ttl_ms <= 0:
            raise ValueError("NONCE_TTL_MS must be greater than 0")
    
        if self.auth_session_ttl_ms <= 0:
            raise ValueError("AUTH_SESSION_TTL_MS must be greater than 0")
    
        if self.auth_session_max_age_ms <= 0:
            raise ValueError("AUTH_SESSION_MAX_AGE_MS must be greater than 0")
    
        if self.auth_session_ttl_ms > self.auth_session_max_age_ms:
            raise ValueError("AUTH_SESSION_TTL_MS cannot be greater than AUTH_SESSION_MAX_AGE_MS")
    
        if self.worker_keys_ttl_ms <= 0:
            raise ValueError("WORKER_KEYS_TTL_MS must be greater than 0")
    
        if self.worker_keys_ttl_ms > self.auth_session_max_age_ms:
            raise ValueError("WORKER_KEYS_TTL_MS cannot be greater than AUTH_SESSION_MAX_AGE_MS")
    
        secure_prefixes = _csv_paths(self.secure_paths)
        worker_prefixes = _csv_paths(self.worker_key_paths)
        excluded_body_hash_prefixes = _csv_paths(self.sig_exclude_body_hash_paths)
    
        for prefix in secure_prefixes + worker_prefixes + excluded_body_hash_prefixes:
            if not prefix.startswith("/"):
                raise ValueError("All path prefixes must start with '/'")
    
        if secure_prefixes:
            for worker_prefix in worker_prefixes:
                if not any(worker_prefix.startswith(secure_prefix) for secure_prefix in secure_prefixes):
                    raise ValueError("WORKER_KEY_PATHS entries must be covered by SECURE_PATHS")
    
            for excluded_prefix in excluded_body_hash_prefixes:
                if not any(excluded_prefix.startswith(secure_prefix) for secure_prefix in secure_prefixes):
                    raise ValueError("SIG_EXCLUDE_BODY_HASH_PATHS entries must be covered by SECURE_PATHS")
    
        if env in {"production", "staging"}:
            if not self.INTERNAL_API_KEY:
                raise ValueError("INTERNAL_API_KEY environment variable is required in production/staging")
            if not self.turnstile_secret:
                raise ValueError("TURNSTILE_SECRET environment variable is required in production/staging")
            if not self.turnstile_secret_invisible:
                raise ValueError("TURNSTILE_SECRET_INVISIBLE environment variable is required in production/staging")
            if not self.AI_ASSETS_KEY_B64:
                raise ValueError("AI_ASSETS_KEY_B64 environment variable is required in production/staging")
    
            if self.debug:
                raise ValueError("DEBUG must be False in production/staging")
    
            origin_list = [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]
            if not origin_list or "*" in origin_list:
                raise ValueError(
                    "CORS_ALLOW_ORIGINS wildcard (*) is not allowed in production/staging. Specify allowed origins."
                )
    
            if not secure_prefixes:
                raise ValueError("SECURE_PATHS cannot be empty in production/staging")
    
            db_lower = self.database_url.lower()
            if "localhost" in db_lower or "127.0.0.1" in db_lower:
                raise ValueError("Production/staging cannot use localhost database")


settings = Settings()
