"""Durable, read-only investigations with tenant-fenced workers and replayable SSE."""

import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import store
from .continuous_service import archive_changed
from .core import analyse
from .mining import mine
from .retrieval import search_snapshot
from .runtime_config import credential_status, model_calls_enabled, openai_configured
from .telemetry import job_metadata, worker_span

RUN = "investigation"
SNAPSHOT = "investigation-snapshot"
RESULT = "investigation-result"
WATCH = "investigation-watch"
MAX_DELIVERIES = 3
MAX_AUTOMATIC_RECOVERIES = 1
ACTIVE = {"queued", "running"}
QUEUE_SECONDS = 180
LEASE_SECONDS = 60
RUN_SECONDS = 480
_LOCAL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="monolith-investigation")


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: Literal[7, 14, 30, 90] = 30


class Start(Window):
    mode: Literal["deterministic", "live"] = "deterministic"
    request_id: str | None = Field(None, min_length=1, max_length=120)


class Repeat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=120)


class Scenario(Window):
    assumptions: dict = Field(default_factory=dict, max_length=32)


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approach: str = Field(min_length=1, max_length=100)


def _now():
    return datetime.now(UTC)


def _until(seconds):
    return (_now() + timedelta(seconds=seconds)).isoformat()


def _rows(t, kind):
    return select(store.records.c.payload).where(
        store.records.c.tenant == t, store.records.c.kind == kind
    )


def _get(c, t, kind, key):
    payload = c.execute(
        _rows(t, kind).where(store.records.c.id == key)
    ).scalar_one_or_none()
    return None if payload is None else json.loads(payload)


def _watch(c, t, rid, when):
    store.put(c, t, WATCH, rid, when)


def _unwatch(c, t, rid):
    r = store.records
    c.execute(r.delete().where(r.c.tenant == t, r.c.kind == WATCH, r.c.id == rid))


def _event(c, t, run, kind, stage, payload):
    run["sequence"] += 1
    event = {
        "seq": run["sequence"],
        "kind": kind,
        "stage": stage,
        "payload": payload,
        "at": _now().isoformat(),
    }
    store.put(c, t, f"investigation-events/{run['id']}", f"{event['seq']:08d}", event)
    store.put(c, t, RUN, run["id"], run)
    if kind == "run_queued":
        # Persist the delivery obligation in the same transaction as the snapshot.
        _watch(
            c,
            t,
            run["id"],
            run["created"] if run["mode"] == "deterministic" else run["lease_until"],
        )
    elif kind == "run_started":
        _watch(c, t, run["id"], run["lease_until"])
    elif kind in ("run_completed", "run_failed", "run_interrupted"):
        if run.get("recovery_pending"):
            _watch(c, t, run["id"], _now().isoformat())
        else:
            _unwatch(c, t, run["id"])


def _expire(c, t, run):
    if run["status"] in ACTIVE and run["lease_until"] < _now().isoformat():
        if (
            run["status"] == "queued"
            and run["mode"] == "deterministic"
            and run.get("deliveries", 0) < MAX_DELIVERIES
        ):
            # The dispatcher owns undelivered deterministic work. Reading the run
            # must not terminate it before a restarted API can drain the outbox.
            return run
        if (
            run["status"] == "running"
            and run["mode"] == "deterministic"
            and run.get("automatic_recoveries", 0) < MAX_AUTOMATIC_RECOVERIES
        ):
            run["recovery_pending"] = True
        run.update(
            status="interrupted",
            error="The worker lease expired. Resume from the saved input snapshot.",
        )
        _event(c, t, run, "run_interrupted", "run", {"message": run["error"]})
        store.log(c, t, "Investigation interrupted", run["id"])
    return run


def _run(c, t, rid):
    run = _get(c, t, RUN, rid)
    if run is None:
        raise HTTPException(404, "Investigation not found")
    return _expire(c, t, run)


def _events(c, t, rid, after=0):
    stmt = (
        _rows(t, f"investigation-events/{rid}")
        .where(store.records.c.id > f"{after:08d}")
        .order_by(store.records.c.id)
    )
    return [json.loads(row) for row in c.execute(stmt).scalars()]


def _all(c, t):
    rows = [json.loads(value) for value in c.execute(_rows(t, RUN)).scalars()]
    return [_expire(c, t, row) for row in rows]


def _check_capacity(active):
    if len(active) >= 2:
        raise HTTPException(
            429, "Two investigations are already active in this workspace."
        )


def _public(run):
    return {
        k: v
        for k, v in run.items()
        if k
        not in {
            "lease_until",
            "worker",
            "sequence",
            "snapshot",
            "deliveries",
            "recovery_pending",
        }
    }


def _full(c, t, run):
    return {
        **_public(run),
        "events": _events(c, t, run["id"]),
        "result": _get(c, t, RESULT, run["id"]),
    }


def _ready(mode):
    if mode == "live":
        from .access import require_capability

        require_capability("models:run")
    if mode == "live" and not openai_configured():
        if not model_calls_enabled() and credential_status()["configured"]:
            raise HTTPException(409, "Model calls are disabled by the server operator.")
        raise HTTPException(
            409, "Live investigation requires a server-side OpenAI key."
        )


def _create(c, t, req, parent=None, *, repeat=False):
    rid = uuid4().hex
    snapshot_id = parent["snapshot"] if parent else rid
    if not parent:
        data = store.dataset(t, c)
        report = analyse(data, req.days)
        if not any(r["id"] == "refund" for r in report["recommendations"]):
            raise HTTPException(
                422, "This window has no observed refund approval interval."
            )
        scoped = set(report["case_ids"])
        data["events"] = [r for r in data["events"] if r["case"] in scoped]
        store.put(c, t, SNAPSHOT, snapshot_id, {"data": data, "report": report})
    run = {
        "id": rid,
        "created": _now().isoformat(),
        "days": req.days,
        "mode": req.mode,
        "status": "queued",
        "snapshot": snapshot_id,
        "sequence": 0,
        "lease_until": _until(QUEUE_SECONDS),
    }
    if parent:
        if repeat:
            run["repeat_of"] = parent["id"]
        else:
            run["parent_id"] = parent["id"]
            parent["retry_id"] = rid
            parent.pop("recovery_pending", None)
            _unwatch(c, t, parent["id"])
            store.put(c, t, RUN, parent["id"], parent)
    _event(c, t, run, "run_queued", "run", {"mode": req.mode, "days": req.days})
    store.log(c, t, "Investigation created", f"{rid} · {req.mode}")
    return run


class LeaseLost(Exception):
    """The persisted attempt no longer belongs to this worker."""


def _owned(c, t, rid, worker):
    run = _run(c, t, rid)
    if run["status"] != "running" or run.get("worker") != worker:
        raise LeaseLost
    return run


def _fail(t, rid, message, worker=None):
    with store.locked(t) as c:
        run = _run(c, t, rid)
        if worker is None and run["status"] != "queued":
            return
        if worker is not None and (
            run.get("worker") != worker or run["status"] != "running"
        ):
            return
        run.update(status="failed", error=message)
        _event(c, t, run, "run_failed", "run", {"message": message})
        store.log(c, t, "Investigation failed", f"{rid} · {message}")


@worker_span("monolith.investigation")
def execute_investigation(t, rid):
    """RQ and the local executor share the same transactional single-claim entry point."""
    worker = uuid4().hex
    with store.locked(t) as c:
        run = _run(c, t, rid)
        if run["status"] != "queued":
            return
        run.update(status="running", worker=worker, lease_until=_until(LEASE_SECONDS))
        _event(c, t, run, "run_started", "run", {"mode": run["mode"]})
        snap = _get(c, t, SNAPSHOT, run["snapshot"])

    def emit(kind, stage, payload):
        with store.locked(t) as c:
            current = _owned(c, t, rid, worker)
            current["lease_until"] = _until(LEASE_SECONDS)
            _event(c, t, current, kind, stage, payload)

    async def keep_lease():
        while True:
            await asyncio.sleep(LEASE_SECONDS / 3)
            with store.locked(t) as c:
                current = _owned(c, t, rid, worker)
                current["lease_until"] = _until(LEASE_SECONDS)
                store.put(c, t, RUN, rid, current)

    async def work():
        from .investigator import investigate

        data = snap["data"]

        def search_docs(query):
            return search_snapshot(data["docs"], query)

        report = await asyncio.to_thread(mine, data, snap["report"])
        return await investigate(
            data, report, emit, live=run["mode"] == "live", search_docs=search_docs
        )

    async def bounded():
        task = asyncio.create_task(work())
        heartbeat = asyncio.create_task(keep_lease())
        try:
            done, _ = await asyncio.wait(
                {task, heartbeat},
                timeout=RUN_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if heartbeat in done:
                await heartbeat
            if task not in done:
                raise TimeoutError
            return await task
        finally:
            for pending in (task, heartbeat):
                if not pending.done():
                    pending.cancel()
            await asyncio.gather(task, heartbeat, return_exceptions=True)

    try:
        result = asyncio.run(bounded())
        with store.locked(t) as c:
            current = _owned(c, t, rid, worker)
            store.put(c, t, RESULT, rid, result)
            current["status"] = "completed"
            _event(
                c,
                t,
                current,
                "run_completed",
                "run",
                {"verified": bool(result.get("verified"))},
            )
            archive_changed(c, t, rid)
            store.log(c, t, "Investigation completed", f"{rid} · {current['mode']}")
    except LeaseLost:
        return
    except TimeoutError:
        _fail(t, rid, "Investigation exceeded its execution deadline.", worker)
    except Exception as exc:  # noqa: BLE001 - persist failures at the worker boundary
        # Provider exceptions may contain request headers, source text or untrusted document content.
        _fail(
            t,
            rid,
            f"Investigation failed ({type(exc).__name__}). Inspect the recorded stage and retry.",
            worker,
        )


def _schedule(t, rid):
    # Claim delivery before touching RQ or the local executor. A process may
    # disappear on either side of enqueue; execute_investigation fences both.
    with store.locked(t) as c:
        run = _run(c, t, rid)
        if run["status"] != "queued":
            return
        delivery = run.get("deliveries", 0)
        if delivery and (
            run["mode"] == "live" or run["lease_until"] > _now().isoformat()
        ):
            return
        delivery += 1
        run.update(deliveries=delivery, lease_until=_until(QUEUE_SECONDS))
        store.put(c, t, RUN, rid, run)
        _watch(c, t, rid, run["lease_until"])
    try:
        if url := os.getenv("REDIS_URL"):
            from redis import Redis
            from rq import Queue

            queue = Queue(
                "monolith",
                connection=Redis.from_url(
                    url, socket_connect_timeout=3, socket_timeout=3
                ),
            )
            queue.enqueue(
                execute_investigation,
                t,
                rid,
                job_id=f"investigation-{rid}-{delivery}",
                meta=job_metadata(t),
                ttl=QUEUE_SECONDS,
                job_timeout=RUN_SECONDS + 45,
            )
        else:
            _LOCAL.submit(execute_investigation, t, rid)
    except Exception:  # noqa: BLE001 - queued or partially delivered work is fenced in SQL
        if run["mode"] == "deterministic" and delivery < MAX_DELIVERIES:
            with store.locked(t) as c:
                current = _run(c, t, rid)
                if (
                    current["status"] == "queued"
                    and current.get("deliveries") == delivery
                ):
                    current["lease_until"] = _until(2**delivery)
                    store.put(c, t, RUN, rid, current)
                    _watch(c, t, rid, current["lease_until"])
            return
        _fail(t, rid, "The worker queue is unavailable. Resume to retry dispatch.")


def reconcile_investigations(*, startup=False):
    """Recover SQL outbox entries; never submit or retry a live run on a timer."""
    r = store.records.c
    if startup:
        # Backfill outstanding attempts created by versions without an outbox.
        with store.engine.connect() as c:
            candidates = [
                (tenant, rid)
                for tenant, rid, p in c.execute(
                    select(r.tenant, r.id, r.payload).where(r.kind == RUN)
                )
                if json.loads(p)["status"] in ACTIVE
            ]
        for t, rid in candidates:
            with store.locked(t) as c:
                run = _get(c, t, RUN, rid)
                if run and run["status"] in ACTIVE and _get(c, t, WATCH, rid) is None:
                    _watch(c, t, rid, _now().isoformat())
    now = _now().isoformat()
    with store.engine.connect() as c:
        due = [
            (tenant, rid)
            for tenant, rid, when in c.execute(
                select(r.tenant, r.id, r.payload).where(r.kind == WATCH)
            )
            if json.loads(when) <= now
        ]
    for t, rid in due:
        send = None
        with store.locked(t) as c:
            when = _get(c, t, WATCH, rid)
            if when is None or when > now:
                continue
            run = _run(c, t, rid)
            if (
                run["status"] == "queued"
                and run["mode"] == "deterministic"
                and (not run.get("deliveries") or run["lease_until"] <= now)
            ):
                send = rid
            elif run["status"] in ACTIVE:
                _watch(c, t, rid, run["lease_until"])
            elif (
                run.get("recovery_pending")
                and not run.get("retry_id")
                and run["mode"] == "deterministic"
            ):
                if sum(row["status"] in ACTIVE for row in _all(c, t)) >= 2:
                    _watch(c, t, rid, _until(5))
                else:
                    child = _create(
                        c, t, Start(mode="deterministic", days=run["days"]), run
                    )
                    child["automatic_recoveries"] = (
                        run.get("automatic_recoveries", 0) + 1
                    )
                    store.put(c, t, RUN, child["id"], child)
                    store.log(
                        c, t, "Deterministic worker recovery", f"{rid} → {child['id']}"
                    )
                    send = child["id"]
            else:
                _unwatch(c, t, rid)
        if send:
            _schedule(t, send)


def _read(t, rid):
    with store.locked(t) as c:
        return _full(c, t, _run(c, t, rid))


def _frame(t, rid, after):
    with store.locked(t) as c:
        run = _run(c, t, rid)
        if after > run["sequence"]:
            raise HTTPException(422, "The event cursor is ahead of this investigation.")
        return run["status"], _events(c, t, rid, after)


def make_router(tenant_dependency):
    router = APIRouter(prefix="/api")

    @router.post("/investigations")
    def start(req: Start, t: str = Depends(tenant_dependency)):
        with store.locked(t) as c:
            if req.request_id:
                previous = _get(c, t, "investigation-request", req.request_id)
                if previous:
                    run = _run(c, t, previous)
                    if (run["mode"], run["days"]) != (req.mode, req.days):
                        raise HTTPException(
                            409, "This request ID belongs to a different investigation."
                        )
                    return _full(c, t, run)
            _ready(req.mode)
            active = [r for r in _all(c, t) if r["status"] in ACTIVE]
            match = next(
                (
                    r
                    for r in active
                    if not r.get("repeat_of")
                    and (r["mode"], r["days"]) == (req.mode, req.days)
                ),
                None,
            )
            if not match:
                _check_capacity(active)
            run = match or _create(c, t, req)
            if req.request_id:
                store.put(c, t, "investigation-request", req.request_id, run["id"])
        if not match:
            _schedule(t, run["id"])
        return _read(t, run["id"])

    @router.get("/investigations")
    def list_runs(t: str = Depends(tenant_dependency)):
        with store.locked(t) as c:
            return {
                "runs": sorted(
                    [_public(r) for r in _all(c, t)],
                    key=lambda r: r["created"],
                    reverse=True,
                )
            }

    @router.get("/investigations/{rid}")
    def fetch(rid: str, t: str = Depends(tenant_dependency)):
        return _read(t, rid)

    @router.get("/investigations/{rid}/snapshot")
    def snapshot(rid: str, t: str = Depends(tenant_dependency)):
        with store.locked(t) as c:
            run = _run(c, t, rid)
            return _get(c, t, SNAPSHOT, run["snapshot"])

    @router.get("/investigations/{rid}/evaluation")
    def evaluation(rid: str, t: str = Depends(tenant_dependency)):
        from .evaluation import EVALUATION_VERSION, evaluate

        with store.locked(t) as c:
            source = _run(c, t, rid)
            result = _get(c, t, RESULT, rid)
            if source["status"] != "completed" or not result:
                raise HTTPException(
                    409, "Evaluation requires a completed investigation."
                )
            if (result.get("evaluation") or {}).get("version") == EVALUATION_VERSION:
                return result["evaluation"]
            saved = _get(c, t, SNAPSHOT, source["snapshot"])
        if not saved:
            raise HTTPException(409, "This investigation has no saved input snapshot.")
        return evaluate(saved["data"], saved["report"], result)

    @router.post("/investigations/{rid}/repeat")
    def repeat_investigation(
        rid: str, req: Repeat, t: str = Depends(tenant_dependency)
    ):
        # Replay only reads the old trace. A repeat deliberately schedules fresh work.
        with store.locked(t) as c:
            source = _run(c, t, rid)
            if source["status"] != "completed":
                raise HTTPException(409, "Repeat requires a completed investigation.")
            previous = _get(c, t, "repeat-request", req.request_id)
            if previous:
                prior = _run(c, t, previous)
                if prior.get("repeat_of") != rid:
                    raise HTTPException(
                        409, "This request ID belongs to another repeat."
                    )
                return _full(c, t, prior)
            _ready(source["mode"])
            active = [r for r in _all(c, t) if r["status"] in ACTIVE]
            child = next((r for r in active if r.get("repeat_of") == rid), None)
            created = child is None
            if created:
                _check_capacity(active)
                child = _create(
                    c,
                    t,
                    Start(mode=source["mode"], days=source["days"]),
                    source,
                    repeat=True,
                )
            store.put(c, t, "repeat-request", req.request_id, child["id"])
        if created:
            _schedule(t, child["id"])
        return _read(t, child["id"])

    @router.post("/investigations/{rid}/resume")
    def resume(rid: str, t: str = Depends(tenant_dependency)):
        with store.locked(t) as c:
            parent = _run(c, t, rid)
            if retry := parent.get("retry_id"):
                return _full(c, t, _run(c, t, retry))
            if parent["status"] in ACTIVE:
                return _full(c, t, parent)
            if parent["status"] == "completed":
                raise HTTPException(409, "This investigation is complete.")
            _ready(parent["mode"])
            _check_capacity([r for r in _all(c, t) if r["status"] in ACTIVE])
            run = _create(c, t, Start(mode=parent["mode"], days=parent["days"]), parent)
        _schedule(t, run["id"])
        return _read(t, run["id"])

    @router.post("/investigations/{rid}/approve")
    def approve(rid: str, req: Approval, t: str = Depends(tenant_dependency)):
        with store.locked(t) as c:
            run = _run(c, t, rid)
            result = _get(c, t, RESULT, rid)
            if (
                run["status"] != "completed"
                or not result
                or result.get("verified") is not True
            ):
                raise HTTPException(
                    409, "Approval requires a completed, verified investigation."
                )
            if req.approach not in {a["id"] for a in result["package"]["approaches"]}:
                raise HTTPException(
                    422, "Choose an architecture compared in this investigation."
                )
            verified_designs = (
                result.get("stages", {}).get("verification", {}).get("eligible_designs")
            )
            if (
                run["mode"] == "live"
                and verified_designs is not None
                and req.approach not in verified_designs
            ):
                raise HTTPException(
                    409, "The verifier did not approve this architecture for a pilot."
                )
            if existing := run.get("approval"):
                if existing["approach"] != req.approach:
                    raise HTTPException(
                        409, "A different architecture is already approved."
                    )
                return _full(c, t, run)
            from .evaluation import evaluate

            saved = _get(c, t, SNAPSHOT, run["snapshot"])
            if not saved:
                raise HTTPException(409, "Approval requires the saved source snapshot.")
            # Re-evaluate legacy runs and the exact requested design before a new approval.
            audit = evaluate(saved["data"], saved["report"], result)
            debate = result.get("stages", {}).get("architect", {}).get("debate") or {}
            withheld = set(
                result.get("stages", {})
                .get("verification", {})
                .get("withheld_designs", [])
            )
            withheld.update(
                v
                for review in debate.get("assessments", [])
                for v in review.get("rejected", [])
            )
            if (
                req.approach in withheld
                or audit["status"] == "fail"
                or (result.get("evaluation") or {}).get("status") == "fail"
            ):
                raise HTTPException(
                    409,
                    "An independent evidence check failed. Review the evaluation before approval.",
                )
            from .access import current_principal

            who = current_principal()
            run["approval"] = {"approach": req.approach, "at": _now().isoformat()}
            if who is not None:
                run["approval"].update(actor=who.actor, role=who.role)
            _event(c, t, run, "blueprint_approved", "verification", run["approval"])
            archive_changed(c, t, rid)
            store.log(
                c, t, "Investigation blueprint approved", f"{rid} · {req.approach}"
            )
            return _full(c, t, run)

    @router.get("/investigations/{rid}/events")
    async def stream(
        rid: str,
        request: Request,
        after: int = Query(0, ge=0, le=99999999),
        t: str = Depends(tenant_dependency),
    ):
        if last := request.headers.get("last-event-id"):
            if not last.isascii() or not last.isdecimal() or len(last) > 8:
                raise HTTPException(422, "Invalid event cursor")
            after = max(after, int(last))
        initial = await run_in_threadpool(_frame, t, rid, after)

        async def frames():
            cursor = after
            status, events = initial
            heartbeat = asyncio.get_running_loop().time()
            while True:
                for event in events:
                    cursor = event["seq"]
                    yield f"id: {cursor}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"
                if status not in ACTIVE or await request.is_disconnected():
                    return
                await asyncio.sleep(0.35)
                status, events = await run_in_threadpool(_frame, t, rid, cursor)
                now = asyncio.get_running_loop().time()
                if now - heartbeat >= 12:
                    heartbeat = now
                    yield ": heartbeat\n\n"

        return StreamingResponse(
            frames(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/flagship/package")
    def package(req: Window, t: str = Depends(tenant_dependency)):
        from .flagship import build_package

        data = store.dataset(t)
        try:
            return build_package(data, analyse(data, req.days))
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    @router.post("/flagship/simulate")
    def simulate(req: Scenario, t: str = Depends(tenant_dependency)):
        from .flagship import simulate_scenario

        data = store.dataset(t)
        try:
            return simulate_scenario(data, analyse(data, req.days), req.assumptions)
        except (ValueError, TypeError) as e:
            raise HTTPException(422, str(e)) from e

    return router
