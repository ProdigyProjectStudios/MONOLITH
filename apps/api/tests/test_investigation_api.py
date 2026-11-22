"""Persistence, SSE and approval boundaries exercised through the public API."""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from types import ModuleType

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from monolith import investigation_api as runs
from monolith import store
from monolith.main import tenant
from sqlalchemy import create_engine


def make_test_app():
    app = FastAPI()
    app.include_router(runs.make_router(tenant))
    return app


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "workspace.db"))
    monkeypatch.setattr(store, "engine", engine)
    monkeypatch.setenv(
        "TENANT_TOKENS", '{"northstar":"test-token","other":"other-token"}'
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    store.init()
    store.seed_demo()
    with TestClient(
        make_test_app(), headers={"Authorization": "Bearer test-token"}
    ) as http:
        yield http
    engine.dispose()


def stub_worker(monkeypatch, fn):
    """Only replace the agent runner; DB, queues, PM4Py and stream routes stay real."""
    module = ModuleType("monolith.investigator")
    module.investigate = fn
    monkeypatch.setitem(sys.modules, "monolith.investigator", module)


def begin(client, **options):
    response = client.post(
        "/api/investigations", json={"mode": "deterministic", **options}
    )
    response.raise_for_status()
    return response.json()


def test_replay_persistence_and_verified_approval(client, monkeypatch):
    seen = []

    async def investigation(data, report, emit, live, search_docs):
        seen.append((len(data["events"]), report["mining"], live))
        evidence = search_docs("human reviewer dispute")
        assert evidence
        doc = evidence[0]["id"]
        emit("stage_started", "verification", {})
        emit(
            "tool_result",
            "verification",
            {
                "name": "retrieve",
                "input": {"query": "dispute"},
                "result": evidence,
                "evidence": [doc],
            },
        )
        emit(
            "stage_completed",
            "verification",
            {"summary": "Inspected the cited policy", "evidence": [doc]},
        )
        return {
            "summary": "Tested approval gate",
            "verified": True,
            "selected": "queue",
            "evidence": [doc],
            "package": {"approaches": [{"id": "queue"}, {"id": "batch"}]},
        }

    stub_worker(monkeypatch, investigation)
    started = begin(client, request_id="stable-1")
    url = "/api/investigations/" + started["id"]
    stream = client.get(url + "/events")
    assert stream.headers["content-type"].startswith("text/event-stream")
    frames = [
        json.loads(line[6:])
        for line in stream.text.splitlines()
        if line.startswith("data: ")
    ]
    assert [e["seq"] for e in frames] == list(range(1, len(frames) + 1))
    assert frames[0]["kind"] == "run_queued" and frames[-1]["kind"] == "run_completed"
    assert seen == [(1706, "PM4Py", False)]
    assert client.get(url).json()["events"] == frames
    assert (
        client.get(
            url + "/events", headers={"Last-Event-ID": str(frames[-1]["seq"] - 1)}
        ).text.count("data: ")
        == 1
    )
    assert client.get(url + "/events", params={"after": frames[-1]["seq"]}).text == ""
    again = begin(client, request_id="stable-1")
    assert again["id"] == started["id"] and len(seen) == 1
    assert (
        client.post(
            "/api/investigations", json={"request_id": "stable-1", "days": 7}
        ).status_code
        == 409
    )
    assert (
        client.post(url + "/approve", json={"approach": "unknown"}).status_code == 422
    )
    approved = client.post(url + "/approve", json={"approach": "queue"}).json()
    assert approved["approval"]["approach"] == "queue"
    assert client.post(url + "/approve", json={"approach": "queue"}).json() == approved
    assert client.post(url + "/approve", json={"approach": "batch"}).status_code == 409
    assert (
        len(
            [
                a
                for a in store.history("northstar")
                if a["action"] == "Investigation blueprint approved"
            ]
        )
        == 1
    )
    with TestClient(
        make_test_app(), headers={"Authorization": "Bearer test-token"}
    ) as reopened:
        assert reopened.get(url).json() == approved
        assert (
            reopened.get("/api/investigations").json()["runs"][0]["approval"]
            == approved["approval"]
        )


def test_authority_provenance_and_live_configuration(client, monkeypatch):
    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    assert client.post("/api/investigations", json={"mode": "live"}).status_code == 409
    assert client.post("/api/investigations", json={"days": 45}).status_code == 422
    run = begin(client)
    url = "/api/investigations/" + run["id"]
    assert client.post(url + "/approve", json={"approach": "queue"}).status_code == 409
    client.headers["Authorization"] = "Bearer other-token"
    assert client.get("/api/investigations").json() == {"runs": []}
    assert client.get(url).status_code == 404
    assert client.get(url + "/events").status_code == 404
    assert client.get(url + "/snapshot").status_code == 404
    assert client.post(url + "/resume").status_code == 404
    assert client.post(url + "/approve", json={"approach": "queue"}).status_code == 404
    assert client.post("/api/investigations", json={}).status_code == 422
    client.headers["Authorization"] = "Bearer invalid"
    assert client.get(url + "/events").status_code == 401


def test_worker_fence_and_retry_from_frozen_snapshot(client, monkeypatch):
    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    run = begin(client)
    assert begin(client)["id"] == run["id"]
    url = "/api/investigations/" + run["id"]
    # Simulate an API process crash between storing the run and queue delivery.
    with store.locked("northstar") as c:
        saved = runs._get(c, "northstar", runs.RUN, run["id"])
        saved["lease_until"] = "2000-01-01T00:00:00+00:00"
        store.put(c, "northstar", runs.RUN, run["id"], saved)
    expired = client.get(url).json()
    assert expired["status"] == "interrupted"
    assert expired["events"][-1]["kind"] == "run_interrupted"
    retried = client.post(url + "/resume").json()
    assert retried["parent_id"] == run["id"]
    assert client.post(url + "/resume").json()["id"] == retried["id"]
    assert client.get(url).json()["status"] == "interrupted"
    seen = []

    async def failure(data, report, emit, live, search_docs):
        seen.append(len(data["events"]))
        emit("stage_started", "process", {})
        raise ValueError("private provider response bearer forbidden-token")

    stub_worker(monkeypatch, failure)
    # New data added after the initial run cannot modify the frozen retry input.
    from monolith.core import parse_csv

    store.save_batch(
        "northstar",
        [
            parse_csv(
                "case_id,activity,timestamp,system\nNEW,Queued,2026-11-20T00:00:00Z,Ops",
                "extra.csv",
            )
        ],
        "Fixture import",
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(
            executor.map(
                lambda _: runs.execute_investigation("northstar", retried["id"]),
                range(2),
            )
        )
    failed = client.get("/api/investigations/" + retried["id"]).json()
    snapshot = client.get(url + "/snapshot").json()
    retry_snapshot = client.get(
        "/api/investigations/" + retried["id"] + "/snapshot"
    ).json()
    assert snapshot == retry_snapshot
    assert len(snapshot["data"]["events"]) == snapshot["report"]["events"] == 1706
    assert "NEW" not in snapshot["report"]["case_ids"]
    assert seen == [1706]
    assert failed["status"] == "failed" and failed["events"][-1]["kind"] == "run_failed"
    assert "ValueError" in failed["error"] and "forbidden-token" not in json.dumps(
        failed
    )
    assert failed["events"][2]["stage"] == "process"
    runs.execute_investigation("northstar", run["id"])
    assert client.get(url).json()["status"] == "interrupted"


def test_real_refund_investigation_and_simulation(client):
    run = begin(client)
    url = "/api/investigations/" + run["id"]
    stream = client.get(url + "/events")
    assert stream.is_success
    full = client.get(url).json()
    assert full["status"] == "completed", full.get("error")
    result = full["result"]
    stages = [e["stage"] for e in full["events"] if e["kind"] == "stage_completed"]
    assert stages == [
        "discovery",
        "process",
        "strategy",
        "architect",
        "simulation",
        "verification",
    ]
    assert result["verified"]
    baseline = result["package"]["baseline"]
    assert (baseline["cases"], baseline["median"], baseline["disputes"]) == (
        132,
        31.15,
        66,
    )
    package = client.post("/api/flagship/package", json={"days": 30}).json()
    assert package["baseline"] == baseline
    trial = client.post(
        "/api/flagship/simulate",
        json={"days": 30, "assumptions": {"approach": "queue", "coverage": 0}},
    )
    trial.raise_for_status()
    assert trial.json()["projected_median"] == 31.15
    assert (
        client.post(
            "/api/flagship/simulate", json={"assumptions": {"coverage": 2}}
        ).status_code
        == 422
    )
    assert client.post(
        url + "/approve", json={"approach": result["selected"]}
    ).is_success


def test_sse_flushes_before_terminal_state(client, monkeypatch):
    import asyncio

    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    run = begin(client)
    url = "/api/investigations/" + run["id"] + "/events"
    app = make_test_app()

    async def request():
        first_frame = asyncio.Event()
        finished_frame = asyncio.Event()
        delivered = False

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await asyncio.Event().wait()

        async def send(message):
            body = message.get("body", b"")
            if b'"kind":"run_queued"' in body:
                assert message["more_body"]
                first_frame.set()
            if b'"kind":"run_failed"' in body:
                finished_frame.set()

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": url,
            "raw_path": url.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(b"authorization", b"Bearer test-token")],
            "server": ("route.test", 80),
            "client": ("127.0.0.1", 8000),
        }
        response = asyncio.create_task(app(scope, receive, send))
        try:
            await asyncio.wait_for(first_frame.wait(), timeout=3)
            assert not response.done()
            assert runs._read("northstar", run["id"])["status"] == "queued"
            runs._fail("northstar", run["id"], "Dispatch failed in test")
            await asyncio.wait_for(finished_frame.wait(), timeout=3)
            await response
        finally:
            if not response.done():
                response.cancel()

    asyncio.run(request())


def test_resume_enforces_workspace_concurrency_limit(client, monkeypatch):
    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    run = begin(client)
    runs._fail("northstar", run["id"], "Fixture queue unavailable")
    begin(client, days=7)
    begin(client, days=14)
    assert (
        client.post("/api/investigations/" + run["id"] + "/resume").status_code == 429
    )


def test_live_approval_excludes_rejected_designs(client, monkeypatch):
    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "test-fixture")
    run = begin(client, mode="live")
    with store.locked("northstar") as c:
        record = runs._get(c, "northstar", runs.RUN, run["id"])
        record["status"] = "completed"
        store.put(c, "northstar", runs.RUN, run["id"], record)
        store.put(
            c,
            "northstar",
            runs.RESULT,
            run["id"],
            {
                "verified": True,
                "stages": {"verification": {"eligible_designs": ["queue"]}},
                "package": {"approaches": [{"id": "batch"}, {"id": "queue"}]},
            },
        )
    url = "/api/investigations/" + run["id"] + "/approve"
    assert client.post(url, json={"approach": "batch"}).status_code == 409
    assert client.post(url, json={"approach": "queue"}).status_code == 200


def test_repeat_reuses_immutable_inputs_and_is_idempotent(client, monkeypatch):
    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    original = begin(client)
    url = "/api/investigations/" + original["id"]
    request = {"request_id": "compare-first"}
    assert client.post(url + "/repeat", json=request).status_code == 409
    runs.execute_investigation("northstar", original["id"])
    source = client.get(url).json()
    assert source["status"] == "completed"
    with store.locked("northstar") as c:
        dataset = store.dataset("northstar", c)
        event = {**dataset["events"][0], "system": "Changed after this run"}
        store.put(c, "northstar", "events", event["id"], event)
    frozen = client.get(url + "/snapshot").json()
    assert "Changed after this run" not in {
        e["system"] for e in frozen["data"]["events"]
    }
    child = client.post(url + "/repeat", json=request).json()
    child_url = "/api/investigations/" + child["id"]
    assert child["repeat_of"] == original["id"] and child["id"] != original["id"]
    assert child.get("approval") is None
    assert client.get(child_url + "/snapshot").json() == frozen
    assert client.post(url + "/repeat", json=request).json()["id"] == child["id"]
    assert (
        client.post(url + "/repeat", json={"request_id": "duplicate-click"}).json()[
            "id"
        ]
        == child["id"]
    )
    fresh = begin(client)
    assert fresh["id"] != child["id"]
    assert "Changed after this run" in {
        e["system"]
        for e in client.get("/api/investigations/" + fresh["id"] + "/snapshot").json()[
            "data"
        ]["events"]
    }
    outsider = {"Authorization": "Bearer other-token"}
    for path in (url, child_url):
        assert (
            client.post(path + "/repeat", json=request, headers=outsider).status_code
            == 404
        )
        assert client.get(path + "/evaluation", headers=outsider).status_code == 404
    assert client.get(child_url + "/evaluation").status_code == 409
    evaluation = source["result"]["evaluation"]
    assert client.get(url + "/evaluation").json() == evaluation
    # Migrate a legacy read in memory. The historical evidence and stored decision stay intact.
    with store.locked("northstar") as c:
        result = runs._get(c, "northstar", runs.RESULT, original["id"])
        del result["evaluation"]
        store.put(c, "northstar", runs.RESULT, original["id"], result)
    assert client.get(url + "/evaluation").json() == evaluation
    assert "evaluation" not in client.get(url).json()["result"]
    with store.locked("northstar") as c:
        result["evaluation"] = {**evaluation, "status": "fail"}
        store.put(c, "northstar", runs.RESULT, original["id"], result)
    assert client.post(url + "/approve", json={"approach": "queue"}).status_code == 409


def test_worker_retrieves_only_from_frozen_pages(client, monkeypatch):
    monkeypatch.setattr(runs, "_schedule", lambda *_: None)
    source = begin(client)
    url = "/api/investigations/" + source["id"]
    frozen = client.get(url + "/snapshot").json()["data"]["docs"]
    expected = runs.search_snapshot(frozen, "finance dispute")
    assert expected
    with store.locked("northstar") as c:
        for page in frozen:
            store.put(
                c, "northstar", "docs", page["id"], {**page, "text": "replacement"}
            )
    seen = []

    async def inspect_frozen(data, report, emit, live, search_docs):
        seen.extend(search_docs("finance dispute"))
        return {"verified": False}

    stub_worker(monkeypatch, inspect_frozen)
    runs.execute_investigation("northstar", source["id"])
    assert seen == expected
