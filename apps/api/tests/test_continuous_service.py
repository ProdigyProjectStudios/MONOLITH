"""Ingest truth, restart fencing, frozen datasets and tenant boundaries at the HTTP/SQL boundary."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from monolith import continuous_service as svc
from monolith import store
from monolith.continuous_api import continuous_router
from monolith.continuous_fixture import WAVES, fixture_csv
from monolith.core import parse_csv
from monolith.main import tenant


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/stream.db")
    monkeypatch.setattr(store, "engine", engine)
    monkeypatch.setenv(
        "TENANT_TOKENS", '{"northstar":"test-token","other":"other-token"}'
    )
    store.init()
    yield engine
    engine.dispose()


def ingest(wave):
    return store.save_batch(
        "northstar",
        [parse_csv(fixture_csv(wave), WAVES[wave][1], synthetic=True)],
        "Test ingest",
    )


def drain_until_current(tenant="northstar"):
    for _ in range(6):
        svc.drain(tenant, max_steps=256, seconds=30)
        view = svc.view(tenant)
        assert view["monitor"]["status"] != "failed", view["monitor"]["error"]
        if view["monitor"]["status"] == "current":
            return view
    raise AssertionError("Monitor did not reach its last durable revision")


def test_transactional_outbox_and_crash_fencing(db, monkeypatch):
    store.seed_demo()
    first = svc.claim("northstar")
    assert first["kind"] == "analysis" and svc.claim("northstar") is None
    computed_before_crash = svc.calculate("northstar", first)
    # The crashed process never committed. A later ingestion remains a separate frozen input.
    assert ingest("backlog") == 485
    with store.locked("northstar") as c:
        s = svc.state(c, "northstar")
        assert s["revision"] == 2 and s["processed_revision"] == 0
        s["lease"]["expires"] = 0
        svc.save_state(c, "northstar", s)
    recovered = svc.claim("northstar")
    assert (
        first["target"] == recovered["target"] and first["token"] != recovered["token"]
    )
    assert svc.commit("northstar", first, computed_before_crash) is False
    assert svc.commit("northstar", recovered, svc.calculate("northstar", recovered))
    # An interrupted specialist resumes after the exact committed stage.
    assert svc.advance("northstar")
    run = svc.view("northstar")["investigations"][0]
    assert [p["stage"] for p in run["checkpoints"]] == ["discovery"]
    original = svc.calculate

    def failure(t, task):
        raise ValueError("source secret must never enter an error")

    monkeypatch.setattr(svc, "calculate", failure)
    assert svc.advance("northstar") is False
    saved = svc.view("northstar")["investigations"][0]
    assert (
        saved["checkpoints"] == run["checkpoints"]
        and "source secret" not in saved["error"]
    )
    monkeypatch.setattr(svc, "calculate", original)
    assert svc.retry("northstar", run["id"])
    result = drain_until_current()
    assert [s["events"] for s in result["history"]] == [2191, 1706]
    assert len(result["investigations"]) == len(result["decisions"])
    for r in result["investigations"]:
        assert r["status"] == "completed" and r["mode"] == "deterministic"
        assert [cp["stage"] for cp in r["checkpoints"]] == [
            "discovery",
            "process",
            "strategy",
            "architect",
            "simulation",
            "verification",
        ]
    saved_original = next(r for r in result["investigations"] if r["id"] == run["id"])
    assert saved_original["checkpoints"][0] == run["checkpoints"][0]
    assert ingest("backlog") == 0
    svc.reconcile()
    assert svc.view("northstar") == result


def test_concurrent_import_rollback_and_restart_discovery(db, monkeypatch):
    store.seed_demo()
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert sorted(pool.map(lambda _: ingest("backlog"), range(3))) == [0, 0, 485]
    with store.engine.connect() as c:
        assert svc.state(c, "northstar")["revision"] == 2
    original = svc.capture

    def failure(*args, **kwargs):
        raise RuntimeError("simulated outbox write failure")

    monkeypatch.setattr(svc, "capture", failure)
    with pytest.raises(RuntimeError):
        ingest("recovery")
    assert len(store.dataset("northstar")["events"]) == 2191
    monkeypatch.setattr(svc, "capture", original)
    # Backfill pre-monitor records, including changes written while the scheduler was offline.
    part = parse_csv(fixture_csv("recovery"), WAVES["recovery"][1], synthetic=True)
    with store.locked("northstar") as c:
        store.put(c, "northstar", "sources", part[0]["id"], part[0])
        for record in part[1]:
            store.put(c, "northstar", "events", record["id"], record)
    svc.reconcile()
    svc.reconcile()
    with store.engine.connect() as c:
        s = svc.state(c, "northstar")
        assert s["revision"] == 3 and s["processed_revision"] == 0
        assert len(svc.rows(c, "northstar", svc.INPUT)) == 3


def test_authenticated_queries_fixture_dedup_and_reassessment(db):
    app = FastAPI()
    app.include_router(continuous_router(tenant))
    store.seed_demo()
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        base = "/api/continuous"
        assert (
            client.get(base, headers={"Authorization": "Bearer invalid"}).status_code
            == 401
        )
        assert client.post(base + "/fixtures/backlog").json() == {"added": 485}
        current = drain_until_current()
        assert client.post(base + "/fixtures/backlog").json() == {"added": 0}
        snap = current["snapshot"]
        assert client.get(base + "/snapshots/" + snap["id"]).json() == snap
        latency = next(s for s in current["signals"] if s["kind"] == "latency")
        assert (
            client.get(base + "/signals/" + latency["id"]).json()["metric"]
            == latency["metric"]
        )
        evidence_path = (
            base + "/snapshots/" + snap["id"] + "/evidence/" + latency["evidence"][0]
        )
        frozen = client.get(evidence_path).json()
        assert frozen["record"]["source"] == frozen["source"]["id"]
        assert (
            frozen["source"]["synthetic"] is True
            and frozen["record"]["id"] == latency["evidence"][0]
        )
        nid = snap["analysis"]["graph"]["nodes"][0]["id"]
        assert client.get(base + "/nodes/" + nid).json()["node"]["id"] == nid
        run = next(
            r
            for r in current["investigations"]
            if r["signal_id"] == latency["id"] and r["snapshot_id"] == snap["id"]
        )
        assert client.get(base + "/investigations/" + run["id"]).json() == run
        assert client.post(base + "/fixtures/recovery").json() == {"added": 393}
        after = drain_until_current()
        obs = next(
            o
            for o in after["reassessments"]
            if o["decision_id"] == "decision-" + run["id"]
        )
        assert obs["snapshot_id"] == after["snapshot"]["id"]
        records_path = base + "/snapshots/" + snap["id"] + "/records"
        assert len(client.get(records_path).json()["events"]) == 2191
        matching = next(n for n in snap["analysis"]["graph"]["nodes"]
                        if n["kind"] == "process" and n["label"] == latency["subject"][0])
        history = client.get(base + "/nodes/" + matching["id"]).json()["history"]
        revision = next(h for h in history if h["snapshot_id"] == snap["id"])
        finding = next(f for f in revision["findings"] if f["signal_id"] == latency["id"])
        assert finding["investigation_id"] == run["id"]
        assert finding["decision_id"] == obs["decision_id"]
        assert finding["relation"] == "detector_subject"
        assert obs["status"] == "decreased" and obs["attribution"] == "unestablished"
        assert client.get(base + "/snapshots/" + snap["id"]).json() == snap
        client.headers["Authorization"] = "Bearer other-token"
        assert client.get(records_path).status_code == 404
        assert client.get(evidence_path).status_code == 404
        assert client.post(base + "/fixtures/backlog").status_code == 404
        for path in (
            "/snapshots/" + snap["id"],
            "/nodes/" + nid,
            "/investigations/" + run["id"],
            "/signals/" + latency["id"],
        ):
            assert client.get(base + path).status_code == 404
        assert (
            client.post(base + "/investigations/" + run["id"] + "/resume").status_code
            == 404
        )
        assert client.get(base + "/decisions").json() == {
            "decisions": [],
            "reassessments": [],
        }
        assert client.get(base).json()["history"] == []


def test_std_investigation_archival_obeys_ingest_order_and_leaves_failed_live_runs_alone(
    db, monkeypatch
):
    from monolith.investigation_api import make_router

    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "0")
    store.seed_demo()
    app = FastAPI()
    app.include_router(make_router(tenant))
    app.include_router(continuous_router(tenant))
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        studio = client.post(
            "/api/investigations", json={"days": 30, "mode": "deterministic"}
        )
        studio.raise_for_status()
        rid = studio.json()["id"]
        assert client.get(f"/api/investigations/{rid}/events").status_code == 200
        completed = client.get(f"/api/investigations/{rid}").json()
        assert completed["status"] == "completed" and completed["result"]["verified"]
        # The source revision landed after the first proposal and before human approval.
        assert ingest("backlog") == 485
        accepted = client.post(
            f"/api/investigations/{rid}/approve",
            json={"approach": completed["result"]["selected"]},
        )
        accepted.raise_for_status()
        with store.locked("northstar") as c:
            store.put(
                c,
                "northstar",
                "investigation",
                "old-live-failure",
                {"id": "old-live-failure", "status": "failed", "mode": "live"},
            )
        svc.reconcile()
        stamp = client.get("/api/continuous/status").json()["stamp"]
        assert svc.advance("northstar")
        assert client.get("/api/continuous/status").json()["stamp"] != stamp
        observed = []
        while True:
            task = svc.claim("northstar")
            if not task:
                break
            result = svc.calculate("northstar", task)
            if task["kind"] == "analysis":
                d = next((v for v in result["memory"] if v["run_id"] == rid), None)
                observed.append(d and d["decision"])
            svc.commit("northstar", task, result)
        assert observed == ["proposed"]
        complete = client.get("/api/continuous").json()
        memory = next(d for d in complete["decisions"] if d["run_id"] == rid)
        assert memory["origin"] == "refund_studio" and memory["decision"] == "approved"
        assert (
            memory["approval"] == accepted.json()["approval"]
            and memory["as_of"] is not None
        )
        assert client.get("/api/continuous/status").json() == {
            "monitor": complete["monitor"],
            "stamp": complete["stamp"],
        }
        svc.reconcile()
        assert client.get("/api/continuous/status").json()["stamp"] == complete["stamp"]
        with store.engine.connect() as c:
            untouched = svc.lookup(c, "northstar", "investigation", "old-live-failure")
            assert untouched == {
                "id": "old-live-failure",
                "status": "failed",
                "mode": "live",
            }
