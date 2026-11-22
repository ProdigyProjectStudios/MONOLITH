"""Only outbound HubSpot HTTP is simulated. Router, database, Fernet and import code are real."""

import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from monolith import hubspot_service as service
from monolith import store
from monolith.connectors import HubSpot
from monolith.main import app
from sqlalchemy import create_engine, select

BASE = "/api/connectors/hubspot"
ORIGIN = "https://api.monolith.test"
CALLBACK = ORIGIN + BASE + "/oauth/callback"
SCOPES = ["oauth", "crm.objects.deals.read"]
ACCESS = "private-fixture-access"
REFRESH = "private-fixture-refresh"
CODE = "private-fixture-code"


class Provider:
    def __init__(self):
        self.requests = []
        self.port = "1234"
        self.scopes = SCOPES
        self.expires = 1800
        self.refresh_value = REFRESH
        self.rotate = False
        self.handler = lambda _: httpx.Response(200, json={"results": []})
        self.clients = []

    def client(self):
        c = httpx.Client(transport=httpx.MockTransport(self.respond))
        self.clients.append(c)
        return c

    def respond(self, r):
        self.requests.append(r)
        assert r.method == "POST"
        if str(r.url) == HubSpot.token_url:
            body = parse_qs(r.content.decode())
            assert body["client_id"] == ["test-client"] and body["client_secret"] == [
                "test-secret"
            ]
            assert "application/x-www-form-urlencoded" in r.headers["content-type"]
            refresh = body["grant_type"] == ["refresh_token"]
            if refresh:
                assert body["refresh_token"] == [self.refresh_value]
                if self.rotate:
                    self.refresh_value += "-rotated"
            else:
                assert body["code"] == [CODE] and body["redirect_uri"] == [CALLBACK]
            return httpx.Response(
                200,
                json={
                    "access_token": ACCESS + ("-new" if refresh else ""),
                    "refresh_token": self.refresh_value,
                    "hub_id": self.port,
                    "scopes": self.scopes,
                    "expires_in": self.expires,
                },
            )
        if str(r.url) == HubSpot.private_info_url:
            assert json.loads(r.content) == {"tokenKey": ACCESS}
            return httpx.Response(200, json={"hubId": self.port, "scopes": self.scopes})
        assert str(r.url) == HubSpot.deals_url
        assert r.headers["Authorization"] in [
            "Bearer " + ACCESS,
            "Bearer " + ACCESS + "-new",
        ]
        return self.handler(r)


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "connect.db"))
    monkeypatch.setattr(store, "engine", engine)
    for k in (
        "HUBSPOT_ACCESS_TOKEN",
        "HUBSPOT_REFRESH_TOKEN",
        "HUBSPOT_TENANT",
        "HUBSPOT_CASE_PROPERTY",
        "REDIS_URL",
    ):
        monkeypatch.delenv(k, raising=False)
    for k, v in {
        "TENANT_TOKENS": '{"alpha":"a-token","beta":"b-token"}',
        "HUBSPOT_CLIENT_ID": "test-client",
        "HUBSPOT_CLIENT_SECRET": "test-secret",
        "HUBSPOT_REDIRECT_URI": CALLBACK,
        "HUBSPOT_TOKEN_KEY": Fernet.generate_key().decode(),
    }.items():
        monkeypatch.setenv(k, v)
    provider = Provider()
    monkeypatch.setattr(service, "transport", provider.client)
    with TestClient(
        app,
        base_url=ORIGIN,
        headers={"Authorization": "Bearer a-token"},
        follow_redirects=False,
    ) as c:
        yield c, provider
    assert all(c.is_closed for c in provider.clients)
    engine.dispose()


def launch(c):
    r = c.post(BASE + "/oauth/start")
    r.raise_for_status()
    u = urlsplit(r.json()["authorization_url"])
    assert (
        u.netloc == "api.monolith.test"
        and u.path == BASE + "/oauth/launch"
        and not u.query
    )
    html = c.get(u.path)
    assert (
        html.status_code == 200
        and html.headers["Referrer-Policy"] == "no-referrer"
        and html.headers["Cache-Control"] == "no-store"
    )
    assert (
        c.post(
            u.path,
            data={"ticket": u.fragment},
            headers={"Origin": "https://wrong.test"},
        ).status_code
        == 400
    )
    bounce = c.post(u.path, data={"ticket": u.fragment}, headers={"Origin": ORIGIN})
    assert bounce.status_code == 303
    assert (
        c.post(
            u.path, data={"ticket": u.fragment}, headers={"Origin": ORIGIN}
        ).status_code
        == 400
    )
    install = urlsplit(bounce.headers["location"])
    assert (
        install.scheme == "https"
        and install.netloc == "app.hubspot.com"
        and install.path == "/oauth/authorize"
    )
    query = parse_qs(install.query)
    assert query["scope"] == ["crm.objects.deals.read"] and query["redirect_uri"] == [
        CALLBACK
    ]
    assert all(
        part in bounce.headers["set-cookie"].lower()
        for part in ["secure", "httponly", "samesite=lax"]
    )
    return query["state"][0]


def connect(c):
    state = launch(c)
    r = c.get(BASE + "/oauth/callback", params={"code": CODE, "state": state})
    assert r.status_code == 200, r.text
    assert "no-store" in r.headers["Cache-Control"]
    assert (
        c.get(
            BASE + "/oauth/callback", params={"code": CODE, "state": state}
        ).status_code
        == 400
    )
    return c.get(BASE + "/status").json()


def deal(oid, ts="2026-11-01T12:00:00.789Z", stage="qualified", ref="NS-4101"):
    return {
        "id": str(oid),
        "properties": {
            "hs_lastmodifieddate": ts,
            "dealstage": stage,
            "northstar_order": ref,
        },
    }


def test_oauth_browser_binding_scope_encryption_and_disconnect(fixture, monkeypatch):
    c, p = fixture
    assert c.get(BASE + "/status").json()["oauth_available"]
    state = launch(c)
    with TestClient(app, base_url=ORIGIN) as other_browser:
        assert (
            other_browser.get(
                BASE + "/oauth/callback", params={"state": state, "code": CODE}
            ).status_code
            == 400
        )
    assert not p.requests
    done = c.get(BASE + "/oauth/callback", params={"state": state, "code": CODE})
    assert done.status_code == 200
    assert (
        c.get(
            BASE + "/oauth/callback", params={"state": state, "code": CODE}
        ).status_code
        == 400
    )
    status = c.get(BASE + "/status").json()
    assert (
        status["verified"]
        and status["portal_id"] == "1234"
        and status["mode"] == "oauth"
    )
    with store.engine.connect() as conn:
        raw = "".join(
            conn.execute(
                select(store.records.c.payload).where(store.records.c.tenant == "alpha")
            ).scalars()
        )
    for secret in (ACCESS, REFRESH, CODE, "test-secret", state):
        assert (
            secret not in raw
            and secret not in json.dumps(status)
            and secret not in done.text
        )
    c.headers["Authorization"] = "Bearer b-token"
    assert not c.get(BASE + "/status").json()["connected"]
    assert c.post(BASE + "/sync").status_code == 409
    assert c.post(BASE + "/disconnect").is_success
    c.headers["Authorization"] = "Bearer a-token"
    assert c.get(BASE + "/status").json()["connected"]
    assert not c.post(BASE + "/disconnect").json()["can_sync"]
    assert c.post(BASE + "/sync").status_code == 409


def test_expiry_denial_rotation_and_wrong_account(fixture):
    c, p = fixture
    state = launch(c)
    with store.locked("alpha") as conn:
        key = service.hashed(state)
        pending = service._get(conn, "alpha", service.STATE, key)
        pending["expires"] = 0
        store.put(conn, "alpha", service.STATE, key, pending)
    assert (
        c.get(
            BASE + "/oauth/callback", params={"code": CODE, "state": state}
        ).status_code
        == 400
    )
    state = launch(c)
    assert (
        c.get(
            BASE + "/oauth/callback",
            params={"error": "raw provider message", "state": state},
        ).status_code
        == 400
    )
    assert (
        c.get(
            BASE + "/oauth/callback", params={"code": CODE, "state": state}
        ).status_code
        == 400
    )
    p.scopes = ["oauth"]
    state = launch(c)
    assert (
        c.get(
            BASE + "/oauth/callback", params={"code": CODE, "state": state}
        ).status_code
        == 403
    )
    assert not c.get(BASE + "/status").json()["connected"]
    p.scopes = SCOPES
    p.expires = 1
    connect(c)
    p.port = "4321"
    mismatch = c.post(BASE + "/sync")
    assert mismatch.status_code == 409 and not store.dataset("alpha")["events"]
    p.port = "1234"
    p.expires = 1800
    assert c.post(BASE + "/sync").is_success
    assert "grant_type=refresh_token" in p.requests[-2].content.decode()
    assert p.requests[-1].headers["authorization"] == "Bearer " + ACCESS + "-new"
    c.post(BASE + "/sync").raise_for_status()
    assert p.requests[-2].url == p.requests[-1].url


def test_incremental_provenance_atomic_checkpoint_and_retry(fixture, monkeypatch):
    c, p = fixture
    monkeypatch.setenv("HUBSPOT_CASE_PROPERTY", "northstar_order")
    connect(c)

    def first(req):
        body = json.loads(req.content)
        assert body["sorts"] == [
            {"propertyName": "hs_object_id", "direction": "ASCENDING"}
        ]
        assert body["properties"] == [
            "dealstage",
            "hs_lastmodifieddate",
            "northstar_order",
        ]
        if any(
            f["propertyName"] == "hs_object_id"
            for f in body["filterGroups"][0]["filters"]
        ):
            return httpx.Response(
                500, json={"secret": REFRESH}, headers={"Retry-After": "90"}
            )
        return httpx.Response(
            200, json={"results": [deal(12)], "paging": {"next": {"after": "100"}}}
        )

    p.handler = first
    fail = c.post(BASE + "/sync")
    assert fail.status_code == 503 and REFRESH not in fail.text
    status = c.get(BASE + "/status").json()
    assert (
        status["pending_page"]
        and status["checkpoint"] is None
        and status["last_sync"]["added"] == 1
    )

    def second(req):
        filters = json.loads(req.content)["filterGroups"][0]["filters"]
        assert {
            "propertyName": "hs_object_id",
            "operator": "GT",
            "value": "12",
        } in filters
        return httpx.Response(
            200, json={"results": [deal(15, "2026-11-01T12:02:00.123Z")]}
        )

    p.handler = second
    out = c.post(BASE + "/sync").json()
    assert (
        out["added"] == 1 and out["complete"] and out["checkpoint"] == "1793534520123"
    )
    rows = store.dataset("alpha")["events"]
    assert len(rows) == 2
    row = next(r for r in rows if r["row"] == "12")
    assert (
        row["timestamp"].endswith("00.789+00:00")
        and row["case"] == "HS-1234-12"
        and not row["synthetic"]
    )
    assert (
        row["provenance"]["object_id"] == "12"
        and row["provenance"]["portal_id"] == "1234"
    )
    assert (
        row["provenance"]["case_reference"] == "NS-4101"
        and row["provenance"]["case_property"] == "northstar_order"
    )
    assert row["source"] == "SRC-hubspot-1234"
    p.handler = lambda req: httpx.Response(
        200, json={"results": [deal(12), deal(15, "2026-11-01T12:02:00.123Z")]}
    )
    repeat = c.post(BASE + "/sync").json()
    assert repeat["added"] == 0 and repeat["checkpoint"] == out["checkpoint"]
    assert any(
        f["operator"] == "GTE"
        for f in json.loads(p.requests[-1].content)["filterGroups"][0]["filters"]
    )
    c.post(BASE + "/disconnect").raise_for_status()
    assert len(store.dataset("alpha")["events"]) == 2


def test_server_token_is_verified_and_tenant_bound(fixture, monkeypatch):
    c, p = fixture
    monkeypatch.setenv("HUBSPOT_TENANT", "alpha")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", ACCESS)
    s = c.get(BASE + "/status").json()
    assert (
        s["mode"] == "environment"
        and s["configured"]
        and not s["verified"]
        and s["can_sync"]
    )
    c.headers["Authorization"] = "Bearer b-token"
    assert (
        not c.get(BASE + "/status").json()["can_sync"]
        and c.post(BASE + "/sync").status_code == 409
    )
    c.headers["Authorization"] = "Bearer a-token"
    c.post(BASE + "/sync").raise_for_status()
    assert c.get(BASE + "/status").json()["portal_id"] == "1234"
    p.port = "9999"
    assert c.post(BASE + "/sync").status_code == 409
    assert not c.post(BASE + "/disconnect").json()["can_sync"]
    assert c.post(BASE + "/enable").json()["can_sync"]
    c.post(BASE + "/sync").raise_for_status()
    assert c.get(BASE + "/status").json()["portal_id"] == "9999"


def test_lease_fences_disconnected_inflight_response(fixture):
    c, p = fixture
    connect(c)

    def provider(_):
        with pytest.raises(service.ProviderError, match="already running"):
            service.sync("alpha")
        service.disconnect("alpha")
        return httpx.Response(200, json={"results": [deal(7)]})

    p.handler = provider
    assert c.post(BASE + "/sync").status_code == 409
    assert not store.dataset("alpha")["events"]
    assert not c.get(BASE + "/status").json()["connected"]


def test_page_budget_and_reconciliation(fixture, monkeypatch):
    c, p = fixture
    connect(c)
    monkeypatch.setattr(service, "PAGES", 1)
    p.handler = lambda _: httpx.Response(
        200, json={"results": [deal(4)], "paging": {"next": {"after": "100"}}}
    )
    assert c.post(BASE + "/sync").json()["complete"] is False
    p.handler = lambda _: httpx.Response(200, json={"results": [deal(5)]})
    assert c.post(BASE + "/sync").json()["complete"]
    p.handler = lambda _: httpx.Response(200, json={"results": [deal(4), deal(5)]})
    result = c.post(BASE + "/sync?full=true").json()
    assert result["added"] == 0
    assert all(
        f["operator"] != "GTE"
        for f in json.loads(p.requests[-1].content)["filterGroups"][0]["filters"]
    )


def test_oauth_rejects_expanded_grant_and_reports_revocation(fixture):
    c, p = fixture
    p.scopes = [*SCOPES, "crm.objects.deals.write"]
    state = launch(c)
    assert (
        c.get(
            BASE + "/oauth/callback", params={"code": CODE, "state": state}
        ).status_code
        == 403
    )
    assert not c.get(BASE + "/status").json()["configured"]
    p.scopes = SCOPES
    connect(c)
    p.handler = lambda _: httpx.Response(403, json={"secret": REFRESH})
    response = c.post(BASE + "/sync")
    assert response.status_code == 403 and REFRESH not in response.text
    view = c.get(BASE + "/status").json()
    assert (
        view["configured"]
        and not view["verified"]
        and view["last_sync"]["status"] == "failed"
    )


def test_environment_refresh_credentials_cached_encrypted_and_scoped(
    fixture, monkeypatch
):
    c, p = fixture
    monkeypatch.setenv("HUBSPOT_TENANT", "alpha")
    monkeypatch.setenv("HUBSPOT_REFRESH_TOKEN", REFRESH)
    c.post(BASE + "/sync").raise_for_status()
    c.post(BASE + "/sync").raise_for_status()
    assert sum(str(req.url) == HubSpot.token_url for req in p.requests) == 1
    with store.engine.connect() as db:
        row = service._get(db, "alpha", service.CONNECTION, "deals")
    assert row["env_credential"] and not row.get("credential")
    assert ACCESS not in json.dumps(row) and REFRESH not in json.dumps(row)
    with pytest.raises(service.ProviderError, match="cannot be opened for this tenant"):
        service._decrypt("beta", row, "env_credential")
    assert c.get(BASE + "/status").json()["mode"] == "environment"


def test_oauth_retries_one_401_using_refreshed_access(fixture):
    c, p = fixture
    connect(c)

    def accept_current(req):
        if req.headers["authorization"] == "Bearer " + ACCESS:
            return httpx.Response(401)
        return httpx.Response(200, json={"results": [deal(10)]})

    p.handler = accept_current
    assert c.post(BASE + "/sync").json()["added"] == 1
    assert [r.url.path for r in p.requests][-3:] == [
        "/crm/objects/2026-09/deals/search",
        "/oauth/2026-09/token",
        "/crm/objects/2026-09/deals/search",
    ]


def test_rotated_refresh_grant_survives_reopen(fixture):
    c, p = fixture
    p.expires = 1
    p.rotate = True
    connect(c)
    c.post(BASE + "/sync").raise_for_status()
    assert p.refresh_value == REFRESH + "-rotated"
    with TestClient(
        app, base_url=ORIGIN, headers={"Authorization": "Bearer a-token"}
    ) as reopened:
        reopened.post(BASE + "/sync").raise_for_status()
    assert p.refresh_value == REFRESH + "-rotated-rotated"
    with store.engine.connect() as db:
        values = db.execute(
            select(store.records.c.payload).where(store.records.c.tenant == "alpha")
        ).scalars()
        assert all(REFRESH not in v for v in values)
