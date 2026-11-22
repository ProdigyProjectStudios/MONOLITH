"""Real authenticated ingestion routes with an isolated database and local PDF parser."""

import asyncio
import io
import json
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from monolith import ingestion, store
from monolith.core import document
from monolith.main import app
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine, select
from starlette.requests import Request


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(
        store, "engine", create_engine("sqlite:///" + str(tmp_path / "api.db"))
    )
    monkeypatch.setenv("TENANT_TOKENS", '{"tenantA":"a-token","tenantB":"b-token"}')
    monkeypatch.delenv("REDIS_URL", raising=False)
    with TestClient(app, headers={"Authorization": "Bearer a-token"}) as client:
        yield client


def payload():
    return {
        "source": "Service desk API",
        "events": [
            {
                "event_id": "sdk-42",
                "case_id": "job-7",
                "system": "Desk",
                "activity": "Assigned",
                "timestamp": "2026-11-01T14:20:00+02:00",
                "department": "Support",
            }
        ],
    }


def test_atomic_receipt_replay_source_provenance_and_tenant_scope(api):
    body = payload()
    headers = {"Idempotency-Key": "sdk-request-1"}
    first = api.post("/api/events", json=body, headers=headers)
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["added"] == result["received"] == 1 and result["replayed"] is False
    assert api.post("/api/events", json=body, headers=headers).json() == {
        **result,
        "replayed": True,
    }
    assert api.post("/api/events", json=body).json()["added"] == 0
    event = store.dataset("tenantA")["events"][0]
    assert event["id"] == result["event_ids"][0] and event["case"] == "JOB-7"
    assert (
        event["timestamp"] == "2026-11-01T12:20:00+00:00"
        and event["source"] == result["source_id"]
    )
    assert (
        event["provenance"]["external_id"] == "sdk-42"
        and event["provenance"]["position"] == event["row"] == 1
    )
    assert len(event["provenance"]["batch_sha256"]) == 64 and not event["synthetic"]
    assert api.get("/api/workspace").json()["data"]["events"] == [event]
    changed = payload()
    changed["events"][0]["activity"] = "Reassigned"
    assert api.post("/api/events", json=changed, headers=headers).status_code == 409
    api.headers["Authorization"] = "Bearer b-token"
    assert api.post("/api/events", json=changed, headers=headers).json()["added"] == 1
    api.headers["Authorization"] = "Bearer unknown"
    assert api.post("/api/events", json=body).status_code == 401


def test_custom_feed_locators_remain_unique_across_batches(api):
    body = payload()
    api.post("/api/events", json=body).raise_for_status()
    batch = {
        **body,
        "events": [
            body["events"][0],
            dict(body["events"][0], event_id="sdk-43", activity="Closed"),
        ],
    }
    assert api.post("/api/events", json=batch).json()["added"] == 1
    result = api.post(
        "/api/events",
        json={**body, "events": [dict(body["events"][0], event_id="sdk-44")]},
    )
    assert result.json()["added"] == 1
    events = sorted(store.dataset("tenantA")["events"], key=lambda row: row["row"])
    assert [r["row"] for r in events] == [1, 3, 4]
    assert [r["provenance"]["position"] for r in events] == [1, 2, 1]
    assert len({r["source"] for r in events}) == 1


def test_explicit_synthetic_feed_labels_the_source_and_rows(api):
    batch = {**payload(), "synthetic": True}
    result = api.post("/api/events", json=batch)
    assert result.is_success
    records = store.dataset("tenantA")
    assert records["sources"][0]["synthetic"] and records["events"][0]["synthetic"]


def test_failed_duplicate_rolls_back_rows_source_receipt_and_revisions(api):
    first = payload()
    assert api.post("/api/events", json=first).is_success
    conflicting = {
        "source": "Another source",
        "events": [
            dict(first["events"][0], event_id="extra"),
            dict(first["events"][0], activity="Conflict"),
        ],
    }

    def snapshot():
        with store.engine.connect() as conn:
            return list(
                conn.execute(
                    select(store.records.c.kind, store.records.c.id).where(
                        store.records.c.tenant == "tenantA",
                        store.records.c.kind.in_(
                            [
                                "events",
                                "sources",
                                "event-ingest-receipt",
                                "continuous-snapshot",
                            ]
                        ),
                    )
                )
            )

    # The first accepted write asynchronously materializes its snapshot. Compare
    # the rejected batch against that completed revision, including its row IDs.
    deadline = time.monotonic() + 10
    while True:
        monitor = api.get("/api/continuous/status").json()["monitor"]
        if monitor["revision"] == monitor["processed_revision"] == 1:
            break
        assert time.monotonic() < deadline, monitor
        time.sleep(0.02)
    before = snapshot()
    header = {"Idempotency-Key": "atomic-key"}
    assert api.post("/api/events", json=conflicting, headers=header).status_code == 409
    assert snapshot() == before
    assert api.get("/api/continuous/status").json()["monitor"]["revision"] == 1
    conflicting["events"].pop()
    assert (
        api.post("/api/events", json=conflicting, headers=header).json()["added"] == 1
    )


def test_concurrent_requests_have_one_write_receipt_and_continuous_outbox(api):
    def submit(_):
        return api.post(
            "/api/events", json=payload(), headers={"Idempotency-Key": "key"}
        ).json()

    with ThreadPoolExecutor(max_workers=4) as pool:
        calls = list(pool.map(submit, range(4)))
    assert sum(not call["replayed"] for call in calls) == 1
    assert len(store.dataset("tenantA")["events"]) == 1
    assert [e["action"] for e in store.history("tenantA")].count(
        "Custom events ingested"
    ) == 1
    with store.engine.connect() as conn:
        assert (
            len(
                conn.execute(
                    select(store.records.c.payload).where(
                        store.records.c.tenant == "tenantA",
                        store.records.c.kind == "event-ingest-receipt",
                    )
                ).all()
            )
            == 1
        )
    # The CSV and JSON transports share event identity within the producing system.
    csv = "case_id,activity,timestamp,system,event_id,department\nJOB-7,Assigned,2026-11-01T12:20:00Z,Desk,sdk-42,Support"
    assert (
        api.post("/api/upload", files={"file": ("copy.csv", csv)}).json()["added"] == 0
    )


def test_json_stream_validation_type_limits_and_no_write(api):
    target = "/api/events"
    assert (
        api.post(
            target,
            content=json.dumps(payload()),
            headers={"Content-Type": "text/plain"},
        ).status_code
        == 415
    )
    assert (
        api.post(
            target,
            content=b'{"source":"x","source":"y","events":[]}',
            headers={"Content-Type": "application/json"},
        ).status_code
        == 422
    )
    for edit in (
        {"case_id": " "},
        {"timestamp": "2026-11-01T12:00:00"},
        {"system": 3},
        {"source": "injected"},
        {"case_id": "x\x00"},
    ):
        b = payload()
        b["events"][0].update(edit)
        assert api.post(target, json=b).status_code == 422
    assert (
        api.post(
            target, json={"source": "s", "events": payload()["events"] * 1001}
        ).status_code
        == 422
    )
    assert (
        api.post(
            target,
            content=b" " * (ingestion.JSON_BYTES + 1),
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )
    assert (
        api.post(
            target, json=payload(), headers={"Idempotency-Key": "unsupported key"}
        ).status_code
        == 422
    )
    assert not store.dataset("tenantA")["sources"]
    schema = api.get("/openapi.json").json()["paths"][target]["post"]["requestBody"][
        "content"
    ]["application/json"]["schema"]
    assert "timestamp" in schema["properties"]["events"]["items"]["properties"]


def test_csv_and_multipart_validation_preserves_clean_source(api):
    head = "case_id,activity,timestamp,system"
    row = "A,Open,2026-01-01T00:00:00Z,Desk"
    for bad in [
        head + ",system\n" + row + ",Shadow",
        head + "\n" + row + ",surplus",
        head + "\n" + row + "\x00",
        head + "\n" + row + ',"',
    ]:
        assert (
            api.post("/api/upload", files={"file": ("events.csv", bad)}).status_code
            == 422
        )
    assert (
        api.post(
            "/api/upload",
            files={"file": ("events.csv", b"x" * (ingestion.FILE_BYTES + 1))},
        ).status_code
        == 413
    )
    assert (
        api.post(
            "/api/upload", files=[("file", ("a.csv", row)), ("file", ("b.csv", row))]
        ).status_code
        == 422
    )
    assert not store.dataset("tenantA")["events"]
    assert (
        api.post(
            "/api/upload", files={"file": ("C:\\folder\\orders.csv", head + "\n" + row)}
        ).json()["added"]
        == 1
    )
    assert store.dataset("tenantA")["sources"][0]["name"] == "orders.csv"


def test_bounded_stream_without_content_length():
    pieces = iter([b"123", b"45"])

    async def receive():
        b = next(pieces)
        return {"type": "http.request", "body": b, "more_body": b == b"123"}

    request = Request({"type": "http", "headers": []}, receive)

    async def consume():
        return [part async for part in ingestion._bounded(request, 4)]

    with pytest.raises(ingestion.BodyLimit):
        asyncio.run(consume())


def test_pdf_bounds_encryption_and_legacy_source_identity(api):
    out = io.BytesIO()
    doc = canvas.Canvas(out)
    doc.drawString(35, 600, "Escalate to a human reviewer.")
    doc.showPage()
    doc.drawString(35, 600, "Keep dated approval evidence.")
    doc.save()
    raw = out.getvalue()
    expected = document(
        [p.extract_text() for p in PdfReader(io.BytesIO(raw)).pages], "controls.pdf"
    )
    assert ingestion.parse_source("controls.pdf", raw) == expected
    assert (
        api.post("/api/upload", files={"file": ("fake.pdf", "normal text")}).status_code
        == 422
    )
    for password, count in ((True, 1), (False, 101)):
        output = io.BytesIO()
        writer = PdfWriter()
        for _ in range(count):
            writer.add_blank_page(width=10, height=10)
        if password:
            writer.encrypt("sample")
        writer.write(output)
        failed = api.post(
            "/api/upload", files={"file": ("test.pdf", output.getvalue())}
        )
        assert failed.status_code == 422
        assert ("password" if password else "100 pages") in failed.json()["detail"]
    assert not store.dataset("tenantA")["docs"]


def test_busy_or_timed_out_pdf_parser_recovers_without_storing_data(api, monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(ingestion, "_PDF_SLOTS", slots)
    assert slots.acquire(blocking=False)
    files = {"file": ("document.pdf", b"%PDF-1.4")}
    busy = api.post("/api/upload", files=files)
    assert busy.status_code == 429 and busy.headers["Retry-After"] == "2"
    slots.release()

    def timeout(command, **kwargs):
        assert kwargs["env"] == {} and kwargs["timeout"] == 12 and "-I" in command
        raise subprocess.TimeoutExpired(command, 12)

    monkeypatch.setattr(ingestion.subprocess, "run", timeout)
    assert api.post("/api/upload", files=files).status_code == 422
    assert slots.acquire(blocking=False)
    slots.release()
    assert not store.dataset("tenantA")["docs"]
