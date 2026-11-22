"""Readiness and tenant-scoped operator exports. Run destructive lifecycle work offline."""

import base64
import json
import time
from datetime import UTC, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import JSON, cast, func, select, type_coerce, tuple_

from . import store, telemetry
from .runtime_readiness import execution_status

EXPORT_KINDS = (
    "events",
    "sources",
    "docs",
    "investigation",
    "investigation-result",
    "investigation-snapshot",
    "continuous-summary",
    "continuous-snapshot",
    "continuous-investigation",
    "continuous-decision",
    "continuous-observation",
    "continuous-signal",
)


def prune_audit(days, tenant=None):
    if days < 1:
        raise ValueError("Audit retention must be at least one day.")
    cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    stmt = store.audit.delete().where(store.audit.c.at < cutoff)
    if tenant is not None:
        stmt = stmt.where(store.audit.c.tenant == tenant)
    with store.engine.begin() as c:
        return c.execute(stmt).rowcount


def operations_router(identity):
    router = APIRouter()

    @router.get("/api/health/ready")
    def ready(response: Response):
        try:
            with store.engine.connect() as conn:
                conn.execute(select(store.records.c.id).limit(1)).first()
            queue, worker = execution_status()
            ok = queue["status"] in {"reachable", "in_process"} and worker[
                "status"
            ] in {"online", "in_process"}
        except Exception:
            ok = False
        response.status_code = 200 if ok else 503
        return {"status": "ready" if ok else "unavailable"}

    @router.get("/api/operations/metrics")
    def metrics(t: str = Depends(identity)):
        r = store.records.c
        col = (
            cast(r.payload, JSON)
            if store.engine.dialect.name == "postgresql"
            else type_coerce(r.payload, JSON)
        )
        start = time.perf_counter()
        with store.engine.connect() as conn:
            volumes = dict(
                conn.execute(
                    select(r.kind, func.count())
                    .where(r.tenant == t, r.kind.in_(EXPORT_KINDS))
                    .group_by(r.kind)
                ).all()
            )
            statuses = dict(
                conn.execute(
                    select(col["status"].as_string().label("run_status"), func.count())
                    .where(r.tenant == t, r.kind == "investigation")
                    .group_by("run_status")
                ).all()
            )
            receipts = dict(
                conn.execute(
                    select(col["payload"]["status"].as_string().label("receipt_status"), func.count())
                    .where(
                        r.tenant == t,
                        r.kind.like("investigation-events/%"),
                        col["kind"].as_string() == "model_call",
                    )
                    .group_by("receipt_status")
                ).all()
            )
        queue, worker = execution_status()
        return {
            "tenant": t,
            "http_process": telemetry.measurements(t),
            "database": {
                "dialect": store.engine.dialect.name,
                "read_duration_ms": round((time.perf_counter() - start) * 1000, 2),
                "records": volumes,
            },
            "queue": queue,
            "worker": worker,
            "investigations": statuses,
            "model_call_receipts": receipts,
        }

    @router.get("/api/operations/audit")
    def audit(
        after: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        t: str = Depends(identity),
    ):
        a = store.audit.c
        with store.engine.connect() as conn:
            result = (
                conn.execute(
                    select(a.id, a.action, a.detail, a.at, a.actor)
                    .where(a.tenant == t, a.id > after)
                    .order_by(a.id)
                    .limit(limit + 1)
                )
                .mappings()
                .all()
            )
        return {
            "items": result[:limit],
            "next_cursor": result[limit - 1]["id"] if len(result) > limit else None,
        }

    @router.get("/api/operations/export")
    def export(
        t: str = Depends(identity),
        limit: int = Query(100, ge=1, le=500),
        cursor: str = Query("", max_length=1500),
    ):
        r = store.records.c
        stmt = select(r.kind, r.id, r.payload).where(
            r.tenant == t,
            r.kind.in_(EXPORT_KINDS) | r.kind.like("investigation-events/%"),
        )
        if cursor:
            try:
                point = json.loads(base64.urlsafe_b64decode(cursor))
                if (
                    not isinstance(point, list)
                    or len(point) != 2
                    or not all(isinstance(v, str) for v in point)
                ):
                    raise ValueError
            except (ValueError, UnicodeError):
                raise HTTPException(422, "Invalid export cursor.") from None
            stmt = stmt.where(tuple_(r.kind, r.id) > tuple(point))
        with store.engine.connect() as c:
            rows = c.execute(stmt.order_by(r.kind, r.id).limit(limit + 1)).all()
        result = []
        for kind, ident, raw in rows[:limit]:
            val = json.loads(raw)
            if kind == "investigation":
                val = {
                    k: v
                    for k, v in val.items()
                    if k not in {"worker", "lease_until", "sequence"}
                }
            result.append({"kind": kind, "id": ident, "value": val})
        next_cursor = (
            base64.urlsafe_b64encode(
                json.dumps([rows[limit - 1].kind, rows[limit - 1].id]).encode()
            ).decode()
            if len(rows) > limit
            else None
        )
        return {
            "version": 1,
            "tenant": t,
            "records": result,
            "next_cursor": next_cursor,
        }

    return router
