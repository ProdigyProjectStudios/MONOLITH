"""Authenticated operator diagnostics. Reading readiness never dispatches a provider call."""

import json
import os
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry
from rq import Queue, Worker
from sqlalchemy import JSON, cast, select, type_coerce

from . import store
from .live_receipts import RunBudget
from .portable_investigation import InvestigationError
from .runtime_config import credential_status, model_calls_enabled
from .settings import authenticated_workspaces


def execution_status():
    url = os.getenv("REDIS_URL")
    worker = {
        "status": "unknown",
        "active": None,
        "reported": 0,
        "provider_configured": None,
    }
    queue = {
        "mode": "rq" if url else "inline",
        "status": "unavailable",
        "pending": None,
    }
    if not url:
        queue["status"] = worker["status"] = "in_process"
        return queue, worker

    try:
        with Redis.from_url(
            url, socket_connect_timeout=1, socket_timeout=1, retry=Retry(NoBackoff(), 0)
        ) as conn:
            rq_queue = Queue("monolith", connection=conn)
            queue.update(status="reachable", pending=rq_queue.count)
            now = datetime.now(UTC)
            workers = [
                w
                for w in Worker.all(connection=conn, queue=rq_queue)
                if w.last_heartbeat is not None
                and (now - w.last_heartbeat).total_seconds() <= w.worker_ttl + 60
            ]
            with conn.pipeline(transaction=False) as pipe:
                for w in workers:
                    pipe.hget(w.key, "monolith_provider")
                reports = [json.loads(value) for value in pipe.execute() if value]
            worker.update(
                status="online" if workers else "offline",
                active=len(workers),
                reported=len(reports),
                provider_configured=sum(r.get("configured") is True for r in reports)
                if reports
                else None,
            )
    except (ValueError, OSError, RedisError):
        pass
    return queue, worker


def last_response(tenant_id):
    # Existing deployments already persist the worker's receipt and official origin in this table.
    r = store.records.c
    payload = (
        cast(r.payload, JSON)
        if store.engine.dialect.name == "postgresql"
        else type_coerce(r.payload, JSON)
    )
    event = payload["payload"]
    stmt = (
        select(r.kind, payload["at"].as_string(), event["model"].as_string())
        .where(
            r.tenant == tenant_id,
            r.kind.like("investigation-events/%"),
            payload["kind"].as_string() == "model_call",
            event["mode"].as_string() == "live",
            event["status"].as_string() == "completed",
            event["provider"].as_string() == "openai",
            event["provider_endpoint"].as_string()
            == "https://api.openai.com/v1/responses",
            event["response_id"].as_string().startswith("resp_", autoescape=True),
        )
        .order_by(payload["at"].as_string().desc())
        .limit(1)
    )
    with store.engine.connect() as conn:
        row = conn.execute(stmt).first()
    return (
        None
        if row is None
        else {"run_id": row[0].partition("/")[2], "at": row[1], "model": row[2]}
    )


def readiness_router(tenant_dependency):
    router = APIRouter(prefix="/api/runtime")

    @router.get("/readiness")
    def readiness(
        response: Response, tenant_id: Annotated[str, Depends(tenant_dependency)]
    ):
        if not authenticated_workspaces():
            raise HTTPException(401, "A configured workspace access token is required")
        response.headers["Cache-Control"] = "no-store"
        queue, worker = execution_status()
        observed = last_response(tenant_id)
        try:
            limits = RunBudget.from_env().limits()
        except InvestigationError:
            limits = None
        return {
            "api": {"status": "reachable"},
            "queue": queue,
            "worker": worker,
            "provider": {
                **credential_status(),
                "calls_enabled": model_calls_enabled(),
                "model": os.getenv("OPENAI_MODEL") or "gpt-4.1-mini",
                "verification": "observed_response" if observed else "unverified",
                "last_response": observed,
            },
            "budget": limits,
        }

    return router
