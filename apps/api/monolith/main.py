import io
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pypdf import PdfReader
from starlette.concurrency import run_in_threadpool

from . import store
from .core import analyse, document, parse_csv
from .correlations import correlation_router
from .hubspot_api import connection_status, make_hubspot_router
from .investigation_api import make_router
from .jobs import generate
from .settings import redact_oauth_access_logs, web_origins, workspace_tokens


@asynccontextmanager
async def lifespan(app):
    workspace_tokens()
    redact_oauth_access_logs()
    store.init()
    store.seed_demo()
    yield


app = FastAPI(title="MONOLITH Intelligence API", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=web_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def tenant(authorization: str = Header(default="")):
    credentials = workspace_tokens()
    if not credentials:
        return "northstar"
    for key, value in credentials.items():
        if secrets.compare_digest(authorization, f"Bearer {value}"):
            return key
    raise HTTPException(401, "A workspace access token is required")


app.include_router(make_router(tenant))
app.include_router(make_hubspot_router(tenant))
app.include_router(correlation_router(tenant))


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
def workspace(t: str = Depends(tenant)):
    return {
        "data": store.dataset(t),
        "audit": store.history(t),
        "ai": bool(os.getenv("OPENAI_API_KEY")),
        "hubspot": connection_status(t)["can_sync"],
        "tenant": t,
    }


@app.post("/api/analysis")
def analysis(req: Analysis, t: str = Depends(tenant)):
    if url := os.getenv("REDIS_URL"):
        from redis import Redis
        from rq import Queue

        job = Queue("monolith", connection=Redis.from_url(url)).enqueue(
            generate, t, req.days, req.use_ai, job_timeout=360, meta={"tenant": t}
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


@app.post("/api/upload")
async def upload(file: UploadFile = File(), t: str = Depends(tenant)):
    contents = await file.read(6 * 1024 * 1024 + 1)
    if len(contents) > 6 * 1024 * 1024:
        raise HTTPException(413, "Maximum upload size is 6 MB")
    filename = Path(file.filename or "").name[:200]

    def process():
        if filename.lower().endswith(".csv"):
            part = parse_csv(contents.decode("utf-8-sig"), filename)
        elif filename.lower().endswith(".pdf"):
            reader = PdfReader(io.BytesIO(contents))
            if len(reader.pages) > 100:
                raise ValueError("Maximum PDF length is 100 pages")
            part = document([p.extract_text() or "" for p in reader.pages], filename)
        else:
            raise ValueError("Choose a CSV or PDF")
        return store.save_batch(t, [part], "Source ingested")

    try:
        return {"added": await run_in_threadpool(process)}
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(422, "Unable to parse the source file") from e


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
