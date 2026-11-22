"""A tenant-serialized, crash-recoverable monitor over immutable source revisions."""

import base64
import hashlib
import json
import logging
import threading
import time
import zlib
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from . import store

MONITOR = "continuous-monitor"
INPUT = "continuous-input"
SNAP = "continuous-snapshot"
SUMMARY = "continuous-summary"
RUN = "continuous-investigation"
CONTEXT = "continuous-context"
DECISION = "continuous-decision"
OBSERVATION = "continuous-observation"
SIGNAL = "continuous-signal"
LEASE_SECONDS = 30
WAKE = threading.Event()
logger = logging.getLogger(__name__)


def now():
    return datetime.now(UTC).isoformat()


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def key(revision):
    return f"snapshot-{revision:012d}"


def lookup(c, t, kind, rid):
    r = store.records.c
    raw = c.execute(
        select(r.payload).where(r.tenant == t, r.kind == kind, r.id == rid)
    ).scalar_one_or_none()
    return json.loads(raw) if raw else None


def rows(c, t, kind, newest=False):
    r = store.records.c
    stmt = (
        select(r.payload)
        .where(r.tenant == t, r.kind == kind)
        .order_by(r.id.desc() if newest else r.id)
    )
    return [json.loads(row) for row in c.execute(stmt).scalars()]


def state(c, t):
    return lookup(c, t, MONITOR, "monitor") or {
        "revision": 0,
        "processed_revision": 0,
        "updated_at": None,
        "queue": [],
        "archives": [],
        "lease": None,
        "failure": None,
    }


def save_state(c, t, s):
    s["updated_at"] = now()
    s["version"] = s.get("version", 0) + 1
    store.put(c, t, MONITOR, "monitor", s)


def capture(c, t, reason, data=None):
    """Record a source revision in the same transaction as the ingestion."""
    if data is None:
        data = store.dataset(t, c)
    if not any(data.values()):
        return False
    # The import path may already have this data in memory in a different order.
    encoded = canonical(
        {k: sorted(v, key=lambda row: row["id"]) for k, v in data.items()}
    )
    fingerprint = hashlib.sha256(encoded).hexdigest()
    s = state(c, t)
    if fingerprint == s.get("fingerprint"):
        return False
    s["revision"] += 1
    s["fingerprint"] = fingerprint
    store.put(
        c,
        t,
        INPUT,
        key(s["revision"]),
        {
            "revision": s["revision"],
            "at": now(),
            "reason": reason,
            "fingerprint": fingerprint,
            "packed": base64.b64encode(zlib.compress(encoded, 1)).decode("ascii"),
        },
    )
    save_state(c, t, s)
    WAKE.set()
    return True


def capture_legacy_baseline(c, t, data=None):
    if state(c, t)["revision"] == 0:
        capture(c, t, "Existing workspace sources", data)


def enqueue_archive(s, run, after_revision):
    # Freeze the human disposition as recorded at this point in the ingest stream.
    stamp = archive_stamp(run)
    ident = run["id"] + ":" + digest(stamp)[:16]
    if any(isinstance(item, dict) and item["id"] == ident for item in s["archives"]):
        return False
    s["archives"].append(
        {
            "id": ident,
            "run_id": run["id"],
            "after_revision": after_revision,
            "stamp": stamp,
        }
    )
    return True


def archive_changed(c, t, rid):
    s = state(c, t)
    if enqueue_archive(s, lookup(c, t, "investigation", rid), s["revision"]):
        save_state(c, t, s)
        WAKE.set()


def reconcile():
    """Backfill legacy workspaces and reconcile out-of-band changes after restart."""
    r = store.records.c
    with store.engine.connect() as c:
        tenants = list(
            c.execute(
                select(r.tenant)
                .where(r.kind.in_(["events", "docs", "sources", "investigation"]))
                .distinct()
            ).scalars()
        )
    for t in tenants:
        with store.locked(t) as c:
            capture(c, t, "Startup reconciliation")
            s = state(c, t)
            dirty = False
            for run in rows(c, t, "investigation"):
                if run.get("status") != "completed":
                    continue
                marker = lookup(c, t, "continuous-archived", run["id"])
                if marker != archive_stamp(run):
                    dirty = enqueue_archive(s, run, s["processed_revision"]) or dirty
            if dirty:
                save_state(c, t, s)


def archive_stamp(run):
    return {"approval": run.get("approval"), "status": run.get("status")}


def monitor_view(s):
    failure, lease = s["failure"], s["lease"]
    pending = (
        s["revision"] - s["processed_revision"] + len(s["queue"]) + len(s["archives"])
    )
    status = (
        "failed"
        if failure
        else "processing"
        if lease
        else "pending"
        if pending
        else "current"
    )
    return {
        "status": status,
        "revision": s["revision"],
        "processed_revision": s["processed_revision"],
        "pending": pending,
        "updated_at": s["updated_at"],
        "error": failure["message"] if failure else None,
    }


def claim(t):
    with store.locked(t) as c:
        s = state(c, t)
        if s["lease"] and s["lease"]["expires"] > time.time():
            return None
        if s["failure"] and (
            s["failure"]["retry_at"] is None or s["failure"]["retry_at"] > time.time()
        ):
            return None
        archive = next(
            (
                a
                for a in s["archives"]
                if a["after_revision"] <= s["processed_revision"]
            ),
            None,
        )
        if archive:
            kind, target = "archive", archive["id"]
        elif s["queue"]:
            kind, target = "stage", s["queue"][0]
        elif s["processed_revision"] < s["revision"]:
            kind, target = "analysis", key(s["processed_revision"] + 1)
        else:
            return None
        # Preserve the original work item on a retry, even if a newer archive arrived.
        previous = s["lease"] or s["failure"]
        if previous is not None:
            kind, target = previous["kind"], previous["target"]
        lease = {
            "token": uuid4().hex,
            "kind": kind,
            "target": target,
            "expires": time.time() + LEASE_SECONDS,
        }
        s["lease"] = lease
        if kind == "stage":
            run = lookup(c, t, RUN, target)
            run.update(status="running", error=None)
            store.put(c, t, RUN, target, run)
        save_state(c, t, s)
        return lease


def unpack(entry):
    return json.loads(zlib.decompress(base64.b64decode(entry["packed"])))


def calculate(t, task):
    from .continuous_engine import analyze_stream
    from .continuous_investigation import (
        STAGES,
        advance_investigation,
        finish_investigation,
        normalize_decision,
        reassess_decisions,
    )

    target, kind = task["target"], task["kind"]
    with store.engine.connect() as c:
        if kind == "archive":
            event = next(a for a in state(c, t)["archives"] if a["id"] == target)
            run = lookup(c, t, "investigation", event["run_id"])
            result = lookup(c, t, "investigation-result", event["run_id"])
            snap = lookup(c, t, "investigation-snapshot", run["snapshot"])
            stamp = event["stamp"]
            frozen = {
                **run,
                **stamp,
                "result": result,
                "as_of": (snap or {}).get("report", {}).get("asof"),
            }
            return {"decision": normalize_decision(frozen), "event": event}
        if kind == "stage":
            run = lookup(c, t, RUN, target)
            ctx = lookup(c, t, CONTEXT, target)
            entry = lookup(c, t, INPUT, run["snapshot_id"])
        else:
            entry = lookup(c, t, INPUT, target)
            memory = rows(c, t, DECISION)
    data = unpack(entry)
    if kind == "stage":
        checkpoints = [
            *run["checkpoints"],
            advance_investigation(
                data, ctx["signal"], ctx["memory"], run["checkpoints"]
            ),
        ]
        run.update(checkpoints=checkpoints, updated_at=now())
        decision = None
        if len(checkpoints) == len(STAGES):
            run.update(
                status="completed",
                result=finish_investigation(ctx["signal"], checkpoints),
            )
            decision = normalize_decision(
                {**run, "created": run["created_at"]}, ctx["signal"]
            )
        return {"run": run, "decision": decision}
    analysis = analyze_stream(data, memory)
    signals = [
        {**signal, "windows": analysis["windows"], "as_of": analysis["as_of"]}
        for signal in analysis["signals"]
    ]
    observations = reassess_decisions(memory, data) if memory else []
    return {
        "analysis": analysis,
        "entry": {k: entry[k] for k in ("revision", "at", "reason", "fingerprint")},
        "events": len(data["events"]),
        "signals": signals,
        "memory": memory,
        "observations": observations,
    }


def commit(t, task, value):
    target, kind = task["target"], task["kind"]
    with store.locked(t) as c:
        s = state(c, t)
        if not s["lease"] or s["lease"]["token"] != task["token"]:
            return False
        if kind == "archive":
            event = value["event"]
            s["archives"].remove(event)
            store.put(c, t, "continuous-archived", event["run_id"], event["stamp"])
            if d := value["decision"]:
                store.put(c, t, DECISION, d["id"], d)
        elif kind == "stage":
            run = value["run"]
            store.put(c, t, RUN, target, run)
            if run["status"] == "completed":
                s["queue"].remove(target)
                if d := value["decision"]:
                    store.put(c, t, DECISION, d["id"], d)
                store.log(c, t, "Continuous investigation completed", target)
        else:
            entry, analysis = value["entry"], value["analysis"]
            snap = {
                "id": target,
                "revision": entry["revision"],
                "created_at": entry["at"],
                "analysis": analysis,
            }
            summary = {k: v for k, v in snap.items() if k != "analysis"}
            summary.update(
                as_of=analysis["as_of"],
                events=value["events"],
                signals=len(value["signals"]),
                reason=entry["reason"],
                fingerprint=entry["fingerprint"],
            )
            store.put(c, t, SNAP, target, snap)
            store.put(c, t, SUMMARY, target, summary)
            for observation in value["observations"]:
                if not lookup(c, t, OBSERVATION, observation["id"]):
                    store.put(c, t, OBSERVATION, observation["id"], {**observation, "snapshot_id": target})
            for signal in value["signals"]:
                signature = digest(
                    [
                        signal["id"],
                        signal["metric"],
                        sorted(signal["evidence"]),
                        sorted(signal["case_ids"]),
                    ]
                )
                previous = lookup(c, t, SIGNAL, signal["id"])
                store.put(
                    c,
                    t,
                    SIGNAL,
                    signal["id"],
                    {"signature": signature, "snapshot_id": target, "value": signal},
                )
                if previous and previous["signature"] == signature:
                    continue
                rid = "investigation-" + digest([target, signal["id"]])[:24]
                run = {
                    "id": rid,
                    "snapshot_id": target,
                    "signal_id": signal["id"],
                    "created_at": now(),
                    "updated_at": now(),
                    "mode": "deterministic",
                    "status": "queued",
                    "checkpoints": [],
                    "result": None,
                    "error": None,
                }
                store.put(c, t, RUN, rid, run)
                store.put(
                    c, t, CONTEXT, rid, {"signal": signal, "memory": value["memory"]}
                )
                s["queue"].append(rid)
            s["processed_revision"] = entry["revision"]
        s["lease"], s["failure"] = None, None
        save_state(c, t, s)
        return True


def fail(t, task, exc):
    with store.locked(t) as c:
        s = state(c, t)
        if not s["lease"] or s["lease"]["token"] != task["token"]:
            return
        count = (s["failure"] or {}).get("attempts", 0) + 1
        message = f"Continuous {task['kind']} failed ({type(exc).__name__}). The last committed checkpoint is available."
        s["failure"] = {
            "kind": task["kind"],
            "target": task["target"],
            "message": message,
            "attempts": count,
            "retry_at": time.time() + 2**count if count < 3 else None,
        }
        s["lease"] = None
        if task["kind"] == "stage":
            run = lookup(c, t, RUN, task["target"])
            run.update(status="failed", error=message, updated_at=now())
            store.put(c, t, RUN, run["id"], run)
            if count >= 3:
                s["queue"].remove(run["id"])
                s["failure"] = None
                store.log(
                    c,
                    t,
                    "Continuous investigation paused for explicit retry",
                    run["id"],
                )
        save_state(c, t, s)


@contextmanager
def keep_lease(t, task):
    """Long computations may span more than a lease. Only an active owner can renew it."""
    done = threading.Event()

    def heartbeat():
        while not done.wait(LEASE_SECONDS / 3):
            try:
                with store.locked(t) as c:
                    s = state(c, t)
                    if not s["lease"] or s["lease"]["token"] != task["token"]:
                        return
                    s["lease"]["expires"] = time.time() + LEASE_SECONDS
                    # Heartbeats do not change the user-visible monitor or its change stamp.
                    store.put(c, t, MONITOR, "monitor", s)
            except Exception as exc:  # noqa: BLE001 - a lost lease fences the final commit.
                logger.warning(
                    "Continuous lease renewal failed (%s)", type(exc).__name__
                )

    thread = threading.Thread(target=heartbeat, name="continuous-lease", daemon=True)
    thread.start()
    try:
        yield
    finally:
        done.set()
        thread.join()


def advance(t):
    task = claim(t)
    if not task:
        return False
    try:
        with keep_lease(t, task):
            return commit(t, task, calculate(t, task))
    except Exception as exc:  # noqa: BLE001 - persist recoverable failures at the job boundary.
        fail(t, task, exc)
        return False


def drain(t, max_steps=128, seconds=6):
    deadline = time.monotonic() + seconds
    for _ in range(max_steps):
        if time.monotonic() > deadline or not advance(t):
            break


def retry(t, rid=None):
    with store.locked(t) as c:
        s = state(c, t)
        failure = s["failure"]
        if rid:
            run = lookup(c, t, RUN, rid)
            if not run or run["status"] != "failed":
                return False
            if rid not in s["queue"]:
                s["queue"].append(rid)
            run.update(status="queued", error=None, updated_at=now())
            store.put(c, t, RUN, rid, run)
        elif not failure:
            return False
        if failure and (
            rid is None or (failure["kind"], failure["target"]) == ("stage", rid)
        ):
            failure.update(attempts=0, retry_at=0)
        save_state(c, t, s)
    WAKE.set()
    return True


def status(s):
    return {"monitor": monitor_view(s), "stamp": "v" + str(s.get("version", 0))}


@contextmanager
def consistent_read():
    # The client uses the first read's version to decide whether its complete view is current.
    with store.engine.connect() as c:
        if c.dialect.name == "sqlite":
            c.exec_driver_sql("BEGIN")
        else:
            c.execution_options(isolation_level="REPEATABLE READ")
        yield c


def view(t):
    with consistent_read() as c:
        s = state(c, t)
        snap = (
            lookup(c, t, SNAP, key(s["processed_revision"]))
            if s["processed_revision"]
            else None
        )
        return {
            **status(s),
            "snapshot": snap,
            "signals": snap["analysis"]["signals"] if snap else [],
            "investigations": sorted(
                rows(c, t, RUN), key=lambda r: r["created_at"], reverse=True
            ),
            "decisions": sorted(
                rows(c, t, DECISION), key=lambda r: r.get("at") or "", reverse=True
            ),
            "reassessments": sorted(
                rows(c, t, OBSERVATION), key=lambda r: r.get("at") or "", reverse=True
            ),
            "history": rows(c, t, SUMMARY, newest=True),
        }


class Scheduler:
    """Each process may poll. Database-fenced claims make restart and failover safe."""

    def __init__(self):
        self.stop = threading.Event()
        self.thread = threading.Thread(
            target=self.run, name="continuous-monitor", daemon=True
        )

    def run(self):
        initialized = False
        while not self.stop.is_set():
            try:
                if not initialized:
                    reconcile()
                    initialized = True
                r = store.records.c
                with store.engine.connect() as c:
                    records = c.execute(
                        select(r.tenant, r.payload).where(r.kind == MONITOR)
                    ).all()
                progress = False
                for t, raw in records:
                    if self.stop.is_set():
                        return
                    if monitor_view(json.loads(raw))["pending"]:
                        progress = advance(t) or progress
                if progress:
                    continue
            except Exception as exc:  # noqa: BLE001 - transient database failures retry at the next tick.
                logger.warning(
                    "Continuous scheduler will retry after %s", type(exc).__name__
                )
            WAKE.wait(1.0)
            WAKE.clear()

    def close(self):
        self.stop.set()
        WAKE.set()
        self.thread.join()
