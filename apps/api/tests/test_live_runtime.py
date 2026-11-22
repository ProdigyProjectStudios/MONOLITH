"""Deployment diagnostics, credential isolation and provider-side output limits."""

import asyncio
import json
import os
from types import SimpleNamespace

import pytest
from agents import ModelSettings
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from monolith import store
from monolith.live_receipts import (
    BoundedModel,
    BudgetExhausted,
    RunBudget,
    bounded_provider,
    connection,
)
from monolith.main import tenant
from monolith.portable_investigation import InvestigationError
from monolith.runtime_config import credential_status, openai_secret
from monolith.runtime_readiness import readiness_router
from test_provider_contract import ResponsesReplay, execute


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in (
        "OPENAI_API_KEY",
        "OPENAI_API_KEY_FILE",
        "OPENAI_BASE_URL",
        "REDIS_URL",
        "OPENAI_MAX_OUTPUT_TOKENS_PER_RUN",
        "OPENAI_MAX_CALLS_PER_RUN",
        "OPENAI_MAX_OUTPUT_TOKENS_PER_CALL",
    ):
        monkeypatch.delenv(name, raising=False)


def test_secret_file_precedence_validation_rotation_and_disposal(tmp_path, monkeypatch):
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "unit-env-credential")
    assert openai_secret() == "unit-env-credential"
    secret = tmp_path / "unit-private-filename"
    monkeypatch.setenv("OPENAI_API_KEY_FILE", str(secret))
    for bad in (None, "credential\ncontains whitespace", "X" * 8200, ""):
        if bad is not None:
            secret.write_text(bad)
        with pytest.raises(InvestigationError) as exc:
            openai_secret()
        assert secret.name not in str(exc.value)
        assert credential_status() == {
            "configured": False,
            "status": "invalid",
            "source": "file",
        }
    secret.write_text("unit-file-credential\n")
    assert openai_secret() == "unit-file-credential"
    secret.write_text("unit-rotated-credential")
    provider, origin = connection()
    assert provider.client.api_key == "unit-rotated-credential"
    assert origin["provider"] == "openai" and provider.client.max_retries == 0
    assert provider.client._client.follow_redirects is False

    async def run():
        with pytest.raises(RuntimeError):
            async with bounded_provider(provider, RunBudget.from_env()):
                raise RuntimeError

    asyncio.run(run())
    assert provider.client.is_closed()
    secret.unlink()
    os.mkfifo(secret)
    assert credential_status()["status"] == "invalid"


def test_readiness_authenticated_scope_and_real_receipt_filter(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setattr(store, "engine", engine)
    store.init()
    app = FastAPI()
    app.include_router(readiness_router(tenant))
    monkeypatch.setenv("MONOLITH_ENV", "development")
    monkeypatch.delenv("TENANT_TOKENS", raising=False)
    secret = tmp_path / "unit-path"
    secret.write_text("unit-safe-example")
    monkeypatch.setenv("OPENAI_API_KEY_FILE", str(secret))
    route = "/api/runtime/readiness"
    with TestClient(app) as client:
        assert client.get(route).status_code == 401
        monkeypatch.setenv(
            "TENANT_TOKENS", json.dumps({"a": "tenant-a-key", "b": "tenant-b-key"})
        )
        assert client.get(route).status_code == 401
        client.headers["Authorization"] = "Bearer tenant-a-key"
        initial = client.get(route)
        assert initial.headers["Cache-Control"] == "no-store"
        assert (
            "unit-safe-example" not in initial.text and "unit-path" not in initial.text
        )
        assert initial.json()["worker"]["status"] == "in_process"
        assert initial.json()["provider"]["verification"] == "unverified"
        receipt = {
            "mode": "live",
            "status": "completed",
            "provider": "openai",
            "provider_endpoint": "https://api.openai.com/v1/responses",
            "model": "unit-model",
            "response_id": "resp_test",
        }
        for t, rid, overrides in [
            ("b", "other-workspace", {}),
            ("a", "fixture", {"provider": "test-fixture"}),
            ("a", "compatible", {"provider_endpoint": "https://compatible.invalid"}),
            ("a", "no-response", {"response_id": None}),
            ("a", "bad-id", {"response_id": "respXtest"}),
            ("a", "did-fail", {"status": "failed"}),
        ]:
            with store.locked(t) as c:
                store.put(
                    c,
                    t,
                    f"investigation-events/{rid}",
                    "00000001",
                    {
                        "kind": "model_call",
                        "at": "2025-01-01",
                        "payload": {**receipt, **overrides},
                    },
                )
        assert client.get(route).json()["provider"]["last_response"] is None
        client.headers["Authorization"] = "Bearer tenant-b-key"
        provider_view = client.get(route).json()["provider"]
        assert provider_view["verification"] == "observed_response"
        assert provider_view["last_response"] == {
            "at": "2025-01-01",
            "run_id": "other-workspace",
            "model": "unit-model",
        }
        monkeypatch.setenv("OPENAI_MAX_CALLS_PER_RUN", "0")
        assert client.get(route).json()["budget"] is None
        monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1")
        unavailable = client.get(route).json()
        assert (
            unavailable["queue"]["status"] == "unavailable"
            and unavailable["worker"]["status"] == "unknown"
        )
    engine.dispose()


@pytest.mark.parametrize(
    ("calls", "tokens", "output_limits"), [(2, 100, [60, 60]), (10, 20, [20, 10])]
)
def test_budget_bounds_real_sdk_dispatch(monkeypatch, calls, tokens, output_limits):
    monkeypatch.setenv("OPENAI_MAX_CALLS_PER_RUN", str(calls))
    monkeypatch.setenv("OPENAI_MAX_OUTPUT_TOKENS_PER_CALL", "60")
    monkeypatch.setenv("OPENAI_MAX_OUTPUT_TOKENS_PER_RUN", str(tokens))

    class ObservedRequests(ResponsesReplay):
        sent_limits = []

        async def __call__(self, request):
            self.sent_limits.append(json.loads(request.content)["max_output_tokens"])
            return await super().__call__(request)

    replay, events = ObservedRequests(), []
    with pytest.raises(BudgetExhausted):
        execute(monkeypatch, replay, events)
    assert replay.sent_limits == output_limits
    assert replay.n == 2
    completed = [p for k, _, p in events if k == "model_call"]
    assert len(completed) == replay.n and all(
        p["status"] == "completed" for p in completed
    )
    denials = [p for k, _, p in events if k == "provider_budget_exhausted"]
    assert len(denials) == 1 and denials[0]["calls"] == replay.n


@pytest.mark.parametrize("fail", [True, False])
def test_ambiguous_usage_keeps_full_reservation(fail):
    class Endpoint:
        async def get_response(self, **kwargs):
            if fail:
                raise TimeoutError
            return SimpleNamespace(raw_usage=None)

    model = BoundedModel(Endpoint(), RunBudget(8, 10, 10))

    async def run():
        args = (None, [], ModelSettings(max_tokens=100), [], None, [], None)
        if fail:
            with pytest.raises(TimeoutError):
                await model.get_response(*args)
        else:
            await model.get_response(*args)
        with pytest.raises(BudgetExhausted):
            await model.get_response(*args)

    asyncio.run(run())
    assert model.budget.calls == 1 and model.budget.charged_output_tokens == 10


def test_operator_prompt_saves_private_file_without_echo(tmp_path):
    import pty
    import select
    import subprocess
    import sys
    from pathlib import Path

    script = Path(__file__).resolve().parents[3] / "scripts/configure-openai-key.py"
    dest = tmp_path / "secrets" / "key"
    controller, tty = pty.openpty()
    try:
        process = subprocess.Popen(
            [sys.executable, str(script), str(dest)],
            stdin=tty,
            stdout=tty,
            stderr=tty,
            start_new_session=True,
        )
        assert select.select([controller], [], [], 5)[0]
        transcript = os.read(controller, 1024)
        assert b"hidden input" in transcript
        # A locally generated placeholder exercises terminal behaviour without a provider.
        sample = b"qa-placeholder-readable-only-by-user"
        os.write(controller, sample + b"\n")
        assert process.wait(timeout=5) == 0
        transcript += os.read(controller, 2048)
        assert sample not in transcript and dest.read_bytes().strip() == sample
        assert dest.stat().st_mode & 0o777 == 0o600
        assert dest.parent.stat().st_mode & 0o777 == 0o700
    finally:
        os.close(controller)
        os.close(tty)


def test_model_credentials_require_tls_on_remote_provider(monkeypatch):
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "qa-placeholder")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://alternate-provider.example/v1")
    with pytest.raises(InvestigationError, match="HTTPS"):
        connection()


def test_off_switch_blocks_model_dispatch_even_with_a_key(monkeypatch):
    from monolith.runtime_config import openai_configured
    from monolith.investigation_api import _ready
    from fastapi import HTTPException

    monkeypatch.delenv("MONOLITH_MODEL_CALLS_ENABLED", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "local-unusable-test-credential")
    assert credential_status()["configured"]
    assert not openai_configured()
    with pytest.raises(InvestigationError, match="disabled"):
        connection()
    with pytest.raises(HTTPException, match="disabled") as refusal:
        _ready("live")
    assert refusal.value.status_code == 409
