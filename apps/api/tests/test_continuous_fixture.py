"""Fixture integrity, deterministic replay and cross-week ground truth."""

import csv
import io
from datetime import datetime
from pathlib import Path
from statistics import median
from monolith.continuous_fixture import WAVES, fixture_csv
from monolith.core import group_cases, merge, parse_csv
from monolith.seed import make_seed


def test_public_waves_are_exact_ordered_synthetic_exports_with_distinct_ids():
    seed = make_seed()
    latest = max(e["timestamp"] for e in seed["events"])
    used = {e["id"] for e in seed["events"]}
    used_cases = {e["case"] for e in seed["events"]}
    for wave, (_, filename) in WAVES.items():
        raw = fixture_csv(wave)
        artifact = Path(__file__).resolve().parents[2] / "web" / "public" / filename
        assert artifact.read_bytes() == raw.encode()
        assert {r["data_origin"] for r in csv.DictReader(io.StringIO(raw))} == {
            "Synthetic Northstar Commerce training data"
        }
        source, rows = parse_csv(raw, filename, synthetic=True)
        assert source["synthetic"] and all(e["synthetic"] for e in rows)
        assert min(e["timestamp"] for e in rows) > latest
        latest = max(e["timestamp"] for e in rows)
        ids, cases = {e["id"] for e in rows}, {e["case"] for e in rows}
        assert len(cases) == 72 and not used_cases & cases
        assert len(ids) == len(rows) and not used & ids
        used.update(ids)
        used_cases.update(cases)
        assert {e["id"] for e in merge(seed, source, rows)["events"]} == used
        assert {e["id"] for e in merge(seed, source, rows)["events"]} == used


def test_observed_changes_have_real_evidence_and_disputes_retain_human_review():
    def measures(wave):
        raw = fixture_csv(wave)
        _, events = parse_csv(raw, WAVES[wave][1], synthetic=True)
        cases = group_cases(events)
        waits = []
        repeats = 0
        desk = 0
        reviews = 0
        for rows in cases.values():
            activities = [e["activity"] for e in rows]
            repeats += activities.count("Invoice rekeyed") > 1
            desk += "Billing exception queued" in activities
            if "Dispute opened" in activities:
                assert activities.index("Dispute reviewed") < activities.index(
                    "Case closed"
                )
                assert "Refund authorised" not in activities
                reviews += 1
            for prev, cur in zip(rows, rows[1:]):
                if (prev["activity"], cur["activity"]) == (
                    "Invoice rekeyed",
                    "Refund authorised",
                ):
                    waits.append(
                        (
                            datetime.fromisoformat(cur["timestamp"])
                            - datetime.fromisoformat(prev["timestamp"])
                        ).total_seconds()
                        / 3600
                    )
        return len(waits), median(waits), repeats, desk, reviews

    slow, recovery = measures("backlog"), measures("recovery")
    assert slow[0] == recovery[0] == 42
    assert slow[1] > 65 and 23 < recovery[1] < 31
    assert slow[2] > 25 and recovery[2] == 1
    assert slow[3] > 25 and recovery[3] == 2
    assert slow[4] == recovery[4] == 16


def test_only_byte_exact_public_fixture_uploads_inherit_synthetic_provenance():
    for wave, (_, name) in WAVES.items():
        raw = fixture_csv(wave)
        source, rows = parse_csv(raw, "renamed-" + name)
        assert source["synthetic"] and all(e["synthetic"] for e in rows)
        edited, other = parse_csv(
            raw.replace("Order confirmed", "Order confirmed manually", 1), name
        )
        assert not edited["synthetic"] and not any(e["synthetic"] for e in other)
