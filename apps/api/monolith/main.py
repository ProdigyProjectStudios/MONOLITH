import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import store, telemetry
from .access import AccessMiddleware, current_principal, require_capability, tenant
from .continuous_api import continuous_router
from .continuous_service import Scheduler, consistent_read
from .continuous_service import state as monitor_state
from .core import analyse
from .correlations import correlation_router
from .hubspot_api import connection_status, make_hubspot_router
from .ingestion import (
    EventReceipt,
    event_batch,
    event_schema,
    parse_source,
    save_events,
    uploaded_source,
)
from .investigation_api import make_router
from .jobs import generate
from .mining import mine
from .operations import operations_router, prune_audit
from .runtime_config import model_calls_enabled, openai_configured
from .runtime_readiness import readiness_router
from .settings import redact_oauth_access_logs, web_origins, workspace_tokens
from .telemetry import job_metadata


@asynccontextmanager
async def lifespan(app):
    workspace_tokens()
    redact_oauth_access_logs()
    store.init()
    store.seed_demo()
    telemetry.configure()
    async def retention_loop():
        while True:
            try:
                await asyncio.to_thread(prune_audit, int(os.getenv("MONOLITH_AUDIT_RETENTION_DAYS","90")))
            except Exception as exc:
                telemetry.log.error("Audit retention failed: %s",type(exc).__name__)
            await asyncio.sleep(86400)
    retention = asyncio.create_task(retention_loop())
    monitor = Scheduler()
    monitor.thread.start()
    try:
        yield
    finally:
        retention.cancel()
        await asyncio.gather(retention,return_exceptions=True)
        monitor.close()
        await telemetry.shutdown()


app = FastAPI(title="MONOLITH Intelligence API", version="1.0", lifespan=lifespan)
app.add_middleware(AccessMiddleware)
app.add_middleware(telemetry.RequestTelemetry)
app.add_middleware(
    CORSMiddleware,
    allow_origins=web_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "Last-Event-ID"],
)


app.include_router(operations_router(tenant))
app.include_router(make_router(tenant))
app.include_router(readiness_router(tenant))
app.include_router(make_hubspot_router(tenant))
app.include_router(correlation_router(tenant))
app.include_router(continuous_router(tenant))


class Analysis(BaseModel):
    days: Literal[7, 14, 30, 90] = 30
    use_ai: bool = False


class Review(BaseModel):
    opportunity: Literal["refund", "entry", "handoff", "review"]
    decision: Literal["Approve shadow pilot", "Keep in review"]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/workspace")
def workspace(t: str = Depends(tenant), include_data: bool = True):
    with consistent_read() as c:
        revision = monitor_state(c, t)["revision"]
        contents = {"data": store.dataset(t, c)} if include_data else {}
    return {
        **contents,
        "revision": revision,
        "audit": store.history(t),
        "ai": "models:run" in current_principal().permissions and openai_configured(),
        "hubspot": connection_status(t)["can_sync"],
        "tenant": t,
        "identity": current_principal().public(),
    }


@app.get("/api/records")
def records_page(
    kind: Literal["events", "sources", "docs"],
    limit: int = Query(500, ge=1, le=500),
    after: str = Query("", max_length=512),
    revision: int | None = Query(None, ge=0),
    t: str = Depends(tenant),
):
    if after and revision is None:
        raise HTTPException(422, "A source revision is required to continue a records page")
    r = store.records.c
    with consistent_read() as c:
        current = monitor_state(c, t)["revision"]
        if revision is not None and current != revision:
            raise HTTPException(409, "Workspace sources changed. Restart pagination at the current revision.")
        rows = c.execute(select(r.id, r.payload).where(r.tenant == t, r.kind == kind, r.id > after)
                         .order_by(r.id).limit(limit + 1)).all()
    return {"items": [json.loads(row.payload) for row in rows[:limit]],
            "next_cursor":rows[limit - 1].id if len(rows) > limit else None, "revision":current}


@app.get("/api/report")
def read_report(days: int = 30, t: str = Depends(tenant)):
    if days not in (7, 14, 30, 90):
        raise HTTPException(422, "Choose a 7, 14, 30 or 90 day window")
    data = store.dataset(t)
    return {"report": mine(data, analyse(data, days))}


@app.post("/api/analysis")
def analysis(req: Analysis, t: str = Depends(tenant)):
    if req.use_ai:
        require_capability("models:run")
    if req.use_ai and not model_calls_enabled():
        raise HTTPException(409, "Model calls are disabled by the server operator.")
    if req.use_ai and not openai_configured():
        raise HTTPException(409, "AI analysis requires a valid server-side OpenAI credential.")
    if url := os.getenv("REDIS_URL"):
        from redis import Redis
        from rq import Queue

        job = Queue("monolith", connection=Redis.from_url(url)).enqueue(
            generate, t, req.days, req.use_ai, job_timeout=360, meta=job_metadata(t)
        )
        return {"job": job.id}
    try:
        return {"report": generate(t, req.days, req.use_ai)}
    except Exception as e:
        raise HTTPException(
            502, "Analysis failed. Check the worker configuration and retry."
        ) from e


@app.get("/api/jobs/{job_id}")
def job(job_id: str, t: str = Depends(tenant)):
    from redis import Redis
    from rq.exceptions import NoSuchJobError
    from rq.job import Job

    if not os.getenv("REDIS_URL"):
        raise HTTPException(404, "Job not found")
    try:
        j = Job.fetch(job_id, connection=Redis.from_url(os.environ["REDIS_URL"]))
    except NoSuchJobError:
        raise HTTPException(404, "Job not found")
    if j.meta.get("tenant") != t:
        raise HTTPException(404, "Job not found")
    if j.is_failed:
        raise HTTPException(502, "Analysis job failed")
    return {
        "status": j.get_status(),
        "report": j.return_value() if j.is_finished else None,
    }


@app.post(
    "/api/upload",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
)
async def upload(request: Request, t: str = Depends(tenant)):
    name, contents = await uploaded_source(request)
    try:
        part = await run_in_threadpool(parse_source, name, contents)
        added = await run_in_threadpool(store.save_batch, t, [part], "Source ingested")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"added": added}


@app.post(
    "/api/events",
    response_model=EventReceipt,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": event_schema()}},
        }
    },
)
async def ingest_events(
    request: Request,
    idempotency_key: str | None = Header(default=None),
    t: str = Depends(tenant),
):
    batch = await event_batch(request)
    return await run_in_threadpool(save_events, t, batch, idempotency_key)


@app.post("/api/review")
def review(req: Review, t: str = Depends(tenant)):
    with store.locked(t) as c:
        rec = next(
            (
                r
                for r in analyse(store.dataset(t, c), 90)["recommendations"]
                if r["id"] == req.opportunity
            ),
            None,
        )
        if not rec:
            raise HTTPException(422, "No matching evidence for this decision")
        if rec["kind"] == "Human-led" and req.decision == "Approve shadow pilot":
            raise HTTPException(422, "This workflow retains human decision authority")
        store.log(c, t, req.decision, req.opportunity)
    return {"audit": store.history(t)}


class EvidenceQuery(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    limit: int = Field(default=6, ge=1, le=20)


@app.post("/api/evidence/search")
def evidence_search(req: EvidenceQuery, t: str = Depends(tenant)):
    from .retrieval import search

    with store.engine.connect() as c:
        return {
            "matches": search(c, t, req.query, req.limit),
            "method": "Hashed lexical cosine",
        }
