"""Longitudinal metrics, cohort boundaries and traceability on a generic service process."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from monolith.continuous_engine import analyze_stream, observe_subject, observe_subjects


def log(case, hour, activity, system, department=None):
    dt = datetime(2025, 1, 1, tzinfo=UTC) + timedelta(hours=hour)
    return {
        "id": f"{case}-{hour}-{activity}",
        "case": case,
        "timestamp": dt.isoformat(),
        "activity": activity,
        "system": system,
        "source": "test-source",
        "row": hour + 2,
        **({"department": department} if department else {}),
    }


@pytest.fixture
def data():
    rows = []
    for i in range(6):
        case = f"base-{i}"
        rows.extend(
            [
                log(case, 20 + i, "Register", "Intake"),
                log(case, 22 + i, "Triage", "Desk"),
                log(case, 30 + i, "Resolve", "Desk", "Service owners"),
            ]
        )
    for i in range(6):
        case = f"latest-{i}"
        rows.extend(
            [
                log(case, 188 + i, "Register", "Intake"),
                log(case, 198 + i, "Triage", "Desk"),
                log(case, 199 + i, "Triage", "Desk"),
                log(case, 200 + i, "Escalate", "Support desk"),
                log(case, 201 + i, "Resolve", "Desk", "Service owners"),
            ]
        )
    return {"events": rows, "docs": [], "sources": [{"id": "test-source"}]}


def find(analysis, kind, subject):
    return next(
        s for s in analysis["signals"] if s["kind"] == kind and s["subject"] == subject
    )


def test_generic_evidence_coverage_confidence_and_source_labels(data):
    projection = analyze_stream(data)
    assert {s["kind"] for s in projection["signals"]} == {
        "latency",
        "drift",
        "duplicate",
        "variant",
        "handoff",
    }
    assert (
        projection["windows"]["previous"]["cases"]
        == projection["windows"]["recent"]["cases"]
        == 6
    )
    assert (
        projection["windows"]["previous"]["end"]
        == projection["windows"]["recent"]["start"]
    )
    assert len(projection["opportunities"]) == len(projection["signals"])
    rows = {r["id"]: r for r in data["events"]}
    for signal in projection["signals"]:
        assert (
            signal["windows"] == projection["windows"]
            and signal["as_of"] == projection["as_of"]
        )
        assert signal["support"] >= 3
        assert (
            signal["method"] and signal["caveat"] and signal["confidence"] == "moderate"
        )
        assert signal["evidence"] and set(signal["evidence"]) <= rows.keys()
        assert all(rows[i]["case"] in signal["case_ids"] for i in signal["evidence"])
    for opportunity in projection["opportunities"]:
        signal = next(
            s for s in projection["signals"] if s["id"] == opportunity["signal_id"]
        )
        assert opportunity["evidence"] == signal["evidence"]
        assert opportunity["human_control"] and opportunity["action"]
    latency = find(projection, "latency", ["Register", "Triage"])
    assert (
        latency["metric"]["previous"],
        latency["metric"]["recent"],
        latency["metric"]["delta"],
    ) == (2, 10, 8)
    for key in ("previous", "recent"):
        assert len(latency["case_ids_by_window"][key]) == 3
        ids = latency["evidence_by_window"][key]
        assert {rows[i]["activity"] for i in ids} == {"Register", "Triage"}
    for kind, subject in (
        ("duplicate", ["Triage"]),
        ("drift", ["Escalate"]),
        ("handoff", ["Desk", "Support desk"]),
    ):
        metric = find(projection, kind, subject)["metric"]
        assert metric["previous"] == 0 and metric["recent"] == 100
    assert (
        find(
            projection,
            "variant",
            ["Register", "Triage", "Triage", "Escalate", "Resolve"],
        )["support"]
        == 6
    )


def test_graph_temporal_weights_and_department_provenance(data):
    p = analyze_stream(data)
    graph = p["graph"]
    nodes = {n["id"]: n for n in graph["nodes"]}
    edges = {e["id"]: e for e in graph["edges"]}
    recent = graph["epochs"][-1]
    assert recent["start"] == p["windows"]["recent"]["start"]
    for e in edges.values():
        assert e["source"] in nodes and e["target"] in nodes
        assert e["count"] == sum(
            epoch["edge_counts"].get(e["id"], 0) for epoch in graph["epochs"]
        )
    for n in nodes.values():
        assert n["events"] == sum(
            epoch["node_counts"].get(n["id"], 0) for epoch in graph["epochs"]
        )
    for epoch in graph["epochs"]:
        for ident in epoch["edge_ids"]:
            assert epoch["edge_evidence"][ident]
            assert {edges[ident]["source"], edges[ident]["target"]} <= set(
                epoch["node_ids"]
            )
    dep = {n["label"]: n for n in nodes.values() if n["kind"] == "department"}
    assert set(dep) == {"Support", "Service owners"}
    assert (
        dep["Service owners"]["origin"] == "observed"
        and dep["Support"]["origin"] == "inferred"
    )
    edge = next(
        e
        for e in edges.values()
        if e["kind"] == "precedes" and nodes[e["source"]]["label"] == "Register"
    )
    assert recent["edge_median_hours"][edge["id"]] == 10
    earlier = graph["epochs"][-2]
    assert earlier["edge_median_hours"][edge["id"]] == 2
    assert not any("Escalate" == nodes[n]["label"] for n in earlier["node_ids"])


def test_recovery_remeasures_stable_subjects_without_alerting(data):
    backlog = analyze_stream(data)
    measured = find(backlog, "latency", ["Register", "Triage"])
    repeated = find(backlog, "duplicate", ["Triage"])
    for i in range(6):
        data["events"].extend(
            [
                log(f"restored-{i}", 356 + i, "Register", "Intake"),
                log(f"restored-{i}", 357 + i, "Triage", "Desk"),
                log(f"restored-{i}", 364 + i, "Resolve", "Desk"),
            ]
        )
    after = analyze_stream(data)
    assert measured["id"] not in {s["id"] for s in after["signals"]}
    samples = observe_subjects(data, [measured, {"signal": repeated}])
    latency = samples[measured["id"]]
    assert (
        not latency["active"]
        and latency["metric"]["delta"] == -9
        and latency["support_by_window"] == {"previous": 6, "recent": 6}
    )
    assert (
        latency["windows"]["previous"]["start"] == backlog["windows"]["recent"]["start"]
    )
    assert samples[repeated["id"]]["metric"]["recent"] == 0
    assert (
        observe_subject(data, {"kind": "latency", "subject": ["impossible", "pair"]})
        is None
    )


def test_gaps_empty_and_insufficient_support():
    empty = analyze_stream({"events": []})
    assert (
        empty["as_of"] is None
        and empty["graph"]["epochs"] == []
        and empty["signals"] == []
    )
    assert empty["windows"]["recent"]["start"] is None
    rows = [
        log("o", 0, "Started", "A"),
        log("o", 1, "Checked", "B"),
        log("r", 1000, "Started", "A"),
        log("r", 1060, "Checked", "B"),
    ]
    partial = analyze_stream({"events": rows})
    assert partial["signals"] == [] and partial["windows"]["previous"]["cases"] == 0
    assert any(e["cases"] == 0 for e in partial["graph"]["epochs"])
    assert (
        next(m for m in partial["metrics"] if m["id"] == "cycle_hours")["previous"]
        is None
    )


def test_timezone_offsets_ties_and_cross_window_dependency():
    rows = [
        log("x", 0, "Submitted", "First"),
        log("x", 167, "Prepared", "Middle"),
        log("x", 169, "Received", "Last"),
        log("y", 169, "One", "X"),
        log("y", 169, "Two", "Y"),
        log("y", 171, "Three", "Z"),
        log("clock", 13 * 24, "Clock", "Time"),
    ]
    rows[2]["timestamp"] = "2025-01-08T06:30:00+05:30"
    p = analyze_stream({"events": rows})
    e = p["graph"]["epochs"][-1]
    first = rows[1]["id"]
    second = rows[2]["id"]
    cross = [
        e["edge_evidence"][edge["id"]]
        for edge in p["graph"]["edges"]
        if edge["kind"] == "handoff" and edge["id"] in e["edge_ids"]
    ]
    assert [first, second] in cross
    assert not any(rows[3]["id"] in item or rows[4]["id"] in item for item in cross)
    assert any("simultaneous" in c for c in p["caveats"])


def test_reordering_idempotence_decision_provenance_and_conflicting_identity(data):
    initial = analyze_stream(data)
    tracked = initial["signals"][0]
    extra = [
        dict(data["events"][0]),
        dict(log("invalid", 15, "bad", "X"), timestamp="missing-zone"),
    ]
    reordered = {**data, "events": list(reversed(data["events"])) + extra}
    reanalyzed = analyze_stream(
        reordered, [{"id": "decision-1", "signal_id": tracked["id"]}]
    )
    assert (
        reanalyzed["metrics"] == initial["metrics"]
        and reanalyzed["graph"] == initial["graph"]
    )
    assert reanalyzed["signals"] == initial["signals"]
    linked = next(
        o for o in reanalyzed["opportunities"] if o["signal_id"] == tracked["id"]
    )
    assert linked["prior_decision_ids"] == ["decision-1"]
    assert any("1 unusable" in c for c in reanalyzed["caveats"])
    colliding = deepcopy(data["events"][0])
    colliding["activity"] = "Changed"
    conflict = analyze_stream({**data, "events": data["events"] + [colliding]})
    assert (
        conflict["windows"]["previous"]["events"]
        == initial["windows"]["previous"]["events"] - 1
    )
    assert any("1 conflicting" in c for c in conflict["caveats"])
    json.dumps(conflict, allow_nan=False)


def test_case_weighting_avoids_one_repeating_case_moving_the_median():
    rows = []
    for i in range(6):
        for week, gap in ((0, 2), (168, 8)):
            case = f"{week}-{i}"
            rows.extend(
                [log(case, week, "File", "A"), log(case, week + gap, "Finish", "B")]
            )
    for i in range(1, 20):
        rows.extend(
            [
                log("168-0", 168 + 8 + i, "File", "A"),
                log("168-0", 168 + 8 + i + 0.1, "Finish", "B"),
            ]
        )
    subject = find(analyze_stream({"events": rows}), "latency", ["File", "Finish"])
    assert subject["metric"]["recent"] == 8 and subject["support"] == 6


def test_dependency_from_before_retained_graph_is_grounded_without_counting_old_event():
    old = log("spanning", 0, "Entered", "Legacy")
    recent = log("spanning", 100 * 24, "Migrated", "New system")
    graph = analyze_stream({"events": [old, recent]})["graph"]
    assert len(graph["epochs"]) == 8
    assert sum(epoch["events"] for epoch in graph["epochs"]) == 1
    link = next(e for e in graph["edges"] if e["kind"] == "handoff")
    sender = next(n for n in graph["nodes"] if n["id"] == link["source"])
    assert sender["events"] == 0 and sender["evidence"] == [old["id"]]
    assert sender["id"] in graph["epochs"][-1]["node_ids"]
    assert graph["epochs"][-1]["edge_evidence"][link["id"]] == [old["id"], recent["id"]]


def test_ranked_visible_signals_report_all_qualifying_subjects():
    rows = [log(f"past-{i}", i, "File", "A") for i in range(4)]
    for i in range(4):
        rows.extend(log(f"recent-{i}", 8 * 24 + j, f"Step {j}", "A") for j in range(20))
    result = analyze_stream({"events": rows})
    assert result["signal_coverage"]["drift"] == {"qualifying": 21, "shown": 12}
    assert len([s for s in result["signals"] if s["kind"] == "drift"]) == 12
    assert any("ranked by" in note for note in result["caveats"])
