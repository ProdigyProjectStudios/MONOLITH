"""In-memory contract fixture for ephemeral UI tests. Never publish its output.

The Responses protocol is replayed by a test transport. An explicit test-only
context substitutes synthetic receipt metadata so the real projection code and
positive consumer schema can be exercised without an OpenAI account.
"""

import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from runpy import run_path

import pytest
import test_provider_contract
from monolith import replay_capture as archive
from monolith.core import analyse
from monolith.mining import mine
from test_provider_contract import ResponsesReplay, execute


def sample():
    # The real frozen database query orders rows by ID. The shipped public fixture
    # retains CSV import order, so this also exercises canonicalization.
    public = json.loads(archive.DEMO.read_bytes())
    stored = {
        k: sorted(v, key=lambda row: row["id"]) for k, v in public["data"].items()
    }
    snapshot = {"data": stored, "report": analyse(stored, 30)}
    events = []
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(test_provider_contract, "make_seed", lambda: stored)
        mp.setattr(
            test_provider_contract, "analyse", lambda data: mine(data, analyse(data))
        )
        result = execute(mp, ResponsesReplay(), events)
    created = datetime(2026, 11, 22, 12, tzinfo=UTC)

    def clock(i):
        return (created + timedelta(seconds=i)).isoformat()

    trace = [
        {"kind": "run_queued", "stage": "run", "payload": {"mode": "live", "days": 30}},
        {"kind": "run_started", "stage": "run", "payload": {"mode": "live"}},
    ]
    trace.extend({"kind": k, "stage": stage, "payload": v} for k, stage, v in events)
    trace.append(
        {
            "kind": "run_completed",
            "stage": "run",
            "payload": {"verified": result["verified"]},
        }
    )
    decision = {"approach": result["selected"], "at": clock(len(trace))}
    trace.append(
        {"kind": "blueprint_approved", "stage": "verification", "payload": decision}
    )
    for i, row in enumerate(trace, 1):
        row.update(seq=i, at=clock(i))
    run = {
        "id": "f" * 32,
        "mode": "live",
        "status": "completed",
        "days": 30,
        "created": clock(0),
        "approval": decision,
        "events": trace,
        "result": result,
    }
    return run, snapshot


def _protocol_example(run):
    # Replace only synthetic metadata in the test JSON. The originating server
    # stream retains its explicit fixture provenance and fails real attestation.
    def walk(node):
        if isinstance(node, list):
            return [walk(v) for v in node]
        if not isinstance(node, dict):
            return node
        row = {k: walk(v) for k, v in node.items()}
        if row.get("provider") == "test-fixture":
            row["provider"] = "openai"
            row["provider_endpoint"] = "https://api.openai.com/v1/responses"
            row["model"] = "gpt-4.1-mini"
            if row.get("response_id"):
                row["response_id"] = (
                    "resp_" + sha256(row["response_id"].encode()).hexdigest()
                )
            if row.get("request_id"):
                row["request_id"] = (
                    "req_" + sha256(row["request_id"].encode()).hexdigest()
                )
        return row

    return walk(run)


def sample_contract(run=None, demo=None):
    if run is None:
        run, demo = sample()
    run = _protocol_example(run)
    cli = run_path(
        str(
            Path(__file__).resolve().parents[3] / "scripts/verify-live-investigation.py"
        )
    )
    acceptance = cli["attest"](run, run["events"][:-1], demo)
    return run, demo, acceptance


def build_ui_fixture():
    run, demo, acceptance = sample_contract()
    captured = json.loads(
        archive.build_capture(
            run,
            demo,
            run["events"][:-1],
            acceptance,
            "northstar",
            "unit-test-only-bearer",
        )
    )
    captured["test_only"] = True
    captured["test_notice"] = (
        "Browser protocol fixture. No live provider call occurred."
    )
    return captured
