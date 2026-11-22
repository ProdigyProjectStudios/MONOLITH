"""Portable checkpoint, historic decision and event-time outcome regressions."""

from copy import deepcopy

import pytest
from monolith.continuous_engine import analyze_stream, observe_subject
from monolith.continuous_fixture import WAVES, fixture_csv
from monolith.continuous_investigation import (
    STAGES,
    advance_investigation,
    finish_investigation,
    normalize_decision,
    reassess_decision,
    reassess_decisions,
)
from monolith.core import analyse, merge, parse_csv
from monolith.portable_investigation import investigate_deterministic
from monolith.seed import make_seed


@pytest.fixture(scope="module")
def inputs():
    initial = make_seed()
    backlog = deepcopy(initial)
    merge(backlog, *parse_csv(fixture_csv("backlog"), WAVES["backlog"][1], True))
    recovery = deepcopy(backlog)
    merge(recovery, *parse_csv(fixture_csv("recovery"), WAVES["recovery"][1], True))
    signals = analyze_stream(backlog)["signals"]
    refund = next(
        s
        for s in signals
        if s["kind"] == "latency"
        and s["subject"] == ["Invoice rekeyed", "Refund authorised"]
    )
    return initial, backlog, recovery, signals, refund


def investigate(data, signal, memory=()):
    checkpoints = []
    for stage in STAGES:
        result = advance_investigation(data, signal, memory, checkpoints)
        assert result["stage"] == stage
        checkpoints.append(result)
    return checkpoints, finish_investigation(signal, checkpoints)


def wrapped(result, ident="job0001", approval=None):
    return {
        "id": ident,
        "status": "completed",
        "mode": "deterministic",
        "created": "2026-11-29T00:00:00+00:00",
        "result": result,
        "approval": approval,
    }


@pytest.mark.parametrize(
    "kind", ["latency", "variant", "drift", "duplicate", "handoff"]
)
def test_all_detector_kinds_have_six_source_cited_stages_and_human_retains_authority(
    inputs, kind
):
    _, data, _, signals, _ = inputs
    signal = next(s for s in signals if s["kind"] == kind)
    checkpoints, result = investigate(data, signal)
    assert (
        result["verified"]
        and result["approval"] is None
        and result["mode"] == "deterministic"
    )
    assert result["selected"] in {"source_audit", "review_worklist"}
    known = {r["id"] for r in data["events"]}
    assert all(
        f["evidence"] and set(f["evidence"]) <= known for f in result["findings"]
    )
    assert all(
        c["mode"] == "deterministic" and c["agent"] and c["evidence"]
        for c in checkpoints
    )
    assert result["stages"]["verification"]["checks"]["detector_reproduced"]
    process = result["stages"]["process"]
    assert (
        process["metric"] == signal["metric"]
        and process["windows"] == signal["windows"]
    )
    assert {f["kind"] for f in process["findings"]} == {"observed", "hypothesis"}
    simulation = result["stages"]["simulation"]
    assert simulation["findings"][0]["kind"] == "assumption"
    assert all(
        t["supporting_cases"] == t["unreviewed_cases"] + t["cases_reviewed"]
        and t["review_minutes"]
        <= simulation["assumptions"]["reviewer_minutes_per_period"]
        for t in simulation["trials"]
    )
    decision = normalize_decision(wrapped(result))
    assert decision["decision"] == "proposed" and decision["approval"] is None
    assert (
        decision["run_id"] == "job0001"
        and decision["metric_key"] == signal["metric"]["id"]
    )


def test_real_nonrefund_investigation_and_json_checkpoint_retries(inputs):
    data = inputs[0]
    signal = next(
        s
        for s in analyze_stream(data)["signals"]
        if s["subject"] == ["Parcel dispatched", "Delivery confirmed"]
    )
    first = advance_investigation(data, signal, [], [])
    second = advance_investigation(data, signal, [], [first])
    assert first == advance_investigation(
        {k: list(reversed(rows)) for k, rows in data.items()}, signal, [], []
    )

    # Browsers encode integral floats as integers. Cross the JS boundary between stages.
    def browser(v):
        if isinstance(v, dict):
            return {k: browser(val) for k, val in v.items()}
        if isinstance(v, list):
            return [browser(val) for val in v]
        return int(v) if isinstance(v, float) and v.is_integer() else v

    third = advance_investigation(
        data, browser(signal), [], [browser(first), browser(second)]
    )
    assert third["stage"] == "strategy"
    with pytest.raises(ValueError, match="checkpoint"):
        advance_investigation(data, signal, [], [second])
    with pytest.raises(ValueError, match="checkpoint"):
        advance_investigation(
            data, {**signal, "support": signal["support"] + 1}, [], [first]
        )
    modified = deepcopy(data)
    modified["events"][-1]["timestamp"] = "2026-11-30T18:00:00+00:00"
    with pytest.raises(ValueError, match="checkpoint"):
        advance_investigation(modified, signal, [], [first])
    with pytest.raises(ValueError, match="Six ordered"):
        finish_investigation(signal, [first])
    cps, result = investigate(data, signal)
    assert (
        result["verified"]
        and result["stages"]["process"]["metric"]["id"] == "transition_hours"
    )
    with pytest.raises(ValueError, match="already complete"):
        advance_investigation(data, signal, [], cps)
    cps[2]["summary"] = "different conclusion"
    with pytest.raises(ValueError, match="checkpoint"):
        finish_investigation(signal, cps)


def test_genuine_source_verification_holds_spoofed_metric_and_missing_sources(inputs):
    _, data, _, _, signal = inputs
    bad = deepcopy(signal)
    bad["metric"]["recent"] += 5
    _, result = investigate(data, bad)
    assert not result["verified"] and result["selected"] is None
    assert not result["stages"]["verification"]["checks"]["detector_reproduced"]
    assert normalize_decision(wrapped(result))["decision"] == "held"
    incomplete = {**data, "sources": []}
    _, result = investigate(incomplete, signal)
    assert not result["verified"]
    assert not result["stages"]["verification"]["checks"]["source_rows_resolve"]


def test_reassessment_after_recovery_even_when_detector_clears_no_retroactive_approval(
    inputs,
):
    _, backlog, recovery, _, s = inputs
    _, result = investigate(backlog, s)
    original = normalize_decision(wrapped(result))
    before = deepcopy(original)
    assert reassess_decision(original, s, backlog) is None
    assert s["id"] not in {r["id"] for r in analyze_stream(recovery)["signals"]}
    observation = reassess_decision(original, None, recovery)
    assert observation == reassess_decisions([original], recovery)[0]
    assert observation["status"] == "decreased" and not observation["active"]
    assert (
        observation["from_value"] == pytest.approx(70.3333)
        and observation["to_value"] == 25.2
    )
    assert observation["delta"] == pytest.approx(-45.1333)
    assert (
        observation["comparison"] == "matched_metric"
        and observation["attribution"] == "unestablished"
    )
    assert observation["support"] == 42 and observation["at"] > original["as_of"]
    assert observation["evidence"] and original == before
    assert set(observation["evidence"]) <= {r["id"] for r in recovery["events"]}
    assert original["decision"] == "proposed" and original["approval"] is None
    assert reassess_decision(original, s, recovery) is None
    fake = observe_subject(recovery, original)
    fake["metric"]["recent"] = 0
    assert reassess_decision(original, fake, recovery) is None
    assert reassess_decision({**original, "as_of": None}, None, recovery) is None
    assert (
        reassess_decision({**original, "subject": ["Other", "Path"]}, None, recovery)
        is None
    )


def test_legacy_human_approval_verifier_veto_and_deployment_uncertainty(inputs):
    initial, backlog, _, _, signal = inputs
    report = analyse(initial)
    historic = investigate_deterministic(initial, report, lambda *_: None)
    selected = historic["selected"]
    rejected = next(
        p["id"] for p in historic["package"]["approaches"] if p["id"] != selected
    )
    e = historic["evidence"][:2]
    historic["stages"]["verification"].update(
        eligible_designs=[selected], rejected_designs=[rejected]
    )
    historic["stages"]["architect"]["debate"] = {
        "assessments": [
            {
                "reviewer": "reliability",
                "rejected": [rejected],
                "tradeoffs": [
                    {
                        "approach": rejected,
                        "rejection_reason": "Audit replay did not preserve the original human decision.",
                        "evidence": e,
                    }
                ],
            }
        ]
    }
    approved = {"at": "2026-11-25T10:00:00+00:00", "approach": selected}
    run = {**wrapped(historic, "archive-01", approved), "as_of": report["asof"]}
    record = normalize_decision(run)
    assert record["origin"] == "refund_studio" and record["approval"] == approved
    assert (
        record["decision"] == "approved" and record["findings"] == historic["findings"]
    )
    assert record["rejected_designs"] == [
        {
            "id": rejected,
            "reason": "reliability review: Audit replay did not preserve the original human decision.",
            "evidence": e,
        }
    ]
    assert normalize_decision({**run, "status": "failed"}) is None
    wrong = normalize_decision({**run, "approval": {**approved, "approach": rejected}})
    assert wrong["decision"] == "proposed" and wrong["approval"] is None
    observation = reassess_decision(record, signal, backlog)
    assert (
        observation["comparison"] == "legacy_context"
        and observation["status"] == "increased"
    )
    assert observation["from_value"] == historic["package"]["baseline"]["median"]
    cps, new = investigate(backlog, signal, [record])
    assert (
        "previously approved" in cps[2]["summary"]
        and cps[2]["prior_decisions"][0]["run_id"] == "archive-01"
    )
    assert new["selected"] == "source_audit" and new["approval"] is None


def test_prior_veto_prevents_reuse_and_recent_explicit_approval_retains_provenance(
    inputs,
):
    _, data, _, _, s = inputs
    _, first = investigate(data, s)
    d = normalize_decision(wrapped(first))
    vetoes = [
        {
            "id": p["id"],
            "reason": "Pilot judged under-specified.",
            "evidence": s["evidence"][:1],
        }
        for p in first["stages"]["architect"]["alternatives"]
    ]
    held = {**d, "decision": "held", "selected": None, "rejected_designs": vetoes}
    _, result = investigate(data, s, [held])
    assert not result["verified"] and result["selected"] is None
    assert result["stages"]["verification"]["rejected_designs"] == vetoes
    assert not result["stages"]["verification"]["checks"]["eligible_design_remains"]
    human = {
        **d,
        "id": "decision-newer",
        "decision": "approved",
        "at": "2026-11-30T12:00:00+00:00",
        "approval": {"approach": "source_audit", "at": "2026-11-30T12:00:00+00:00"},
    }
    _, result = investigate(data, s, [human, held])
    assert result["verified"] and result["selected"] == "source_audit"
    assert result["approval"] is None
    assert held["rejected_designs"] == vetoes
