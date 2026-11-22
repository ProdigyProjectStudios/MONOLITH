from monolith.core import analyse
from monolith.flagship import build_package, compare_reference_scenarios
from monolith.seed import make_seed


def test_objectives_use_distinct_observed_window_cost_and_duration():
    data = make_seed()
    package = build_package(data, analyse(data))
    result = compare_reference_scenarios(package)
    assert result["evidence"] == package["baseline"]["evidence"]
    criteria = {c["id"]: c for c in result["criteria"]}
    assert criteria["elapsed"]["preferred"] == ["queue"]
    for scenario in package["scenarios"]:
        assert criteria["expense"]["values"][scenario["approach"]] == round(
            scenario["staff_cost"] + scenario["operating_cost"], 2
        )
    assert criteria["failures"]["preferred"] == ["batch"]
    assert not result["common_preference"]


def test_equal_scenarios_retain_ties_and_one_design_has_no_comparison():
    data = make_seed()
    package = build_package(data, analyse(data))
    queue = package["scenarios"][0]
    package["scenarios"] = [queue, {**queue, "approach": "batch"}]
    assert compare_reference_scenarios(package)["common_preference"] == [
        "batch",
        "queue",
    ]
    package["scenarios"] = [queue]
    assert compare_reference_scenarios(package) is None
