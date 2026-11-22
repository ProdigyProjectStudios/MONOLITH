import io
import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine
from monolith import store
from monolith.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(
        store, "engine", create_engine("sqlite:///" + str(tmp_path / "test.db"))
    )
    monkeypatch.setenv("TENANT_TOKENS", '{"alpha":"alpha-token","beta":"beta-token"}')
    monkeypatch.delenv("REDIS_URL", raising=False)
    with TestClient(app) as c:
        c.headers["Authorization"] = "Bearer alpha-token"
        yield c


def test_upload_mine_approve_and_tenant_boundary(client):
    csv = b"case_id,activity,timestamp,system\nA,Order confirmed,2026-11-01T12:00:00Z,CRM\na,Picking assigned,2026-11-01T14:00:00Z,Operations"

    def upload(name, body):
        return client.post("/api/upload", files={"file": (name, body)})

    assert upload("orders.csv", csv).json()["added"] == 2
    assert upload("orders.csv", csv).json()["added"] == 0
    pdf = io.BytesIO()
    c = canvas.Canvas(pdf)
    c.drawString(50, 750, "Human review required for disputes.")
    c.showPage()
    c.save()
    assert upload("controls.pdf", pdf.getvalue()).json()["added"] == 1
    assert upload("controls.pdf", pdf.getvalue()).json()["added"] == 0
    assert upload("bad.csv", b"wrong").status_code == 422
    assert upload("bad.pdf", b"not a pdf").status_code == 422
    report = client.post("/api/analysis", json={"days": 7}).json()["report"]
    assert (
        report["cases"] == 1
        and report["cycle"] == 2
        and report["recommendations"][0]["cases"] == 1
    )
    assert (
        client.post(
            "/api/review",
            json={"opportunity": "handoff", "decision": "Approve shadow pilot"},
        ).status_code
        == 200
    )
    data = client.get("/api/workspace").json()
    assert (
        data["audit"][0]["detail"] == "handoff" and data["data"]["docs"][0]["page"] == 1
    )
    client.headers["Authorization"] = "Bearer beta-token"
    assert not client.get("/api/workspace").json()["data"]["events"]
    assert not client.get("/api/workspace").json()["audit"]
    client.headers["Authorization"] = "Bearer wrong"
    assert client.get("/api/workspace").status_code == 401


def test_atomic_conflict_rollback(client):
    head = "case_id,activity,timestamp,system,event_id\n"

    def send(rows):
        return client.post("/api/upload", files={"file": ("a.csv", head + rows)})

    assert send("A,Queued,2026-01-01T12:00:00Z,Ops,1").status_code == 200
    assert (
        send(
            "B,New,2026-01-02T12:00:00Z,Ops,2\nA,Conflict,2026-01-01T12:00:00Z,Ops,1"
        ).status_code
        == 422
    )
    assert len(client.get("/api/workspace").json()["data"]["events"]) == 1


def test_document_retrieval_is_tenant_scoped(client):
    pdf = io.BytesIO()
    c = canvas.Canvas(pdf)
    c.drawString(50, 750, "A human reviewer authorises disputes")
    c.save()
    assert (
        client.post(
            "/api/upload", files={"file": ("policy.pdf", pdf.getvalue())}
        ).status_code
        == 200
    )
    matches = client.post("/api/evidence/search", json={"query": "disputes"}).json()[
        "matches"
    ]
    assert len(matches) == 1 and matches[0]["id"].startswith("DOC-")
    client.headers["Authorization"] = "Bearer beta-token"
    assert not client.post("/api/evidence/search", json={"query": "disputes"}).json()[
        "matches"
    ]
