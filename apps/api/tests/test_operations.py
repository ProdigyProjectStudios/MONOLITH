import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select

from monolith import operations, store
from monolith.lifecycle import erase
from monolith.main import app


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(
        store, "engine", create_engine("sqlite:///" + str(tmp_path / "ops.db"))
    )
    monkeypatch.setenv(
        "TENANT_TOKENS", json.dumps({"northstar": "test-north", "other": "test-other"})
    )
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("MONOLITH_RATE_LIMIT_PER_MINUTE", "0")
    with TestClient(app, headers={"Authorization": "Bearer test-north"}) as cl:
        yield cl


def test_operator_visibility_paging_and_erase(service, monkeypatch):
    with store.locked("northstar") as c:
        store.put(
            c,
            "northstar",
            "hubspot-connection",
            "account",
            {"credential": "ENCRYPTED_SHOULD_STAY_PRIVATE"},
        )
    metrics = service.get("/api/operations/metrics")
    assert (
        metrics.status_code == 200
        and metrics.json()["database"]["records"]["events"] == 1706
    )
    assert service.get("/api/health/ready").json() == {"status": "ready"}
    monkeypatch.setattr(
        operations,
        "execution_status",
        lambda: ({"status": "unavailable"}, {"status": "offline"}),
    )
    assert service.get("/api/health/ready").status_code == 503
    a = service.get("/api/operations/export?limit=3").json()
    b = service.get(
        "/api/operations/export", params={"limit": 3, "cursor": a["next_cursor"]}
    ).json()
    assert not {(r["id"], r["kind"]) for r in a["records"]} & {
        (r["id"], r["kind"]) for r in b["records"]
    }
    assert service.get("/api/operations/export?cursor=garbage").status_code == 422
    assert (
        service.get(
            "/api/operations/export", headers={"Authorization": "Bearer test-other"}
        ).json()["records"]
        == []
    )
    with pytest.raises(ValueError, match="Remove"):
        erase("northstar", confirm="northstar")
    monkeypatch.setenv("TENANT_TOKENS", json.dumps({"other": "test-other"}))
    with store.locked("other") as c:
        store.put(c, "other", "sources", "other-source", {"id": "other-source"})
    assert erase("northstar")["dry_run"]
    assert erase("northstar", confirm="northstar")["erased"]
    store.seed_demo()
    assert (
        not store.dataset("northstar")["events"] and store.dataset("other")["sources"]
    )


def test_rate_limit_and_audit_retention(service, monkeypatch):
    monkeypatch.setenv("MONOLITH_RATE_LIMIT_PER_MINUTE", "2")
    for i in range(2):
        assert service.get("/api/workspace").status_code == 200
    response = service.get("/api/workspace")
    assert response.status_code == 429 and int(response.headers["retry-after"]) > 0
    assert len(response.headers["x-request-id"]) == 32
    assert (
        service.get(
            "/api/workspace", headers={"Authorization": "Bearer test-other"}
        ).status_code
        == 200
    )
    old = (datetime.now(UTC) - timedelta(days=120)).isoformat()
    with store.engine.begin() as c:
        for t in ("northstar", "other"):
            c.execute(
                store.audit.insert().values(tenant=t, action="old", detail="", at=old)
            )
    assert operations.prune_audit(90, "northstar") == 1
    assert any(v["action"] == "old" for v in store.history("other"))


def test_otlp_observes_safe_request_attributes(tmp_path, monkeypatch):
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
        ExportTraceServiceRequest,
    )

    frames = []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            frames.append(self.rfile.read(int(self.headers["content-length"])))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    sink = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    thread = threading.Thread(target=sink.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(
        store, "engine", create_engine("sqlite:///" + str(tmp_path / "otel.db"))
    )
    monkeypatch.setenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT", f"http://127.0.0.1:{sink.server_port}"
    )
    monkeypatch.setenv("TENANT_TOKENS", json.dumps({"northstar": "test-otel-private"}))
    monkeypatch.delenv("REDIS_URL", raising=False)
    try:
        with TestClient(app) as c:
            r = c.get(
                "/api/workspace?private=secretquery",
                headers={"Authorization": "Bearer test-otel-private"},
            )
            assert r.status_code == 200
        assert (
            frames
            and b"secretquery" not in b"".join(frames)
            and b"test-otel-private" not in b"".join(frames)
        )
        spans = [
            s
            for frame in frames
            for rs in ExportTraceServiceRequest.FromString(frame).resource_spans
            for ss in rs.scope_spans
            for s in ss.spans
        ]
        assert any(s.name == "GET /api/workspace" and s.trace_id for s in spans)
    finally:
        sink.shutdown()
        thread.join()
        sink.server_close()
