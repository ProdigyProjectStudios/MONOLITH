from datetime import datetime, timedelta, timezone

import pytest

from monolith.core import analyse
from monolith.flagship import build_package, simulate_scenario
from monolith.seed import make_seed


@pytest.fixture(scope="module")
def seed_report():
    data = make_seed()
    return data, analyse(data, 30)


def test_source_baseline_and_provenance(seed_report):
    data, report = seed_report
    result = build_package(data, report)
    baseline = result["baseline"]
    assert (
        baseline["cases"],
        baseline["intervals"],
        baseline["median"],
        baseline["disputes"],
    ) == (132, 132, 31.15, 66)
    assert baseline["p25"] < baseline["median"] < baseline["p75"]
    assert baseline["policy_evidence"] and baseline["dispute_evidence"]
    valid = {r["id"] for r in data["events"] + data["docs"]}
    assert set(result["evidence"]) <= valid
    for design in result["approaches"]:
        assert set(design["evidence"]) <= valid
        assert "Finance" in design["nodes"][-1]
        assert len(design["artifacts"]) >= 8
        assert any("PRIMARY KEY (tenant" in a["body"] for a in design["artifacts"])
    narrowed = build_package(data, analyse(data, 7))
    assert 0 < narrowed["baseline"]["cases"] < baseline["cases"]


def fixture_case(case, steps):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        dict(
            case=case,
            id=f"{case}-{i}",
            activity=activity,
            system=system,
            timestamp=(start + timedelta(hours=h)).isoformat(),
            source="S",
            row=i + 2,
            synthetic=True,
        )
        for i, (activity, system, h) in enumerate(steps)
    ]


def test_measured_and_hypothetical_units_and_hold():
    start = ("Invoice rekeyed", "Billing desk", 0)
    end = ("Refund authorised", "Authoriser", 10)
    rows = fixture_case("A", [start, end]) + fixture_case(
        "B", [("Dispute opened", "Support", -1), start, end]
    )
    data = {"events": rows, "docs": [], "sources": []}
    report = analyse(data, 30)
    package = build_package(data, report)
    assert package["baseline"]["cases"] == 2
    assert package["baseline"]["eligible"] == 1
    assert package["baseline"]["source_systems"] == ["Billing desk"]
    assert package["baseline"]["authority_systems"] == ["Authoriser"]
    params = {
        "coverage": 1,
        "reduction": 1,
        "failure": 0,
        "manual_minutes": 60,
        "review_minutes": 60,
        "assist_minutes": 0,
        "hourly_rate": 10,
        "fixed_cost": 2,
        "unit_cost": 1,
    }
    scenario = simulate_scenario(data, report, params)
    assert scenario["projected_median"] == 5.5
    assert scenario["elapsed_hours_saved"] == 9 and scenario["review_cases"] == 2
    assert scenario["baseline_staff_hours"] == 4 and scenario["staff_hours"] == 3
    assert scenario["net_savings"] == 7
    assert (
        scenario["sensitivity"]["low"]
        <= scenario["projected_median"]
        <= scenario["sensitivity"]["high"]
    )
    batch = simulate_scenario(
        data, report, {**params, "approach": "batch", "cadence_hours": 4}
    )
    assert batch["projected_median"] == 6.5
    failed = simulate_scenario(
        data,
        report,
        {**params, "failure": 1, "failure_delay": 3, "exception_minutes": 30},
    )
    assert failed["elapsed_hours_saved"] == -3 and failed["staff_hours"] == 4.5
    assert failed["net_savings"] == -8 and failed["failure_cases"] == 1
    idle = simulate_scenario(data, report, {**params, "coverage": 0})
    assert idle["projected_median"] == scenario["baseline_median"]
    assert idle["net_savings"] == -2


def test_empty_no_design_and_repeated_cases():
    data = {"events": [], "docs": [], "sources": []}
    empty = build_package(data, analyse(data))
    assert empty["approaches"] == [] and empty["baseline"]["median"] is None
    rows = fixture_case(
        "A",
        [
            ("Invoice rekeyed", "Billing", 0),
            ("Refund authorised", "Fin", 1),
            ("Invoice rekeyed", "Billing", 3),
            ("Refund authorised", "Fin", 6),
        ],
    )
    data["events"] = rows
    out = simulate_scenario(data, analyse(data), {"coverage": 1, "failure": 0.5})
    assert out["approvals_retained"] == 2 and out["review_cases"] == 1
    assert out["failure_cases"] == 0.75 and out["failure_attempts"] == 1


@pytest.mark.parametrize(
    "inputs",
    [
        {"coverage": 1.2},
        {"failure": -1},
        {"hourly_rate": float("nan")},
        {"fixed_cost": True},
        {"reduction": "0.5"},
        {"approach": "unapproved"},
        {"cadence_hours": 2},
        {"approval_override": True},
    ],
)
def test_invalid_input(seed_report, inputs):
    with pytest.raises(ValueError):
        simulate_scenario(*seed_report, inputs)


def test_disputed_refund_has_no_automation_design():
    data = {
        "events": fixture_case(
            "H",
            [
                ("Dispute opened", "Support", 0),
                ("Invoice rekeyed", "Billing", 2),
                ("Refund authorised", "Authoriser", 4),
            ],
        ),
        "docs": [],
        "sources": [],
    }
    package = build_package(data, analyse(data))
    assert package["baseline"]["median"] == 2
    assert package["baseline"]["eligible"] == 0
    assert package["approaches"] == [] and package["scenarios"] == []
