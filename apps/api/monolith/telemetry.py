"""Record timings using route templates. Request bodies, query strings and secrets stay out of traces."""

import asyncio
import hashlib
import json
import logging
import os
import time
from collections import Counter
from threading import Lock
from uuid import uuid4

from fastapi import HTTPException
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode
from redis.asyncio import Redis
from redis.exceptions import RedisError
from starlette.datastructures import MutableHeaders

log = logging.getLogger("uvicorn.error")
metrics_lock = Lock()
totals = Counter()
started = time.time()
bounds = (0.05, 0.25, 1, 5, 30)
provider = None
redis_client = None


def configure():
    global provider
    provider = TracerProvider(
        resource=Resource.create({"service.name": "monolith-api"})
    )
    if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(timeout=3)))
    return provider


async def shutdown():
    global redis_client, provider
    if redis_client is not None:
        await redis_client.aclose()
        redis_client = None
    if provider:
        await asyncio.to_thread(provider.shutdown)
        provider = None


def record(tenant, status, elapsed):
    with metrics_lock:
        totals[tenant, "requests"] += 1
        totals[tenant, "errors"] += status >= 500
        totals[tenant, "rate_limited"] += status == 429
        totals[tenant, "seconds"] += elapsed
        for limit in bounds:
            totals[tenant, limit] += elapsed <= limit


def measurements(tenant):
    with metrics_lock:
        return {
            "requests": totals[tenant, "requests"],
            "server_errors": totals[tenant, "errors"],
            "rate_limited": totals[tenant, "rate_limited"],
            "duration_seconds_sum": round(totals[tenant, "seconds"], 4),
            "duration_seconds_buckets": {str(k): totals[tenant, k] for k in bounds},
            "process_started_at_unix": started,
        }


class RequestTelemetry:
    def __init__(self, app):
        self.app = app
        self.local = {}
        self.minute = -1

    async def admitted(self, key, limit):
        global redis_client
        minute = int(time.time()) // 60
        if url := os.getenv("REDIS_URL"):
            if redis_client is None:
                redis_client = Redis.from_url(
                    url,
                    socket_connect_timeout=1,
                    socket_timeout=1,
                    retry_on_timeout=False,
                )
            # Atomic increment and expiry, including if the first request is interrupted.
            used = await redis_client.eval(
                "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",
                1,
                f"monolith:limit:{minute}:{key}",
            )
            return used <= limit
        if self.minute != minute:
            self.minute, self.local = minute, {}
        self.local[key] = self.local.get(key, 0) + 1
        return self.local[key] <= limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        status = 500
        tenant = "anonymous"
        reqid = uuid4().hex
        start = time.perf_counter()
        tracer = (provider or trace.get_tracer_provider()).get_tracer("monolith.http")

        async def output(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = reqid
                headers["Cache-Control"] = "no-store"
                headers["X-Content-Type-Options"] = "nosniff"
            await send(message)

        async def reject(code, detail):
            headers = [(b"content-type", b"application/json")]
            if code == 429:
                headers.append(
                    (b"retry-after", str(60 - int(time.time()) % 60).encode())
                )
            await output(
                {"type": "http.response.start", "status": code, "headers": headers}
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": json.dumps(
                        {"detail": detail, "request_id": reqid}
                    ).encode(),
                }
            )

        with tracer.start_as_current_span(
            "HTTP " + scope["method"],
            kind=trace.SpanKind.SERVER,
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            try:
                if (
                    path.startswith("/api/")
                    and not path.startswith("/api/health")
                    and scope["method"] != "OPTIONS"
                ):
                    from .access import resolve_identity

                    header = (
                        dict(scope["headers"])
                        .get(b"authorization", b"")
                        .decode("latin1")
                    )
                    try:
                        person = resolve_identity(header)
                        tenant = person.tenant
                        key = json.dumps([tenant, person.actor])
                    except HTTPException:
                        key = "ip:" + str((scope.get("client") or ["unknown"])[0])
                    default = (
                        "180" if os.getenv("MONOLITH_ENV") == "production" else "0"
                    )
                    limit = int(os.getenv("MONOLITH_RATE_LIMIT_PER_MINUTE", default))
                    if limit > 0:
                        try:
                            ok = await self.admitted(
                                hashlib.sha256(key.encode()).hexdigest(), limit
                            )
                        except (OSError, RedisError):
                            await reject(503, "The request limiter is unavailable.")
                            return
                        if not ok:
                            await reject(
                                429,
                                "Request limit reached. Retry after the indicated interval.",
                            )
                            return
                await self.app(scope, receive, output)
            finally:
                elapsed = time.perf_counter() - start
                route = getattr(scope.get("route"), "path", None) or "unmatched"
                span.update_name(scope["method"] + " " + route)
                span.set_attributes(
                    {
                        "http.request.method": scope["method"],
                        "http.route": route,
                        "http.response.status_code": status,
                        "monolith.request.id": reqid,
                    }
                )
                if status >= 500:
                    span.set_status(Status(StatusCode.ERROR))
                record(tenant, status, elapsed)
                log.info(
                    json.dumps(
                        {
                            "event": "http_request",
                            "id": reqid,
                            "trace_id": format(
                                span.get_span_context().trace_id, "032x"
                            ),
                            "route": route,
                            "method": scope["method"],
                            "status": status,
                            "duration_ms": round(elapsed * 1000, 2),
                        },
                        separators=(",", ":"),
                    )
                )


def job_metadata(tenant):
    from opentelemetry.trace.propagation.tracecontext import (
        TraceContextTextMapPropagator,
    )

    carrier = {}
    TraceContextTextMapPropagator().inject(carrier)
    return {
        "tenant": tenant,
        **({"traceparent": carrier["traceparent"]} if "traceparent" in carrier else {}),
    }


def worker_span(operation):
    from functools import wraps
    from opentelemetry.trace.propagation.tracecontext import (
        TraceContextTextMapPropagator,
    )

    def decorate(fn):
        @wraps(fn)
        def instrumented(*args, **kwargs):
            global provider
            from rq import get_current_job

            job = get_current_job()
            parent = TraceContextTextMapPropagator().extract(job.meta) if job else None
            # RQ work horses exit after one job. Construct and flush the exporter in that process.
            owned = provider is None
            active = configure() if owned else provider
            try:
                with active.get_tracer("monolith.worker").start_as_current_span(
                    operation,
                    context=parent,
                    kind=trace.SpanKind.CONSUMER,
                    record_exception=False,
                    set_status_on_exception=False,
                ) as span:
                    try:
                        return fn(*args, **kwargs)
                    except Exception:
                        span.set_status(Status(StatusCode.ERROR))
                        raise
            finally:
                if owned:
                    active.shutdown()
                    provider = None

        return instrumented

    return decorate
