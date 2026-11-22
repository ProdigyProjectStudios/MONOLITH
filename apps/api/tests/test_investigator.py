"""Exercise real evidence tools. SDK model decisions in this suite are controlled fixtures."""

import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from agents import Runner
from agents.tool_context import ToolContext

from monolith.core import analyse
from monolith.investigator import ROLES, investigate
from monolith.portable_investigation import (
    DOMAIN_TOOL,
    STAGES,
    InvestigationError,
    Research,
    StageSession,
    investigate_deterministic,
)
from monolith.seed import make_seed


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
    monkeypatch.setenv("OPENAI_API_KEY", "unused-fixture-key")

    async def fake(agent, prompt, *, max_turns, run_config):
        stage = next(k for k, n in ROLES.items() if n == agent.name)
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

        if stage == "simulation":
            results = [
                await invoke(
                    "simulate_routing",
                    approach=p,
                    coverage=0.5,
                    reduction=0.25,
                    failure=0.05,
                )
                for p in ("queue", "batch")
            ]
            result = results[0]
        elif misbehaviour == "skip" and stage == "discovery":
            result = {
                "evidence": ["EV-not-read"],
                "refund_cases": 132,
                "systems": {"Finance": 1},
            }
        else:
            result = await invoke(DOMAIN_TOOL[stage])
        cites = result["evidence"][:2]
        output = {
            "summary": "Cited fixture judgement.",
            "evidence": cites,
            "findings": [
                {
                    "kind": "limitation",
                    "text": "Source clocks do not measure active handling time.",
                    "evidence": cites,
                }
            ],
        }
        if stage == "discovery":
            output.update(
                matched_cases=result["refund_cases"],
                observed_systems=list(result["systems"]),
            )
            if misbehaviour == "cite":
                output["evidence"] = ["DOC-not-in-the-receipt"]
        elif stage == "process":
            await invoke("read_evidence", evidence_id=cites[0])
            output.update(
                matched_cases=result["cases"],
                median_hours=result["median_hours"]
                + (50 if misbehaviour == "number" else 0),
                missing_observation="Review start time.",
            )
        elif stage == "strategy":
            await invoke("find_policy", query="human dispute reviewer")
            output.update(
                disposition="pilot_routing",
                refund_authority="finance_operator",
                dispute_authority="human_reviewer",
                validation_step="Compare held cases with reviewed case records.",
            )
        elif stage == "architect":
            output.update(
                alternatives=[
                    {
                        "approach": p["id"],
                        "evidence": cites,
                        "integration_contract": "Read source event ID and case ID.",
                        "schema_change": "Record a tenant-scoped reference.",
                        "recovery": "Replay after local commit.",
                        "prerequisites": ["Validate the field map."],
                        "acceptance_test": "A duplicate creates a single record.",
                    }
                    for p in result["approaches"]
                ],
                tradeoff="Queue delivery and batch intervals present different operational costs.",
            )
        elif stage == "simulation":
            output.update(
                estimates=[
                    {
                        "trial": r["trial"],
                        "approach": r["scenario"]["approach"],
                        "projected_median_hours": r["scenario"]["projected_median"],
                        "modelled_net_savings": r["scenario"]["net_savings"]
                        + (1 if misbehaviour == "estimate" else 0),
                    }
                    for r in results
                ],
                sensitivity="Forecast depends on coverage and failure assumptions.",
            )
        else:
            await invoke("read_evidence", evidence_id=cites[0])
            reject = misbehaviour == "reject"
            output.update(
                verdict="reject" if reject else "accept",
                selected="neither" if reject else "queue",
                challenge="The log does not establish queue wait as a cause.",
                precondition="Review source timelines.",
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
