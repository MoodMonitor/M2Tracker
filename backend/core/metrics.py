import os
import threading
import time
import uuid
from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse, HTMLResponse
from .logging import (
    get_logger,
    request_id_var,
    client_ip_var,
    path_var,
    method_var,
)

# Optional Prometheus client
PROMETHEUS_AVAILABLE = True
try:
    from prometheus_client import (
        Counter,
        Histogram,
        Gauge,
        CONTENT_TYPE_LATEST,
        generate_latest,
        multiprocess,
        CollectorRegistry,
        REGISTRY,
    )
except Exception:
    PROMETHEUS_AVAILABLE = False

# Paths to exclude from metrics collection (prefix match)
IGNORE_PATH_PREFIXES: set[str] = set()


# Module-level state for min/max tracking per worker process for HTTP requests
_http_min_max_state = {}  # key: (method, path), value: {'min': float, 'max': float}
_http_min_max_lock = threading.Lock()

PROMETHEUS_MULTIPROC_DIR = os.environ.get("PROMETHEUS_MULTIPROC_DIR")

def set_metrics_ignore_paths(paths: list[str]) -> None:
    global IGNORE_PATH_PREFIXES
    IGNORE_PATH_PREFIXES = {p.rstrip("/") or "/" for p in paths}


# -------------------------
# HTTP metrics
# -------------------------
if PROMETHEUS_AVAILABLE:
    HTTP_REQUESTS_TOTAL = Counter(
        "http_requests_total",
        "Total HTTP requests by method, path template and status",
        ["method", "path", "status"],
    )
    HTTP_REQUEST_DURATION_SECONDS = Histogram(
        "http_request_duration_seconds",
        "HTTP request duration in seconds",
        ["method", "path", "status"],
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
    )
    HTTP_REQUEST_CPU_SECONDS = Histogram(
        "http_request_cpu_seconds",
        "HTTP request CPU time in seconds (user + system)",
        ["method", "path", "status"],
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
    )
    HTTP_IN_PROGRESS = Gauge(
        "http_requests_in_progress",
        "In-progress HTTP requests",
        ["method", "path"],
    )
    HTTP_EXCEPTIONS_TOTAL = Counter(
        "http_exceptions_total", "Total unhandled exceptions while processing requests", ["method", "path"]
    )
    AUTH_FAILURES_TOTAL = Counter(
        "auth_failures",
        "Total authentication/verification failures by reason",
        ["path", "reason"],
    )
    RATE_LIMIT_HITS_TOTAL = Counter(
        "rate_limit_hits",
        "Total requests rejected by the rate limiter",
        ["path"],
    )
    REPO_METHOD_DURATION_SECONDS = Histogram(
        "repo_method_duration_seconds",
        "Repository method duration in seconds",
        ["repo", "method"],
        buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5),
    )
    REPO_METHOD_MIN_DURATION_SECONDS = Gauge(
        "repo_method_min_duration_seconds",
        "Min repository method duration in seconds",
        ["repo", "method"],
    )
    REPO_METHOD_MAX_DURATION_SECONDS = Gauge(
        "repo_method_max_duration_seconds",
        "Max repository method duration in seconds",
        ["repo", "method"],
    )
    HTTP_REQUEST_MIN_DURATION_SECONDS = Gauge(
        "http_request_min_duration_seconds",
        "Min HTTP request duration in seconds",
        ["method", "path"],
    )
    HTTP_REQUEST_MAX_DURATION_SECONDS = Gauge(
        "http_request_max_duration_seconds",
        "Max HTTP request duration in seconds",
        ["method", "path"],
    )


class MetricsMiddleware(BaseHTTPMiddleware):
    """ASGI middleware recording request metrics (no-op if Prometheus not available)."""

    async def dispatch(self, request: Request,
                       call_next: Callable[[Request], Response]) -> Response:  # type: ignore[override]
        logger = get_logger("app.api")
        if not PROMETHEUS_AVAILABLE:
            return await call_next(request)

        method = request.method
        path = request.url.path
        # Prefer route path template (e.g. /items/{id}) to limit cardinality
        route = request.scope.get("route")
        path_label = getattr(route, "path", path) if route else path

        # Skip noisy endpoints (e.g., /metrics itself, favicon)
        if path_label in {"/favicon.ico"} or any(
                path_label == p or path_label.startswith(p + "/") for p in IGNORE_PATH_PREFIXES
        ):
            return await call_next(request)

        # --- Logging context (moved from RequestLoggingMiddleware) ---
        start = time.perf_counter()
        cpu_start = time.thread_time()
        req_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        client_ip = request.client.host if request.client else "-"
        ua = request.headers.get("user-agent", "-")
        referer = request.headers.get("referer") or request.headers.get("referrer") or "-"

        # Set contextvars so they are available in all logs
        token_req = request_id_var.set(req_id)
        token_ip = client_ip_var.set(client_ip)
        token_path = path_var.set(path_label)
        token_method = method_var.set(method)
        request.state.request_id = req_id

        # Optional log at request start
        logger.debug(f"request_started user_agent='{ua}' referer='{referer}'")

        HTTP_IN_PROGRESS.labels(method=method, path=path_label).inc()
        status = 500
        resp_bytes = None
        try:
            response = await call_next(request)
            status = response.status_code
            resp_bytes = response.headers.get("content-length")
            return response
        except Exception as e:
            # Count exception separately (FastAPI/Starlette will generate a 500 later)
            try:
                HTTP_EXCEPTIONS_TOTAL.labels(method=method, path=path_label).inc()
            except Exception:
                pass
            # Log unhandled exception
            logger.error(
                f"unhandled_exception: {e}",
                exc_info=True,
            )
            raise
        finally:
            # Log request summary
            wall_elapsed = time.perf_counter() - start
            cpu_elapsed = time.thread_time() - cpu_start
            dur_ms = int(wall_elapsed * 1000)

            logger.info(
                f"request_finished status={status} duration_ms={dur_ms} bytes_out={resp_bytes}"
            )

            try:
                HTTP_IN_PROGRESS.labels(method=method, path=path_label).dec()
                HTTP_REQUESTS_TOTAL.labels(method=method, path=path_label, status=str(status)).inc()
                HTTP_REQUEST_DURATION_SECONDS.labels(
                    method=method, path=path_label, status=str(status)
                ).observe(wall_elapsed)
                HTTP_REQUEST_CPU_SECONDS.labels(
                    method=method, path=path_label, status=str(status)
                ).observe(cpu_elapsed)

                # Gauges for min/max
                http_labels = {"method": method, "path": path_label}
                key = (method, path_label)
                with _http_min_max_lock:
                    state = _http_min_max_state.setdefault(key, {"min": float("inf"), "max": float("-inf")})
                    if wall_elapsed < state["min"]:
                        state["min"] = wall_elapsed
                        HTTP_REQUEST_MIN_DURATION_SECONDS.labels(**http_labels).set(wall_elapsed)
                    if wall_elapsed > state["max"]:
                        state["max"] = wall_elapsed
                        HTTP_REQUEST_MAX_DURATION_SECONDS.labels(**http_labels).set(wall_elapsed)
            except Exception:
                pass
            
            # Set response headers if a response exists
            try:
                response.headers["X-Request-ID"] = req_id
                response.headers["X-Process-Time"] = str(dur_ms)
            except NameError:  # response does not exist if call_next raised
                pass

            # Reset contextvars
            request_id_var.reset(token_req)
            client_ip_var.reset(token_ip)
            path_var.reset(token_path)
            method_var.reset(token_method)


# -------------------------
# SQLAlchemy/DB metrics
# -------------------------
if PROMETHEUS_AVAILABLE:
    DB_POOL_CHECKOUTS_TOTAL = Counter("db_pool_checkouts_total", "Total DB pool checkouts")
    DB_POOL_CHECKINS_TOTAL = Counter("db_pool_checkins_total", "Total DB pool checkins")
    DB_POOL_CONNECTIONS = Gauge(
        "db_pool_connections", "Number of DBAPI connections currently opened by the pool"
    )
    DB_POOL_IN_USE = Gauge(
        "db_pool_in_use", "Number of DB connections currently checked out (in use)"
    )
    DB_EXECUTE_TOTAL = Counter(
        "db_execute_total", "Total DB statements executed", ["statement_type"]
    )
    DB_EXECUTE_SECONDS = Histogram(
        "db_execute_seconds", "DB statement execution time in seconds", ["statement_type"],
        buckets=(0.001, 0.003, 0.007, 0.015, 0.03, 0.06, 0.12, 0.25, 0.5, 1, 2, 5)
    )


def _classify_sql(text: str) -> str:
    t = text.strip().split()
    if not t:
        return "other"
    return t[0].upper()


def instrument_sqlalchemy_engine(engine) -> None:
    """Attach lightweight pool + execution metrics to a SQLAlchemy Engine.

    Safe to call multiple times; listeners will be added only once per engine.
    No-ops if Prometheus client is unavailable.
    """
    if not PROMETHEUS_AVAILABLE:
        return
    try:
        from sqlalchemy import event
    except Exception:
        return

    # Check flag to avoid double instrumentation
    if getattr(engine, "_metrics_instrumented", False):
        return

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, connection_record):  # noqa: ANN001
        try:
            DB_POOL_CONNECTIONS.inc()
        except Exception:
            pass

    @event.listens_for(engine, "close")
    def _on_close(dbapi_conn, connection_record):  # noqa: ANN001
        try:
            DB_POOL_CONNECTIONS.dec()
        except Exception:
            pass

    @event.listens_for(engine, "checkout")
    def _on_checkout(dbapi_conn, connection_record, connection_proxy):  # noqa: ANN001
        try:
            DB_POOL_CHECKOUTS_TOTAL.inc()
            DB_POOL_IN_USE.inc()
        except Exception:
            pass

    @event.listens_for(engine, "checkin")
    def _on_checkin(dbapi_conn, connection_record):  # noqa: ANN001
        try:
            DB_POOL_CHECKINS_TOTAL.inc()
            DB_POOL_IN_USE.dec()
        except Exception:
            pass

    @event.listens_for(engine, "before_cursor_execute")
    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        try:
            context._metrics_start = time.perf_counter()  # type: ignore[attr-defined]
            context._metrics_stmt_type = _classify_sql(statement)  # type: ignore[attr-defined]
        except Exception:
            pass

    @event.listens_for(engine, "after_cursor_execute")
    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        try:
            start = getattr(context, "_metrics_start", None)
            stmt_type = getattr(context, "_metrics_stmt_type", "other")
            if start is not None:
                DB_EXECUTE_TOTAL.labels(statement_type=stmt_type).inc()
                DB_EXECUTE_SECONDS.labels(statement_type=stmt_type).observe(time.perf_counter() - start)
        except Exception:
            pass

    engine._metrics_instrumented = True  # type: ignore[attr-defined]


# -------------------------
# /metrics endpoint
# -------------------------
async def metrics_endpoint(_: Request) -> Response:
    if not PROMETHEUS_AVAILABLE:
        # Minimal fallback exposition format so Prometheus still gets a metric
        text = b"# HELP metrics_unavailable Prometheus client not installed\n" \
               b"# TYPE metrics_unavailable gauge\nmetrics_unavailable 1\n"
        return Response(content=text, media_type="text/plain; version=0.0.4; charset=utf-8")

    # If multi-process mode is enabled, aggregate metrics from all workers.
    if PROMETHEUS_MULTIPROC_DIR:
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
        output = generate_latest(registry)
    else:
        output = generate_latest(REGISTRY)
    return Response(content=output, media_type=CONTENT_TYPE_LATEST)


__all__ = [
    "MetricsMiddleware",
    "metrics_endpoint",
    "instrument_sqlalchemy_engine",
    "PROMETHEUS_AVAILABLE",
    "set_metrics_ignore_paths",
]


# -------------------------
# Readable summaries (JSON + HTML)
# -------------------------
def _histogram_series_to_route_buckets(samples):
    """Aggregate http_request_duration_seconds buckets by (method, path), merging statuses.

    Returns: {(method, path): {le: count, ...}, total: int}
    """
    from collections import defaultdict

    route_buckets = defaultdict(lambda: defaultdict(float))
    totals = defaultdict(float)
    for s in samples:
        # name like 'http_request_duration_seconds_bucket'
        if not s.name.endswith("_bucket"):
            continue
        labels = s.labels or {}
        method = labels.get("method")
        path = labels.get("path")
        le = labels.get("le")
        if not method or not path or le is None:
            continue
        key = (method, path)
        route_buckets[key][le] += float(s.value)
        totals[key] = max(totals[key], float(s.value)) if le == "+Inf" else totals[key]
    return route_buckets, totals


def _compute_quantile_from_buckets(buckets: dict[str, float], q: float) -> Optional[float]:
    """Approximate quantile from cumulative histogram buckets (Prometheus semantics).
    buckets: mapping of 'le' -> cumulative count (including +Inf)
    q: desired quantile in [0,1]
    """
    if not buckets:
        return None
    try:
        # sort by numeric 'le', with +Inf last
        def keyf(k: str):
            return float("inf") if k == "+Inf" else float(k)

        pairs = sorted(((keyf(k), c) for k, c in buckets.items()), key=lambda x: x[0])
        total = pairs[-1][1]
        if total <= 0:
            return None
        target = q * total
        prev_le = 0.0
        prev_cum = 0.0
        for le, cum in pairs:
            if cum >= target:
                if le == float("inf"):
                    return prev_le if prev_le > 0 else None
                in_bucket = cum - prev_cum
                if in_bucket <= 0:
                    return le
                pos = (target - prev_cum) / in_bucket
                lower = prev_le
                upper = le
                return lower + (upper - lower) * max(0.0, min(1.0, pos))
            prev_le, prev_cum = le, cum
        return None
    except Exception:
        return None


def _repo_metrics_to_summary(samples_hist, samples_min, samples_max):
    from collections import defaultdict

    # Process Histogram for p50, p95, avg
    buckets_by_key = defaultdict(lambda: defaultdict(float))
    sums_by_key = defaultdict(float)
    counts_by_key = defaultdict(float)

    if samples_hist:
        for s in samples_hist:
            labels = s.labels or {}
            repo = labels.get("repo")
            method = labels.get("method")
            if not repo or not method:
                continue
            key = (repo, method)

            if s.name.endswith("_bucket"):
                le = labels.get("le")
                if le is not None:
                    buckets_by_key[key][le] += float(s.value)
            elif s.name.endswith("_sum"):
                sums_by_key[key] += float(s.value)
            elif s.name.endswith("_count"):
                counts_by_key[key] += float(s.value)

    # Process Gauges for min/max (find min of mins and max of maxes across workers)
    min_by_key = defaultdict(lambda: float('inf'))
    if samples_min:
        for s in samples_min:
            labels = s.labels or {}
            repo, method = labels.get("repo"), labels.get("method")
            if repo and method:
                min_by_key[(repo, method)] = min(min_by_key[(repo, method)], float(s.value))

    max_by_key = defaultdict(lambda: float('-inf'))
    if samples_max:
        for s in samples_max:
            labels = s.labels or {}
            repo, method = labels.get("repo"), labels.get("method")
            if repo and method:
                max_by_key[(repo, method)] = max(max_by_key[(repo, method)], float(s.value))

    # Combine into summary
    summary = []
    all_keys = set(counts_by_key.keys()) | set(min_by_key.keys()) | set(max_by_key.keys())

    for key in sorted(list(all_keys)):
        repo, method = key
        count = counts_by_key.get(key, 0.0)
        if count == 0:
            continue

        avg = sums_by_key.get(key, 0.0) / count
        p50 = _compute_quantile_from_buckets(buckets_by_key.get(key), 0.50)
        p95 = _compute_quantile_from_buckets(buckets_by_key.get(key), 0.95)
        min_val = min_by_key.get(key) if min_by_key.get(key) != float('inf') else None
        max_val = max_by_key.get(key) if max_by_key.get(key) != float('-inf') else None

        summary.append(
            {"repo": repo, "method": method, "count": int(count), "avg_s": avg, "min_s": min_val, "max_s": max_val,
             "p50_s": p50, "p95_s": p95})
    return summary


def _http_metrics_to_summary(samples_wall_hist, samples_cpu_hist, samples_ctr, samples_min, samples_max):
    from collections import defaultdict

    # Process Histogram for p50, p95, avg (aggregating over status)
    buckets_by_key = defaultdict(lambda: defaultdict(float))
    sums_by_key = defaultdict(float)
    counts_from_hist_by_key = defaultdict(float)

    if samples_wall_hist:
        for s in samples_wall_hist:
            labels = s.labels or {}
            method, path = labels.get("method"), labels.get("path")
            if not method or not path:
                continue
            key = (method, path)

            if s.name.endswith("_bucket"):
                le = labels.get("le")
                if le is not None:
                    buckets_by_key[key][le] += float(s.value)
            elif s.name.endswith("_sum"):
                sums_by_key[key] += float(s.value)
            elif s.name.endswith("_count"):
                counts_from_hist_by_key[key] += float(s.value)
    
    # Process CPU Histogram
    cpu_buckets_by_key = defaultdict(lambda: defaultdict(float))
    cpu_sums_by_key = defaultdict(float)
    if samples_cpu_hist:
        for s in samples_cpu_hist:
            labels = s.labels or {}
            method, path = labels.get("method"), labels.get("path")
            if not method or not path:
                continue
            key = (method, path)

            if s.name.endswith("_bucket"):
                le = labels.get("le")
                if le is not None:
                    cpu_buckets_by_key[key][le] += float(s.value)
            elif s.name.endswith("_sum"):
                cpu_sums_by_key[key] += float(s.value)


    # Process Counter for total count and error rate
    totals_by_key, errors_by_key = _counter_series_to_route_counts(samples_ctr)

    # Process Gauges for min/max
    min_by_key = defaultdict(lambda: float('inf'))
    if samples_min:
        for s in samples_min:
            labels = s.labels or {}
            method, path = labels.get("method"), labels.get("path")
            if method and path:
                min_by_key[(method, path)] = min(min_by_key[(method, path)], float(s.value))

    max_by_key = defaultdict(lambda: float('-inf'))
    if samples_max:
        for s in samples_max:
            labels = s.labels or {}
            method, path = labels.get("method"), labels.get("path")
            if method and path:
                max_by_key[(method, path)] = max(max_by_key[(method, path)], float(s.value))

    # Combine
    summary = []
    all_keys = set(counts_from_hist_by_key.keys()) | set(totals_by_key.keys())

    for key in sorted(list(all_keys)):
        method, path = key
        hist_count = counts_from_hist_by_key.get(key, 0.0)

        # Calculate avg from histogram's sum and count, if available.
        if hist_count > 0:
            avg_wall = sums_by_key.get(key, 0.0) / hist_count
            avg_cpu = cpu_sums_by_key.get(key, 0.0) / hist_count
        else:
            # No timing metrics available; avg and percentiles are unknown
            avg_wall = None
            avg_cpu = None


        # Get total count and error rate from the separate Counter metric.
        # This should ideally be the same as hist_count, but we look it up for correctness.
        total_count = totals_by_key.get(key, hist_count)
        errs = errors_by_key.get(key, 0.0)
        err_rate = (errs / total_count) if total_count > 0 else 0.0

        p50_wall = _compute_quantile_from_buckets(buckets_by_key.get(key), 0.50)
        p95_wall = _compute_quantile_from_buckets(buckets_by_key.get(key), 0.95)
        p95_cpu = _compute_quantile_from_buckets(cpu_buckets_by_key.get(key), 0.95)
        min_val = min_by_key.get(key) if min_by_key.get(key) != float('inf') else None
        max_val = max_by_key.get(key) if max_by_key.get(key) != float('-inf') else None

        summary.append({
            "method": method, "path": path, "count": int(total_count), "error_rate": round(err_rate, 4),
            "avg_wall_s": avg_wall, "avg_cpu_s": avg_cpu,
            "min_wall_s": min_val, "max_wall_s": max_val, "p50_wall_s": p50_wall, "p95_wall_s": p95_wall, "p95_cpu_s": p95_cpu,
        })

    summary.sort(key=lambda x: x["count"], reverse=True)
    return summary


def _counter_series_to_route_counts(samples):
    from collections import defaultdict

    total = defaultdict(float)
    errors = defaultdict(float)
    if samples is None:
        return total, errors
    for s in samples:
        if s.name != "http_requests_total":
            continue
        labels = s.labels or {}
        method = labels.get("method")
        path = labels.get("path")
        status = labels.get("status", "")
        if not method or not path:
            continue
        key = (method, path)
        v = float(s.value)
        total[key] += v
        if status.startswith("5"):
            errors[key] += v
    return total, errors


async def metrics_summary_endpoint(_: Request) -> JSONResponse:
    """Return compact JSON summary with per-route counts, error rate and P50/P95 latencies.
    Based on in-process cumulative metrics since start.
    """
    if not PROMETHEUS_AVAILABLE:
        return JSONResponse({"metrics": "unavailable"})

    # Collect snapshot
    http_wall_hist_samples = None
    http_cpu_hist_samples = None
    http_ctr_samples = None
    http_min_samples = None
    http_max_samples = None
    repo_hist_samples = None
    repo_min_samples = None
    repo_max_samples = None
    auth_failures_samples = None
    rate_limit_samples = None
    http_inprog = 0.0
    db = {
        "pool_in_use": None,
        "pool_connections": None,
        "exec_avg_seconds": {},
    }

    # In multi-process mode, always collect via a dedicated aggregating registry
    registry_to_collect = REGISTRY
    if PROMETHEUS_MULTIPROC_DIR:
        registry_to_collect = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry_to_collect)

    for m in registry_to_collect.collect():
        if m.name == "http_request_duration_seconds":
            http_wall_hist_samples = m.samples
        elif m.name == "http_request_cpu_seconds":
            http_cpu_hist_samples = m.samples
        elif m.name == "http_requests_total":
            http_ctr_samples = m.samples
        elif m.name == "http_request_min_duration_seconds":
            http_min_samples = m.samples
        elif m.name == "http_request_max_duration_seconds":
            http_max_samples = m.samples
        elif m.name == "repo_method_duration_seconds":
            repo_hist_samples = m.samples
        elif m.name == "repo_method_min_duration_seconds":
            repo_min_samples = m.samples
        elif m.name == "repo_method_max_duration_seconds":
            repo_max_samples = m.samples
        elif m.name == "auth_failures":
            auth_failures_samples = m.samples
        elif m.name == "rate_limit_hits":
            rate_limit_samples = m.samples
        elif m.name == "http_requests_in_progress":
            # Single gauge per (method, path) – sum all
            http_inprog = sum(float(s.value) for s in m.samples)
        elif m.name == "db_pool_in_use":
            db["pool_in_use"] = sum(float(s.value) for s in m.samples)
        elif m.name == "db_pool_connections":
            db["pool_connections"] = sum(float(s.value) for s in m.samples)
        elif m.name == "db_execute_seconds":
            # Extract per statement_type avg = sum/count
            sums = {}
            counts = {}
            for s in m.samples:
                stype = s.labels.get("statement_type") if s.labels else None
                if not stype:
                    continue
                if s.name.endswith("_sum"):
                    sums[stype] = float(s.value)
                elif s.name.endswith("_count"):
                    counts[stype] = float(s.value)
            for stype, cnt in counts.items():
                if cnt > 0:
                    db["exec_avg_seconds"][stype] = sums.get(stype, 0.0) / cnt

    # Build per-route summary
    per_route = _http_metrics_to_summary(http_wall_hist_samples, http_cpu_hist_samples, http_ctr_samples, http_min_samples, http_max_samples)

    per_repo_method = _repo_metrics_to_summary(repo_hist_samples, repo_min_samples, repo_max_samples)

    # Build auth failures summary
    auth_failures = []
    if auth_failures_samples:
        for s in auth_failures_samples:
            labels = s.labels or {}
            path, reason = labels.get("path"), labels.get("reason")
            if path and reason:
                auth_failures.append({"path": path, "reason": reason, "count": int(s.value)})
        auth_failures.sort(key=lambda x: x["count"], reverse=True)

    # Build rate limit summary
    rate_limits = []
    if rate_limit_samples:
        for s in rate_limit_samples:
            labels = s.labels or {}
            path = labels.get("path")
            if path:
                rate_limits.append({"path": path, "count": int(s.value)})
        rate_limits.sort(key=lambda x: x["count"], reverse=True)

    return JSONResponse({
        "http_in_progress": http_inprog,
        "routes": per_route,
        "repos": per_repo_method,
        "security": {
            "auth_failures": auth_failures,
            "rate_limit_hits": rate_limits
        },
        "db": db,
    })


async def metrics_ui_endpoint(_: Request) -> HTMLResponse:
    """Very simple HTML table over the JSON summary for human readability."""
    if not PROMETHEUS_AVAILABLE:
        return HTMLResponse("<h3>Metrics unavailable (prometheus-client not installed)</h3>")
    # Reuse JSON builder
    js = await metrics_summary_endpoint(None)  # type: ignore[arg-type]
    data = js.body.decode("utf-8")
    # Minimal inline rendering to avoid dependencies
    import json as _json
    d = _json.loads(data)
    routes = d.get("routes", [])
    repos = d.get("repos", [])
    auth_failures = d.get("security", {}).get("auth_failures", [])
    rate_limits = d.get("security", {}).get("rate_limit_hits", [])
    db = d.get("db", {})
    html = [
        "<html><head><title>Metrics UI</title>",
        "<style>body{font-family:system-ui,Segoe UI,Arial; padding:16px} table{border-collapse:collapse} th,td{border:1px solid #ccc;padding:6px 8px} th{background:#f6f6f6}</style>",
        "<style>td.num{text-align:right; font-family:monospace} .subtle{color:#666}</style>",
        "</head><body>",
        "<h2>HTTP routes</h2>",
        "<table><tr><th>Method</th><th>Path</th><th>Count</th><th>Error rate</th>"
        "<th>Avg Wall (s)</th><th>Avg CPU (s)</th>"
        "<th>P50 Wall (s)</th><th>P95 Wall (s)</th><th>P95 CPU (s)</th>"
        "<th>Min Wall (s)</th><th>Max Wall (s)</th></tr>",
    ]
    for r in routes:
        io_wait_pct = 0
        if r['avg_wall_s'] and r['avg_cpu_s'] and r['avg_wall_s'] > 0:
            io_wait_pct = (r['avg_wall_s'] - r['avg_cpu_s']) / r['avg_wall_s']

        html.append(
            f"<tr><td>{r['method']}</td><td>{r['path']}</td><td class='num'>{r['count']}</td><td class='num'>{r['error_rate']:.2%}</td>"
            f"<td class='num'>{(r['avg_wall_s'] or 0):.4f} <span class='subtle'>({io_wait_pct:.0%} I/O)</span></td><td class='num'>{(r['avg_cpu_s'] or 0):.4f}</td>"
            f"<td class='num'>{(r['p50_wall_s'] or 0):.3f}</td><td class='num'>{(r['p95_wall_s'] or 0):.3f}</td><td class='num'>{(r['p95_cpu_s'] or 0):.3f}</td>"
            f"<td class='num'>{(r['min_wall_s'] or 0):.4f}</td><td class='num'>{(r['max_wall_s'] or 0):.4f}</td>"
            "</tr>"
        )
    html += [
        "</table>",
        "<h2>Repository Methods</h2>",
        "<table><tr><th>Repo</th><th>Method</th><th>Count</th><th>Avg (s)</th><th>Min (s)</th><th>Max (s)</th><th>P50 (s)</th><th>P95 (s)</th></tr>",
    ]
    for r in repos:
        html.append(
            f"<tr><td>{r['repo']}</td><td>{r['method']}</td><td>{r['count']}</td><td>{(r['avg_s'] or 0):.4f}</td><td>{(r['min_s'] or 0):.4f}</td><td>{(r['max_s'] or 0):.4f}</td><td>{(r['p50_s'] or 0):.3f}</td><td>{(r['p95_s'] or 0):.3f}</td></tr>"
        )
    html += [
        "</table>",
        "<h2>Security Events</h2>",
        "<h3>Authentication Failures</h3>",
        "<table><tr><th>Path</th><th>Reason</th><th>Count</th></tr>",
    ]
    for r in auth_failures:
        html.append(f"<tr><td>{r['path']}</td><td>{r['reason']}</td><td>{r['count']}</td></tr>")
    html += [
        "</table>",
        "<h3>Rate Limit Hits</h3>",
        "<table><tr><th>Path</th><th>Count</th></tr>",
    ]
    for r in rate_limits:
        html.append(f"<tr><td>{r['path']}</td><td>{r['count']}</td></tr>")
    html += [
        "</table>",
        "<h2>Database</h2>",
        f"<p>Pool in use: {db.get('pool_in_use')}</p>",
        f"<p>Pool connections: {db.get('pool_connections')}</p>",
        "<h3>Avg execution time (s) by statement</h3>",
        "<table><tr><th>Statement</th><th>Avg (s)</th></tr>",
    ]
    for k, v in sorted((db.get("exec_avg_seconds") or {}).items()):
        html.append(f"<tr><td>{k}</td><td>{v:.4f}</td></tr>")
    html += ["</table>", "</body></html>"]
    return HTMLResponse("".join(html))
