"""Exercise real evidence tools. SDK model decisions in this suite are controlled fixtures."""

import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from agents import Runner
from agents.tool_context import ToolContext
from monolith.architecture_review import REVIEWERS
from monolith.core import analyse
from monolith.investigator import ROLES, investigate
from monolith.portable_investigation import (
    STAGES,
    InvestigationError,
    Research,
    StageSession,
    investigate_deterministic,
)
from monolith.seed import make_seed
from provider_script import reply


@pytest.fixture
def workspace():
    data = make_seed()
    return data, analyse(data)


def test_source_reconciliation_and_real_tool_events(workspace):
    data, report = workspace
    emitted = []
    final = investigate_deterministic(data, report, lambda *e: emitted.append(e))
    assert final["verified"] and final["selected"] in {"queue", "batch"}
    assert final["package"]["baseline"]["cases"] == 132
    assert final["package"]["baseline"]["median"] == 31.15
    assert final["package"]["baseline"]["disputes"] == 66
    assert list(final["stages"]) == list(STAGES)
    assert [s for k, s, p in emitted if k == "stage_completed"] == list(STAGES)
    starts = [(s, p["call"], p["name"]) for k, s, p in emitted if k == "tool_started"]
    ends = [(s, p["call"], p["name"]) for k, s, p in emitted if k == "tool_result"]
    assert starts == ends
    known = {r["id"] for r in data["docs"] + data["events"]}
    for k, _, p in emitted:
        if k in ("stage_completed", "tool_result"):
            assert p["mode"] == "deterministic" and set(p["evidence"]) <= known
    assert all(f["evidence"] and set(f["evidence"]) <= known for f in final["findings"])
    process_findings = final["stages"]["process"]["findings"]
    assert any(f["kind"] == "hypothesis" for f in process_findings)
    assert any(
        f["kind"] == "observed" and "Details requested" in f["text"]
        for f in process_findings
    )
    assert all(t["approvals_retained"] == 132 for t in final["trials"].values())
    assert all(final["stages"]["verification"]["checks"].values())


@pytest.mark.parametrize("broken", ["median", "missing_source"])
def test_evidence_reconciliation_withholds_unsubstantiated_blueprint(workspace, broken):
    data, report = workspace
    if broken == "median":
        next(r for r in report["recommendations"] if r["id"] == "refund")["hours"] += 4
    else:
        data["sources"] = [s for s in data["sources"] if s["kind"] != "PDF"]
    result = investigate_deterministic(data, report, lambda *_: None)
    assert not result["verified"]
    assert result["selected"] == "neither"
    assert not all(result["stages"]["verification"]["checks"].values())


def test_dispute_only_cohort_retains_all_authority(workspace):
    data, report = workspace
    research = Research(data, report)
    case = research.pairs[0][0]["case"]
    rows = [e for e in data["events"] if e["case"] == case]
    extra = deepcopy(research.disputes[0])
    extra["case"] = case
    extra["timestamp"] = "2026-10-25T12:00:00+00:00"
    sub = {**data, "events": [*rows, extra]}
    result = investigate_deterministic(sub, analyse(sub), lambda *_: None)
    assert result["package"]["baseline"]["eligible"] == 0
    assert not result["verified"] and result["selected"] == "neither"
    assert all(trial["attempts"] == 0 for trial in result["trials"].values())


def test_scoped_retrieval_and_per_stage_tool_budget(workspace):
    data, report = workspace
    doc = data["docs"][0]["id"]
    research = Research(
        data,
        report,
        lambda _: [{"id": "OTHER-TENANT", "score": 1.0}, {"id": doc, "score": 0.2}],
    )
    assert research.find_policy("policy")["evidence"] == [doc]
    with pytest.raises(InvestigationError, match="scope"):
        research.read_evidence("OTHER-TENANT")
    session = StageSession(research, "strategy", lambda *_: None, "live")
    for _ in range(9):
        session.tool("find_policy")("reviewer")
    with pytest.raises(InvestigationError, match="budget"):
        session.tool("inspect_controls")()


def sdk_fixture(monkeypatch, misbehaviour=None):
    """Replace only the model runner. Invoke the actual SDK FunctionTool wrappers."""
    calls = []
    monkeypatch.setenv("MONOLITH_MODEL_CALLS_ENABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "unused-fixture-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://responses-fixture.invalid/v1")

    async def fake(agent, prompt, *, max_turns, run_config):
        stage = next(k for k, n in {**ROLES, **REVIEWERS}.items() if n == agent.name)
        if stage in REVIEWERS:
            inputs = json.loads(prompt)
            assert set(inputs) == {"investigation", "designs", "authority"}
        else:
            calls.append(stage)
            earlier = json.loads(prompt)["earlier_findings"]
            assert list(earlier) == calls[:-1]
        assert max_turns <= 8 and run_config.tracing_disabled
        tools = {t.name: t for t in agent.tools}
        assert set(tools) <= {
            "discover_scope",
            "measure_intervals",
            "read_case",
            "read_evidence",
            "find_policy",
            "inspect_controls",
            "compare_architectures",
            "simulate_routing",
            "audit_recommendation",
        }

        async def invoke(name, **args):
            raw = json.dumps(args)
            context = ToolContext(
                context=None, tool_name=name, tool_call_id="fixture", tool_arguments=raw
            )
            return await tools[name].on_invoke_tool(context, raw)

        await agent.hooks.on_llm_start(None, agent, None, [])
        output = await reply(stage, invoke, misbehaviour)
        await agent.hooks.on_llm_end(
            None,
            agent,
            SimpleNamespace(
                raw_usage=None, response_id="unit-fixture", request_id=None
            ),
        )
        return SimpleNamespace(final_output=agent.output_type.model_validate(output))

    monkeypatch.setattr(Runner, "run", fake)
    return calls


@pytest.mark.parametrize(
    "invalid,reason",
    [
        ("skip", "required investigation tool"),
        ("cite", "cited evidence"),
        ("number", "source timestamps"),
        ("estimate", "simulation receipt"),
    ],
)
def test_provider_cannot_bypass_evidence_tools(workspace, monkeypatch, invalid, reason):
    sdk_fixture(monkeypatch, invalid)
    trace = []
    with pytest.raises(InvestigationError, match=reason):
        asyncio.run(investigate(*workspace, lambda *e: trace.append(e), live=True))
    assert trace[-1][0] == "stage_failed"


@pytest.mark.parametrize("decision", ["accept", "reject"])
def test_six_specialists_consume_outputs_and_independent_verdict(
    workspace, monkeypatch, decision
):
    calls = sdk_fixture(monkeypatch, decision)
    trace = []
    result = asyncio.run(investigate(*workspace, lambda *e: trace.append(e), live=True))
    assert calls == list(STAGES)
    assert result["verified"] == (decision == "accept")
    assert result["selected"] == ("queue" if decision == "accept" else "neither")
    assert len(result["stages"]["architect"]["alternatives"]) == 2
    artifacts = result["package"]["approaches"][0]["artifacts"]
    assert any(a["title"].startswith("Agent-proposed") for a in artifacts) == (
        decision == "accept"
    )
    assert all(p["mode"] == "live" for k, s, p in trace if k == "stage_completed")


def test_keyless_live_request_is_explicit(workspace, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(InvestigationError, match="server-side"):
        asyncio.run(investigate(*workspace, lambda *_: None, live=True))
