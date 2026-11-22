"""Tenant-scoped inspection and recovery of continuous deterministic intelligence."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from . import continuous_service as svc
from . import store


def continuous_router(tenant_dependency):
    router = APIRouter(prefix="/api/continuous")

    def record(t, kind, rid):
        with store.engine.connect() as c:
            row = svc.lookup(c, t, kind, rid)
        if row is None:
            raise HTTPException(404, "Record not found in this workspace.")
        return row

    @router.get("")
    def overview(t: str = Depends(tenant_dependency)):
        return svc.view(t)

    @router.get("/status")
    def monitor_status(t: str = Depends(tenant_dependency)):
        with store.engine.connect() as c:
            return svc.status(svc.state(c, t))

    @router.post("/refresh")
    def refresh(t: str = Depends(tenant_dependency)):
        with store.locked(t) as c:
            svc.capture(c, t, "Explicit reconciliation")
        svc.retry(t)
        svc.drain(t)
        return svc.view(t)

    @router.get("/snapshots/{rid}")
    def snapshot(rid: str, t: str = Depends(tenant_dependency)):
        return record(t, svc.SNAP, rid)

    @router.get("/snapshots/{rid}/records")
    def source_records(rid: str, t: str = Depends(tenant_dependency)):
        return svc.unpack(record(t, svc.INPUT, rid))

    @router.get("/snapshots/{rid}/evidence/{eid}")
    def frozen_evidence(rid: str, eid: str, t: str = Depends(tenant_dependency)):
        # A source row (e.g. enriched CRM provenance) may change after the snapshot.
        entry = record(t, svc.INPUT, rid)
        data = svc.unpack(entry)
        witness = next(
            (
                row
                for group in ("events", "docs")
                for row in data[group]
                if row["id"] == eid
            ),
            None,
        )
        if witness is None:
            raise HTTPException(404, "Evidence not found in this snapshot.")
        source = next(
            (source for source in data["sources"] if source["id"] == witness["source"]),
            None,
        )
        return {"record": witness, "source": source, "snapshot_id": rid}

    @router.get("/history")
    def history(t: str = Depends(tenant_dependency)):
        with store.engine.connect() as c:
            return {"history": svc.rows(c, t, svc.SUMMARY, newest=True)}

    @router.get("/signals/{sid}")
    def signal(sid: str, t: str = Depends(tenant_dependency)):
        return record(t, svc.SIGNAL, sid)["value"]

    @router.get("/nodes")
    def nodes(q: str = Query("", max_length=160), t: str = Depends(tenant_dependency)):
        with store.engine.connect() as c:
            s = svc.state(c, t)
            snap = svc.lookup(c, t, svc.SNAP, svc.key(s["processed_revision"]))
        values = snap["analysis"]["graph"]["nodes"] if snap else []
        term = q.casefold().strip()
        return {
            "nodes": [
                n
                for n in values
                if term in n["label"].casefold() or term in n["id"].casefold()
            ]
        }

    @router.get("/nodes/{nid}")
    def node(nid: str, t: str = Depends(tenant_dependency)):
        history, edges = [], []
        with store.engine.connect() as c:
            runs = {(r["snapshot_id"], r["signal_id"]): r["id"] for r in svc.rows(c, t, svc.RUN)}
            decisions = {d["run_id"]: d["id"] for d in svc.rows(c, t, svc.DECISION)}
            for snap in svc.rows(c, t, svc.SNAP, newest=True):
                graph = snap["analysis"]["graph"]
                found = next((n for n in graph["nodes"] if n["id"] == nid), None)
                if found:
                    if not history:
                        edges = [
                            e
                            for e in graph["edges"]
                            if nid in (e["source"], e["target"])
                        ]
                    findings = []
                    for signal in snap["analysis"]["signals"]:
                        node_kind = "system" if signal["kind"] == "handoff" else "process"
                        subject = found["kind"] == node_kind and found["label"] in signal["subject"]
                        shared = sorted(set(found["evidence"]).intersection(signal["evidence"]))
                        if subject or shared:
                            run = runs.get((snap["id"], signal["id"]))
                            findings.append({
                                "signal_id": signal["id"], "title": signal["title"],
                                "relation": "detector_subject" if subject else "shared_evidence",
                                "evidence": signal["evidence"] if subject else shared,
                                "investigation_id": run, "decision_id": decisions.get(run),
                            })
                    history.append(
                        {
                            "snapshot_id": snap["id"],
                            "revision": snap["revision"],
                            "created_at": snap["created_at"],
                            "node": found,
                            "findings": findings,
                        }
                    )
        if not history:
            raise HTTPException(404, "Node not found in this workspace.")
        return {"node": history[0]["node"], "edges": edges, "history": history}

    @router.get("/decisions")
    def decisions(t: str = Depends(tenant_dependency)):
        with store.engine.connect() as c:
            return {
                "decisions": svc.rows(c, t, svc.DECISION),
                "reassessments": svc.rows(c, t, svc.OBSERVATION),
            }

    @router.get("/investigations/{rid}")
    def investigation(rid: str, t: str = Depends(tenant_dependency)):
        return record(t, svc.RUN, rid)

    @router.post("/investigations/{rid}/resume")
    def resume(rid: str, t: str = Depends(tenant_dependency)):
        run = record(t, svc.RUN, rid)
        if run["status"] == "failed":
            svc.retry(t, rid)
            svc.drain(t)
        return record(t, svc.RUN, rid)

    @router.post("/fixtures/{wave}")
    def fixture(
        wave: Literal["backlog", "recovery"], t: str = Depends(tenant_dependency)
    ):
        if t != "northstar":
            raise HTTPException(404, "Fixture not found in this workspace.")
        from .continuous_fixture import WAVES, fixture_csv
        from .core import parse_csv

        part = parse_csv(fixture_csv(wave), WAVES[wave][1], synthetic=True)
        return {
            "added": store.save_batch(
                t, [part], f"Synthetic {wave} change stream ingested"
            )
        }

    return router
