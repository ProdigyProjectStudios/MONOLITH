"""Verifier contract tests. All positive receipt examples here are synthetic fixtures."""

import json
import time
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from monolith import store
from monolith.main import app
from sqlalchemy import create_engine

SCRIPT = (
    Path(__file__).resolve().parents[3] / "scripts" / "verify-live-investigation.py"
)
spec = spec_from_file_location("live_acceptance", SCRIPT)
cli = module_from_spec(spec)
spec.loader.exec_module(cli)


def fixture_run():
    # Names and values mimic the interface only. No external model is contacted.
    private = "private source phrase for redaction test"
    source_id = "fixture-source"
    evidence = ["EV-fixture-0"]
    rows = [
        {
            "id": f"EV-fixture-{i}",
            "source": source_id,
            "row": i + 2,
            "case": "private case",
            "activity": act,
            "timestamp": ts,
        }
        for i, (act, ts) in enumerate(
            [
                ("Invoice rekeyed", "2026-11-01T10:00:00+00:00"),
                ("Refund authorised", "2026-11-01T14:00:00+00:00"),
            ]
        )
    ]
    snapshot = {
        "data": {
            "events": rows,
            "docs": [],
            "sources": [{"id": source_id, "name": private}],
        }
    }
    result = {
        "selected": "queue",
        "verified": True,
        "package": {"baseline": {"cases": 1, "median": 4}},
        "stages": {},
        "findings": [],
        "evidence": evidence,
        "model_calls": [],
    }
    run = {
        "id": "a" * 32,
        "mode": "live",
        "status": "completed",
        "events": [],
        "result": result,
    }

    def emit(kind, stage, payload):
        run["events"].append(
            {
                "seq": len(run["events"]) + 1,
                "kind": kind,
                "stage": stage,
                "payload": payload,
            }
        )

    def perform(stage, agent, tools, reviewer=None):
        meta = {"mode": "live", "agent": agent}
        if reviewer:
            meta["reviewer"] = reviewer
        receipt = {
            **meta,
            "status": "completed",
            "provider": "openai",
            "transport": "responses",
            "provider_endpoint": "https://api.openai.com/v1/responses",
            "response_id": "resp_fixture_" + str(len(result["model_calls"])),
            "request_id": "req_fixture",
            "model": "gpt-4.1-mini",
            "call": 1,
            "duration_ms": 3.1,
            "usage": {
                "input_tokens": 20,
                "output_tokens": 10,
                "total_tokens": 30,
                "cached_input_tokens": None,
            },
            "estimated_cost_usd": None,
        }
        result["model_calls"].append(receipt)
        emit("model_call", stage, receipt)
        for tool in tools:
            emit(
                "tool_result",
                stage,
                {
                    **meta,
                    "name": tool,
                    "input": {},
                    "result": {"evidence": evidence, "excerpt": private},
                    "evidence": evidence,
                },
            )

    for stage, (role, coretool) in cli.STAGES.items():
        emit("stage_started", stage, {"mode": "live"})
        out = {
            "summary": private,
            "evidence": evidence,
            "findings": [{"text": private, "evidence": evidence}],
        }
        perform(
            stage,
            role,
            [coretool] + (["read_evidence"] if stage == "verification" else []),
        )
        if stage == "process":
            out.update(matched_cases=1, median_hours=4)
        if stage == "architect":
            reviews = []
            for key, reviewer in cli.REVIEWERS.items():
                perform(
                    stage, reviewer, ["compare_architectures", "read_evidence"], key
                )
                assessment = {
                    "reviewer": key,
                    "evidence": evidence,
                    "rejected": [],
                    "tradeoffs": [
                        {"approach": a, "evidence": evidence}
                        for a in ("queue", "batch")
                    ],
                }
                reviews.append(assessment)
                emit(
                    "architecture_assessment",
                    stage,
                    {**assessment, "mode": "live", "agent": reviewer},
                )
            out["debate"] = {
                "assessments": reviews,
                "eligible": ["batch", "queue"],
                "disagreement": False,
            }
            emit("architecture_debate", stage, {**out["debate"], "mode": "live"})
        if stage == "verification":
            out.update(
                verdict="accept",
                selected="queue",
                eligible_designs=["queue", "batch"],
                rejected_designs=[],
                checks={"valid": True},
                review_resolutions=[
                    {"reviewer": s, "evidence": evidence} for s in cli.REVIEWERS
                ],
            )
        result["stages"][stage] = out
        emit("stage_completed", stage, {**out, "mode": "live"})
    emit("run_completed", "run", {"verified": True})
    return run, snapshot


def test_fixture_contract_and_redaction():
    run, snapshot = fixture_run()
    summary = cli.attest(run, run["events"], snapshot)
    assert summary["model_calls"] == 8 and summary["tokens"]["total_tokens"] == 240
    assert (
        summary["tokens"]["cached_input_tokens"] is None
        and summary["estimated_cost_usd"] is None
    )
    assert summary["evidence_references"] == 1 and summary["source_count"] == 1
    text = json.dumps(summary)
    assert (
        "private" not in text
        and "EV-fixture" not in text
        and "resp_fixture" not in text
    )
    run["events"][-1]["payload"]["verified"] = False
    run["result"]["verified"] = False
    run["result"]["selected"] = "neither"
    run["result"]["stages"]["verification"].update(
        verdict="reject", selected="neither", eligible_designs=[]
    )
    assert (
        cli.attest(run, run["events"], snapshot)["verification"]["verdict"] == "reject"
    )


@pytest.mark.parametrize(
    "breakage",
    [
        "deterministic",
        "proxy",
        "mock",
        "missing_receipt",
        "empty_id",
        "repeated_id",
        "zero_tokens",
        "evidence",
        "source",
        "timestamp",
        "tool",
        "resolution",
        "veto",
        "persisted",
    ],
)
def test_refuses_invalid_live_claim(breakage):
    run, snapshot = fixture_run()
    events = run["events"]
    calls = run["result"]["model_calls"]
    if breakage == "deterministic":
        run["mode"] = "deterministic"
    elif breakage == "proxy":
        calls[0]["provider_endpoint"] = (
            "https://api.openai.com.other.example/v1/responses"
        )
    elif breakage == "mock":
        calls[0]["provider"] = "test-fixture"
    elif breakage == "missing_receipt":
        calls.pop()
    elif breakage == "empty_id":
        calls[0]["response_id"] = None
    elif breakage == "repeated_id":
        calls[0]["response_id"] = calls[-1]["response_id"]
    elif breakage == "zero_tokens":
        calls[0]["usage"]["output_tokens"] = 0
    elif breakage == "evidence":
        run["result"]["findings"] = [{"evidence": ["EV-UNKNOWN"]}]
    elif breakage == "source":
        snapshot["data"]["sources"] = []
    elif breakage == "timestamp":
        snapshot["data"]["events"][-1]["timestamp"] = "2026-11-02T14:00:00+00:00"
    elif breakage == "tool":
        next(
            e
            for e in events
            if e["kind"] == "tool_result"
            and e["payload"]["agent"] == "Operations reviewer"
        )["payload"]["name"] = "other"
    elif breakage == "resolution":
        run["result"]["stages"]["verification"]["review_resolutions"] = []
    elif breakage == "veto":
        run["result"]["stages"]["architect"]["debate"]["assessments"][0]["rejected"] = [
            "queue"
        ]
    elif breakage == "persisted":
        events = events[1:]
    with pytest.raises(cli.Incomplete):
        cli.attest(run, events, snapshot)


def test_reconnects_from_committed_cursor_and_discards_partial_frame():
    observed = []
    events = [{"seq": 1, "kind": "run_started"}, {"seq": 2, "kind": "run_completed"}]

    def frame(e):
        return f"id: {e['seq']}\ndata: {json.dumps(e)}\n\n"

    def endpoint(req):
        cursor = req.headers["last-event-id"]
        observed.append((cursor, req.url.params["after"]))
        body = (
            (": hello\n\n" + frame(events[0]) + "id: 2\ndata: incomplete")
            if cursor == "0"
            else frame(events[1])
        )
        return httpx.Response(
            200, text=body, headers={"content-type": "text/event-stream"}
        )

    with httpx.Client(
        base_url="http://localhost/api/", transport=httpx.MockTransport(endpoint)
    ) as c:
        assert (
            cli.watch(c, "fixture", time.monotonic() + 10, pause=lambda _: None)
            == events
        )
    assert observed == [("0", "0"), ("1", "1")]


@pytest.mark.parametrize(
    "raw",
    [
        "http://workspace.example",
        "https://secret@workspace.example",
        "https://workspace.example?token=secret",
    ],
)
def test_restricts_credential_destination(raw):
    with pytest.raises(cli.Incomplete):
        cli.api_origin(raw)


def test_auth_and_actual_missing_provider_refusal(monkeypatch, tmp_path):
    monkeypatch.setattr(
        store, "engine", create_engine("sqlite:///" + str(tmp_path / "test.db"))
    )
    monkeypatch.setenv("TENANT_TOKENS", json.dumps({"northstar": "workspace-test-key"}))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    args = SimpleNamespace(start=True, days=30, timeout=5)
    with TestClient(app, base_url="http://testserver/api/") as c:
        with pytest.raises(cli.Incomplete, match="HTTP 409"):
            cli.verify(c, args, "workspace-test-key")
        assert c.get("investigations").json() == {"runs": []}
    with (
        TestClient(app, base_url="http://testserver/api/") as c,
        pytest.raises(cli.Incomplete, match="HTTP 401"),
    ):
        cli.verify(c, args, "wrong")
    with (
        TestClient(app, base_url="http://testserver/api/") as c,
        pytest.raises(cli.Incomplete, match="WORKSPACE_TOKEN"),
    ):
        cli.verify(c, args, None)
