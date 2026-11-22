"""Independent snapshot assessment, including adversarially modified completed artifacts."""

from copy import deepcopy

import pytest
from monolith.core import analyse
from monolith.evaluation import evaluate
from monolith.portable_investigation import investigate_deterministic
from monolith.seed import make_seed


@pytest.fixture
def completed():
    data = make_seed()
    report = analyse(data, 30)
    result = investigate_deterministic(data, report, lambda *_: None)
    return data, report, result


def stage(audit, which):
    return next(s for s in audit["stages"] if s["id"] == which)


def check(audit, which, rule):
    return next(c for c in stage(audit, which)["checks"] if c["id"] == rule)


def test_seed_replays_and_records_limitations(completed):
    data, report, result = completed
    audit = result["evaluation"]
    assert evaluate(data, report, result) == audit
    assert len(audit["snapshot_sha256"]) == 64
    assert audit["coverage"]["covered"] == audit["coverage"]["findings"] == 8
    assert audit["coverage"]["percent"] == 100
    assert audit["support"]["failed"] == 0 and audit["score"] == 100
    assert audit["status"] == "review" and audit["support"]["review"] >= 2
    assert check(audit, "process", "original_report")["expected"] == {
        "cases": 132,
        "hours": 31.15,
    }
    assert check(audit, "strategy", "dispute_count")["expected"] == 66
    assert audit["human_control"]["status"] == "pass"
    assert any("failure exposure favours batch" in d for d in audit["disagreements"])


def test_fingerprint_ignores_runtime_and_order_includes_source_content(completed):
    data, report, result = completed
    old = result["evaluation"]["snapshot_sha256"]
    copy = deepcopy(data)
    for records in copy.values():
        records.reverse()
    decorated = {
        **report,
        "mining": "PM4Py",
        "traces": [],
        "case_ids": list(reversed(report["case_ids"])),
    }
    assert evaluate(copy, decorated, result)["snapshot_sha256"] == old
    copy["docs"][0]["text"] += " Additional source evidence."
    assert evaluate(copy, decorated, result)["snapshot_sha256"] != old
    assert result["evaluation"]["snapshot_sha256"] == old


@pytest.mark.parametrize(
    "source_fault", ["unresolved", "wrong_page", "duplicate_identity"]
)
def test_citation_faults_reduce_coverage_and_flag_affected_stage(
    completed, source_fault
):
    data, report, result = completed
    if source_fault == "unresolved":
        result["stages"]["strategy"]["findings"][0]["evidence"].append("DOC-foreign")
    elif source_fault == "wrong_page":
        data["docs"][0]["page"] = 0
    else:
        data["docs"].append({**data["docs"][0], "text": "Conflicting source copy"})
    original_gate = result["verified"]
    audit = evaluate(data, report, result)
    assert audit["status"] == "fail" and audit["score"] < 100
    assert audit["coverage"]["covered"] < audit["coverage"]["findings"]
    assert check(audit, "strategy", "finding_coverage")["status"] == "fail"
    assert stage(audit, "strategy")["weaknesses"]
    assert result["verified"] == original_gate


def test_valid_unrelated_record_cannot_ground_elapsed_interval(completed):
    data, report, result = completed
    valid_doc = data["docs"][0]["id"]
    result["stages"]["process"]["findings"][0]["evidence"] = [valid_doc]
    audit = evaluate(data, report, result)
    assert check(audit, "process", "finding_coverage")["status"] == "pass"
    assert check(audit, "process", "matched_witnesses")["status"] == "fail"


def test_underlying_data_and_both_statements_are_checked_independently(completed):
    data, report, result = completed
    report["recommendations"][0]["hours"] = 88
    result["stages"]["process"]["median_hours"] = 62.3
    result["package"]["baseline"]["cases"] = 999
    audit = evaluate(data, report, result)
    assert check(audit, "process", "original_report")["status"] == "fail"
    assert check(audit, "process", "median_hours")["expected"] == 31.15
    assert check(audit, "process", "median_hours")["status"] == "fail"
    assert result["verified"] and audit["status"] == "fail"


def test_recalculated_trial_exposes_false_savings_and_dropped_approval(completed):
    data, report, result = completed
    receipt = next(iter(result["trials"]))
    trial = result["trials"][receipt]
    trial["net_savings"] += 200
    trial["approvals_retained"] -= 1
    audit = evaluate(data, report, result)
    replay = check(audit, "simulation", "trial_" + receipt)
    assert replay["status"] == "fail"
    assert replay["actual"]["net_savings"] - replay["expected"][
        "net_savings"
    ] == pytest.approx(200)
    assert audit["human_control"]["status"] == "fail"


def test_model_estimate_must_bind_the_simulated_receipt(completed):
    data, report, result = completed
    trial_id, trial = next(iter(result["trials"].items()))
    result["stages"]["simulation"]["estimates"] = [
        {
            "trial": trial_id,
            "approach": trial["approach"],
            "projected_median_hours": trial["projected_median"],
            "modelled_net_savings": trial["net_savings"] + 20,
        }
    ]
    audit = evaluate(data, report, result)
    assert check(audit, "simulation", "estimate_" + trial_id)["status"] == "fail"


def test_authority_fields_graph_boundary_and_gate_are_independently_audited(completed):
    data, report, result = completed
    result["stages"]["strategy"]["dispute_authority"] = "automatic"
    result["package"]["approaches"][0]["nodes"].append("Execute refund")
    result["stages"]["verification"]["verdict"] = "reject"
    audit = evaluate(data, report, result)
    assert check(audit, "strategy", "authority_roles")["status"] == "fail"
    assert check(audit, "architect", "human_review_node")["status"] == "fail"
    assert check(audit, "verification", "verdict_gate")["status"] == "fail"
    assert audit["human_control"]["status"] == "fail"


def test_independent_votes_veto_and_disagreement_do_not_trust_labels(completed):
    data, report, result = completed
    result["stages"]["architect"]["debate"] = {
        "assessments": [
            {"reviewer": "reliability", "preferred": "batch", "rejected": ["queue"]},
            {"reviewer": "operations", "preferred": "queue", "rejected": []},
        ],
        "eligible": ["queue", "batch"],
        "disagreement": False,
    }
    audit = evaluate(data, report, result)
    assert check(audit, "architect", "reviewer_disagreement")["status"] == "fail"
    assert check(audit, "architect", "vetoes")["status"] == "fail"
    assert check(audit, "verification", "verdict_gate")["status"] == "fail"
    assert any("reliability prefers batch" in line for line in audit["disagreements"])


def test_archived_run_explicitly_marks_missing_control_declarations(completed):
    data, report, result = completed
    del result["stages"]["strategy"]["refund_authority"]
    del result["stages"]["strategy"]["dispute_authority"]
    del result["evaluation"]
    audit = evaluate(data, report, result)
    assert stage(audit, "strategy")["human_control"]["status"] == "review"
    assert (
        audit["human_control"]["status"] == "review" and audit["support"]["failed"] == 0
    )
    assert "evaluation" not in result


def test_source_scope_excludes_valid_other_window_ids(completed):
    data, _report, result = completed
    report7 = analyse(data, 7)
    short = investigate_deterministic(data, report7, lambda *_: None)
    assert (
        short["evaluation"]["snapshot_sha256"]
        != result["evaluation"]["snapshot_sha256"]
    )
    excluded = next(
        e["id"] for e in data["events"] if e["case"] not in report7["case_ids"]
    )
    short["stages"]["discovery"]["evidence"].append(excluded)
    assert (
        check(evaluate(data, report7, short), "discovery", "citation_integrity")[
            "status"
        ]
        == "fail"
    )


def test_live_protocol_replay_is_audited_against_frozen_sources(monkeypatch):
    from test_provider_contract import ResponsesReplay, execute

    result = execute(monkeypatch, ResponsesReplay(), [])
    audit = result["evaluation"]
    assert (
        audit["support"]["failed"] == 0 and audit["human_control"]["status"] == "pass"
    )
    assert (
        len(audit["stages"]) == 6
        and audit["coverage"]["covered"] == audit["coverage"]["findings"]
    )
    assert any("Independent reviewers" in line for line in audit["disagreements"])
    assert check(audit, "architect", "vetoes")["status"] == "pass"
    assert (
        stage(audit, "discovery")["finding_audits"][0]["citation_status"] == "resolved"
    )


@pytest.mark.parametrize(
    "field",
    [
        "operating_cost",
        "elapsed_hours_saved",
        "staff_cost",
        "failure_attempts",
        "review_cases",
        "sensitivity",
    ],
)
def test_verified_trial_replays_operational_costs_workload_and_range(completed, field):
    data, report, result = completed
    rid, trial = next(iter(result["trials"].items()))
    if field == "sensitivity":
        trial[field]["low"] += 10
    else:
        trial[field] += 10
    assert (
        check(evaluate(data, report, result), "simulation", "trial_" + rid)["status"]
        == "fail"
    )
