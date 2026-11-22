"""Verify allowed work and role boundaries using normal tenant-authenticated API requests."""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from monolith import store
from monolith.access import PUBLIC, policy
from monolith.main import app
from monolith.settings import identity_registry
from sqlalchemy import create_engine

ROLES = ("viewer", "analyst", "approver", "admin")


def named_config():
    return {
        "northstar": {
            f"qa-{role}": {"token": f"unit-north-{role}", "role": role}
            for role in ROLES
        },
        "other": {"qa-admin": {"token": "unit-other-admin", "role": "admin"}},
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MONOLITH_ENV", "production")
    monkeypatch.setenv("TENANT_IDENTITIES", json.dumps(named_config()))
    monkeypatch.setenv("TENANT_TOKENS", '{"legacy":"unit-old-token"}')
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "0")
    monkeypatch.setenv("MONOLITH_RATE_LIMIT_PER_MINUTE", "0")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY_FILE", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    engine = create_engine(f"sqlite:///{tmp_path}/rbac.db")
    monkeypatch.setattr(store, "engine", engine)
    with TestClient(app) as c:
        yield c
    engine.dispose()


def as_role(role):
    return {"Authorization": "Bearer unit-north-" + role}


@pytest.mark.parametrize(
    ("role", "allowed", "denied"),
    [
        (
            "viewer",
            {"reports:read", "workspace:read"},
            {
                "investigations:run",
                "decisions:approve",
                "operations:manage",
                "sources:write",
            },
        ),
        (
            "analyst",
            {"investigations:run", "sources:write", "monitor:manage"},
            {
                "decisions:approve",
                "operations:manage",
                "connectors:manage",
                "models:run",
            },
        ),
        (
            "approver",
            {"decisions:approve", "workspace:read"},
            {
                "investigations:run",
                "sources:write",
                "operations:manage",
                "connectors:manage",
            },
        ),
        (
            "admin",
            {
                "sources:write",
                "decisions:approve",
                "operations:manage",
                "connectors:manage",
                "models:run",
            },
            set(),
        ),
    ],
)
def test_workspace_declares_actual_roles(client, role, allowed, denied):
    r = client.get("/api/workspace", headers=as_role(role))
    r.raise_for_status()
    identity = r.json()["identity"]
    assert (
        identity["role"] == role
        and identity["actor"] == "qa-" + role
        and not identity["legacy"]
    )
    assert allowed <= set(identity["permissions"]) and not denied.intersection(
        identity["permissions"]
    )
    assert "unit-north-" not in r.text
    assert "no-store" in r.headers["cache-control"]
    assert r.json()["tenant"] == "northstar"


def test_route_policy_is_declared_for_every_application_operation():
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/api/"):
            continue
        for method in operations.keys() & {"get", "post", "put", "patch", "delete"}:
            sample = re.sub(r"\{[^}]+\}", "example", path)
            assert (method.upper(), path) in PUBLIC or policy(method.upper(), sample), (
                method,
                path,
            )
            if (method.upper(), path) not in PUBLIC:
                assert {"WorkspaceBearer": []} in operations[method].get(
                    "security", []
                ), (method, path)


def test_viewer_reports_and_scoped_actions(client):
    run = client.get("/api/report?days=14", headers=as_role("viewer"))
    run.raise_for_status()
    assert run.json()["report"]["events"] > 0
    assert (
        client.get("/api/report?days=15", headers=as_role("viewer")).status_code == 422
    )
    assert (
        client.post(
            "/api/flagship/package", json={"days": 14}, headers=as_role("viewer")
        ).status_code
        == 200
    )
    for method, path, role in [
        ("POST", "/api/upload", "viewer"),
        ("POST", "/api/events", "viewer"),
        ("POST", "/api/analysis", "viewer"),
        ("POST", "/api/investigations", "approver"),
        ("POST", "/api/continuous/refresh", "viewer"),
        ("POST", "/api/review", "analyst"),
        ("POST", "/api/investigations/any/approve", "analyst"),
        ("POST", "/api/connectors/hubspot/oauth/start", "analyst"),
        ("POST", "/api/connectors/hubspot/revoke", "approver"),
        ("GET", "/api/runtime/readiness", "analyst"),
        ("GET", "/api/operations/metrics", "viewer"),
        ("GET", "/api/operations/export", "approver"),
    ]:
        response = client.request(method, path, headers=as_role(role))
        assert response.status_code == 403, (path, response.text)
    assert (
        client.get("/api/runtime/readiness", headers=as_role("admin")).status_code
        == 200
    )
    assert (
        client.get(
            "/api/connectors/hubspot/status", headers=as_role("admin")
        ).status_code
        == 200
    )
    for path, payload in [
        ("/api/analysis", {"days": 7, "use_ai": True}),
        ("/api/investigations", {"days": 7, "mode": "live"}),
    ]:
        assert (
            client.post(path, json=payload, headers=as_role("analyst")).status_code
            == 403
        )
        assert (
            client.post(path, json=payload, headers=as_role("admin")).status_code == 409
        )
    assert client.get("/api/workspace").status_code == 401
    assert (
        client.get(
            "/api/workspace", headers={"Authorization": "Bearer missing"}
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/api/workspace",
            headers=[
                ("Authorization", "Bearer unit-north-viewer"),
                ("Authorization", "Bearer unit-north-admin"),
            ],
        ).status_code
        == 401
    )


def test_approval_attribution_upload_and_cross_tenant_lookup(client):
    csv = b"case_id,activity,timestamp,system\nx,Submitted,2025-01-02T14:00:00Z,Desk\n"
    upload = client.post(
        "/api/upload",
        headers=as_role("analyst"),
        files={"file": ("owned.csv", csv, "text/csv")},
    )
    upload.raise_for_status()
    assert upload.json()["added"] == 1
    req = {"mode": "deterministic", "days": 30, "request_id": "rbac-qa"}
    started = client.post("/api/investigations", json=req, headers=as_role("analyst"))
    started.raise_for_status()
    rid = started.json()["id"]
    assert (
        client.get(
            f"/api/investigations/{rid}/events", headers=as_role("viewer")
        ).status_code
        == 200
    )
    result = client.get(f"/api/investigations/{rid}", headers=as_role("viewer")).json()
    assert result["status"] == "completed" and result["result"]["verified"]
    decision = {"approach": result["result"]["selected"]}
    assert (
        client.post(
            f"/api/investigations/{rid}/approve",
            json=decision,
            headers=as_role("analyst"),
        ).status_code
        == 403
    )
    ok = client.post(
        f"/api/investigations/{rid}/approve", json=decision, headers=as_role("approver")
    )
    ok.raise_for_status()
    approval = ok.json()["approval"]
    assert approval["actor"] == "qa-approver" and approval["role"] == "approver"
    assert ok.json()["events"][-1]["payload"] == approval
    again = client.post(
        f"/api/investigations/{rid}/approve", json=decision, headers=as_role("admin")
    )
    assert again.json()["approval"] == approval
    history = client.get("/api/workspace", headers=as_role("viewer")).json()["audit"]
    by_action = {r["action"]: r for r in history}
    assert by_action["Investigation blueprint approved"]["actor"] == "qa-approver"
    assert by_action["Source ingested"]["actor"] == "qa-analyst"
    other = {"Authorization": "Bearer unit-other-admin"}
    for path in ("", "/snapshot", "/events", "/evaluation"):
        assert (
            client.get(f"/api/investigations/{rid}" + path, headers=other).status_code
            == 404
        )
    assert (
        client.post(
            f"/api/investigations/{rid}/approve", headers=other, json=decision
        ).status_code
        == 404
    )
    assert client.get("/api/workspace", headers=other).json()["data"]["events"] == []


def test_legacy_coexistence_and_configuration_validation(client, monkeypatch):
    identity = client.get(
        "/api/workspace", headers={"Authorization": "Bearer unit-old-token"}
    ).json()["identity"]
    assert (
        identity["legacy"]
        and identity["role"] == "admin"
        and identity["actor"] == "shared-workspace-token"
    )
    valid = named_config()
    for bad in (
        '{"northstar":{"a":{"role":"reader","token":"a"}}}',
        '{"northstar":{"a":{"role":"viewer","token":"a","tenant":"bad"}}}',
        '{"northstar":{"system":{"role":"admin","token":"a"}}}',
        '{"northstar":{"a":{"role":"viewer","token":"a"},"a":{"role":"admin","token":"b"}}}',
        '{"northstar":{"a":{"role":"viewer","token":"unit-old-token"}}}',
        '{"northstar":{}}',
    ):
        monkeypatch.setenv("TENANT_IDENTITIES", bad)
        with pytest.raises(RuntimeError):
            identity_registry()
    monkeypatch.setenv("TENANT_IDENTITIES", json.dumps(valid))
    monkeypatch.setenv("TENANT_TOKENS", '{"northstar":"disallowed-old-token"}')
    with pytest.raises(RuntimeError, match="shared or actor-specific"):
        identity_registry()


def test_old_sqlite_audit_upgrades_without_inventing_identity(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/v5.db")
    with engine.begin() as c:
        c.exec_driver_sql(
            "CREATE TABLE audit (id INTEGER PRIMARY KEY, tenant VARCHAR NOT NULL,action VARCHAR NOT NULL,detail TEXT NOT NULL,at VARCHAR NOT NULL)"
        )
        c.exec_driver_sql(
            "INSERT INTO audit VALUES (1,'legacy','Previous decision','historic','2025-01-01T00:00:00Z')"
        )
    monkeypatch.setattr(store, "engine", engine)
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: store.init(), range(2)))
    saved = store.history("legacy")[0]
    assert (
        saved["action"] == "Previous decision"
        and saved["actor"] is None
        and saved["role"] is None
    )
    engine.dispose()


def test_tenant_pagination_is_bounded_and_revision_pinned(client):
    viewer = as_role("viewer")
    full = client.get("/api/workspace", headers=viewer).json()
    meta = client.get(
        "/api/workspace", params={"include_data": "false"}, headers=viewer
    ).json()
    assert "data" not in meta and meta["revision"] == full["revision"]
    rev = meta["revision"]
    for kind in ("events", "sources", "docs"):
        cursor = None
        actual = []
        while True:
            query = {"kind": kind, "limit": 500, "revision": rev}
            if cursor:
                query["after"] = cursor
            page = client.get("/api/records", params=query, headers=viewer)
            page.raise_for_status()
            body = page.json()
            assert body["revision"] == rev and len(body["items"]) <= 500
            actual.extend(body["items"])
            cursor = body["next_cursor"]
            if cursor is None:
                break
            assert cursor == actual[-1]["id"]
        assert actual == full["data"][kind]
    assert (
        client.get("/api/records?kind=events&after=evt", headers=viewer).status_code
        == 422
    )
    assert (
        client.get("/api/records?kind=events&limit=501", headers=viewer).status_code
        == 422
    )
    assert (
        client.get("/api/records?kind=investigation", headers=viewer).status_code == 422
    )
    assert (
        client.get(
            "/api/records?kind=events",
            headers={"Authorization": "Bearer unit-other-admin"},
        ).json()["items"]
        == []
    )
    assert client.get("/api/records?kind=events").status_code == 401
    assert (
        client.post(
            "/api/upload",
            headers=as_role("analyst"),
            files={
                "file": (
                    "new.csv",
                    b"case_id,activity,timestamp,system\nz,Ordered,2026-01-02T00:00:00Z,Store\n",
                    "text/csv",
                )
            },
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/records", headers=viewer, params={"kind": "events", "revision": rev}
        ).status_code
        == 409
    )


def test_funded_runtime_only_offers_live_action_to_authorized_identity(client, monkeypatch):
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-unusable-test-only")
    for role in ROLES:
        response = client.get("/api/workspace?include_data=false", headers=as_role(role))
        assert response.json()["ai"] is (role == "admin")


def test_named_oauth_initiator_is_rechecked_and_attributed(client, monkeypatch):
    from cryptography.fernet import Fernet
    from monolith import hubspot_service
    from test_hubspot_connection import (
        BASE,
        CALLBACK,
        CODE,
        ORIGIN,
        Provider,
        connect,
        launch,
    )

    provider = Provider()
    monkeypatch.setattr(hubspot_service, "transport", provider.client)
    for name, value in {
        "HUBSPOT_CLIENT_ID": "test-client",
        "HUBSPOT_CLIENT_SECRET": "test-secret",
        "HUBSPOT_REDIRECT_URI": CALLBACK,
        "HUBSPOT_TOKEN_KEY": Fernet.generate_key().decode(),
    }.items():
        monkeypatch.setenv(name, value)
    client.base_url = ORIGIN
    client.follow_redirects = False
    client.headers.update(as_role("admin"))
    state = launch(client)
    members = named_config()
    members["northstar"]["qa-admin"]["role"] = "analyst"
    monkeypatch.setenv("TENANT_IDENTITIES", json.dumps(members))
    r = client.get(BASE + "/oauth/callback", params={"code": CODE, "state": state})
    assert r.status_code == 400 and provider.requests == []
    monkeypatch.setenv("TENANT_IDENTITIES", json.dumps(named_config()))
    assert connect(client)["portal_id"] == "1234"
    entries = {r["action"]: r for r in store.history("northstar")}
    assert entries["HubSpot account connected"]["actor"] == "qa-admin"
    assert entries["HubSpot authorisation requested"]["actor"] == "qa-admin"
