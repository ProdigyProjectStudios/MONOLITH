"""Independent, read-only assessment of an investigation against its frozen event window.

Only checks with reproducible expectations contribute to a score. Free-text inferences,
model confidence and staff or financial assumptions remain available for human review.
This module has no provider, database, investigator or process-mining dependencies.
"""

import json
from collections import Counter, defaultdict
from datetime import datetime
from hashlib import sha256
from itertools import pairwise
from math import isfinite
from statistics import median

EVALUATION_VERSION = 2
STAGES = ("discovery", "process", "strategy", "architect", "simulation", "verification")
KINDS = {"observed", "hypothesis", "assumption", "recommendation", "limitation"}
DESIGNS = {"queue", "batch"}


def _canonical(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def _witness(ids):
    return list(dict.fromkeys(ids))[:8]


def _refs(value):
    if isinstance(value, dict):
        for key, body in value.items():
            if key == "evidence":
                if not isinstance(body, list) or not all(
                    isinstance(i, str) and i for i in body
                ):
                    yield "<invalid citation field>"
                else:
                    yield from body
            elif key != "model_calls":
                yield from _refs(body)
    elif isinstance(value, list):
        for body in value:
            yield from _refs(body)


def _numeric(value):
    return type(value) in {int, float} and isfinite(value)


def _same(expected, actual):
    if type(expected) is bool:
        return type(actual) is bool and expected == actual
    if _numeric(expected):
        return _numeric(actual) and abs(expected - actual) < 0.0051
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and expected.keys() == actual.keys()
            and all(_same(v, actual[k]) for k, v in expected.items())
        )
    return expected == actual


class Snapshot:
    def __init__(self, data, report):
        scoped = set(report.get("case_ids", []))
        events = [r for r in data.get("events", []) if r.get("case") in scoped]
        docs = data.get("docs", [])
        sources = data.get("sources", [])
        # Order of connector delivery and measured execution timings are irrelevant.
        frozen = {
            "scope": {
                "case_ids": sorted(scoped),
                "asof": report.get("asof"),
                "days": report.get("days"),
            }
        }
        for key, rows in (("events", events), ("docs", docs), ("sources", sources)):
            frozen[key] = sorted(
                rows, key=lambda row: (row.get("id", ""), _canonical(row))
            )
        self.digest = sha256(_canonical(frozen).encode()).hexdigest()
        source_ids = Counter(r.get("id") for r in sources)
        identities = Counter(r.get("id") for r in [*events, *docs])
        self.valid = set()
        self.invalid_timestamps = []
        by_case = defaultdict(list)
        self.policy_ids = set()
        for row in [*events, *docs]:
            ident = row.get("id")
            if (
                not ident
                or identities[ident] != 1
                or source_ids[row.get("source")] != 1
            ):
                continue
            is_doc = "page" in row
            location = row.get("page") if is_doc else row.get("row")
            if is_doc:
                if (
                    type(location) is not int
                    or location < 1
                    or not row.get("text", "").strip()
                ):
                    continue
                text = row["text"].casefold()
                if any(term in text for term in ("refund", "dispute")) and any(
                    term in text for term in ("operator", "human", "reviewer")
                ):
                    self.policy_ids.add(ident)
            elif not (
                (type(location) is int and location > 0)
                or (isinstance(location, str) and location.strip())
            ):
                continue
            self.valid.add(ident)
        for row in events:
            try:
                t = datetime.fromisoformat(row["timestamp"])
                if t.utcoffset() is None:
                    raise ValueError("timezone missing")
                by_case[row["case"]].append((t, row))
            except (ValueError, KeyError, TypeError, AttributeError):
                self.invalid_timestamps.append(row.get("id", "<unknown event>"))
                self.valid.discard(row.get("id"))
        self.refund_cases = set()
        self.systems = set()
        self.authorisers = set()
        self.disputes = set()
        self.dispute_evidence = []
        self.eligible_cases = set()
        self.attempts_by_case = Counter()
        self.intervals = []
        for case, records in by_case.items():
            records.sort(key=lambda pair: (pair[0], pair[1]["id"]))
            activities = [row["activity"].casefold() for _, row in records]
            eligible = not any("dispute" in a for a in activities)
            if "dispute reviewed" in activities:
                self.disputes.add(case)
                self.dispute_evidence.append(
                    records[activities.index("dispute reviewed")][1]["id"]
                )
            for (ts, left), (end, right) in pairwise(records):
                if (left["activity"].casefold(), right["activity"].casefold()) != (
                    "invoice rekeyed",
                    "refund authorised",
                ):
                    continue
                self.intervals.append(
                    (
                        (end - ts).total_seconds() / 3600,
                        eligible,
                        left["id"],
                        right["id"],
                    )
                )
                self.refund_cases.add(case)
                self.authorisers.add(right["system"])
                self.systems.update(row["system"] for _, row in records)
                if eligible:
                    self.eligible_cases.add(case)
                    self.attempts_by_case[case] += 1
        self.median = (
            round(median(item[0] for item in self.intervals), 2)
            if self.intervals
            else None
        )
        self.evidence = _witness(
            i for _, _, a, b in self.intervals for i in (a, b) if i in self.valid
        )
        self.controls = _witness(i for i in self.dispute_evidence if i in self.valid)


def _coverage(claims, valid):
    all_ids = set()
    covered = 0
    for claim in claims:
        ids = set(_refs(claim))
        all_ids.update(ids)
        covered += bool(ids and ids <= valid)
    return {
        "findings": len(claims),
        "covered": covered,
        "percent": round(100 * covered / len(claims)) if claims else None,
        "unique_evidence": len(all_ids),
    }


def _support(checks):
    counts = Counter(c["status"] for c in checks)
    passed, failed = counts["pass"], counts["fail"]
    return {"passed": passed, "failed": failed, "review": counts["review"]}, round(
        100 * passed / (passed + failed)
    ) if passed + failed else None


def _status(statuses):
    return (
        "fail" if "fail" in statuses else ("review" if "review" in statuses else "pass")
    )


class Stage:
    def __init__(self, ident, body, snapshot):
        self.id, self.body, self.snapshot = ident, body, snapshot
        self.checks = []
        self.weaknesses = []
        self.disagreements = []
        self.human = {
            "status": "not_applicable",
            "detail": "This stage makes no approval decision.",
            "evidence": [],
        }
        self.findings = body.get("findings", [])
        self.finding_audits = []
        for index, claim in enumerate(self.findings):
            cited = set(_refs(claim))
            missing = sorted(cited - snapshot.valid)
            self.finding_audits.append(
                {
                    "index": index,
                    "kind": claim.get("kind"),
                    "text": claim.get("text", ""),
                    "citation_status": ("unresolved" if missing else "resolved")
                    if cited
                    else "missing",
                    "evidence": sorted(cited & snapshot.valid),
                    "unresolved": missing,
                    "interpretation": "The stage's measurement checks test the recorded values against source data."
                    if claim.get("kind") == "observed"
                    else "The cited records identify the source of this interpretation.",
                }
            )
        self.coverage = _coverage(self.findings, snapshot.valid)
        ids = set(_refs(body))
        wrong = sorted(ids - snapshot.valid)
        witnesses = _witness(sorted(ids & snapshot.valid))
        self.add(
            "citation_integrity",
            "Source rows and pages resolve inside the saved window.",
            bool(body and body.get("evidence") and not wrong),
            {"unresolved": 0},
            {"unresolved": len(wrong), "first_missing": wrong[:8]},
            witnesses,
        )
        self.add(
            "finding_coverage",
            "Each finding cites traceable source records.",
            bool(self.findings and self.coverage["covered"] == len(self.findings)),
            len(self.findings),
            self.coverage["covered"],
            witnesses,
        )
        kinds = {f.get("kind", "<unlabelled>") for f in self.findings}
        self.add(
            "claim_labels",
            "Each finding declares its evidence category.",
            bool(kinds) and kinds <= KINDS,
            sorted(KINDS),
            sorted(kinds),
            witnesses,
        )

    def add(self, key, label, ok, expected, actual, evidence=()):
        status = "review" if ok is None else ("pass" if ok else "fail")
        self.checks.append(
            {
                "id": key,
                "label": label,
                "status": status,
                "expected": expected,
                "actual": actual,
                "evidence": _witness(i for i in evidence if i in self.snapshot.valid),
            }
        )
        if ok is False:
            self.weaknesses.append(label + " Check the expected and recorded values.")
        elif ok is None:
            self.weaknesses.append(label)

    def compare(self, key, label, expected, actual, evidence=()):
        self.add(key, label, _same(expected, actual), expected, actual, evidence)

    def control(self, status, detail, evidence):
        self.human = {
            "status": status,
            "detail": detail,
            "evidence": _witness(i for i in evidence if i in self.snapshot.valid),
        }

    def finish(self):
        support, score = _support(self.checks)
        return {
            "id": self.id,
            "status": _status(
                [c["status"] for c in self.checks] + [self.human["status"]]
            ),
            "score": score,
            "support": support,
            "coverage": self.coverage,
            "finding_audits": self.finding_audits,
            "checks": self.checks,
            "weaknesses": self.weaknesses,
            "disagreements": self.disagreements,
            "human_control": self.human,
        }


def _expected_trial(snapshot, p):
    """Replay expected elapsed median and direct operating contribution from recorded assumptions."""
    required = (
        "coverage",
        "failure",
        "reduction",
        "failure_delay",
        "cadence_hours",
        "review_minutes",
        "manual_minutes",
        "assist_minutes",
        "exception_minutes",
        "hourly_rate",
        "fixed_cost",
        "unit_cost",
    )
    if not isinstance(p, dict) or any(
        not _numeric(p.get(k)) or p[k] < 0 for k in required
    ):
        return None
    if any(p[k] > 1 for k in ("coverage", "failure", "reduction")):
        return None
    success = p["coverage"] * (1 - p["failure"])
    failure = p["coverage"] * p["failure"]
    half_window = p["cadence_hours"] / 2
    eligible = sum(item[1] for item in snapshot.intervals)

    def project(reduction):
        return [
            hours
            + (
                success
                * (half_window - max(0, hours - p["review_minutes"] / 60) * reduction)
                + failure * (half_window + p["failure_delay"])
            )
            if can_route
            else hours
            for hours, can_route, _, _ in snapshot.intervals
        ]

    durations = project(p["reduction"])
    bounds = (
        [median(project(min(1, p["reduction"] * scale))) for scale in (0.8, 1.2)]
        if durations
        else []
    )
    saved_hours = (
        eligible
        * (
            success * (p["manual_minutes"] - p["assist_minutes"])
            - failure * p["exception_minutes"]
        )
        / 60
    )
    running_cost = (
        p["fixed_cost"] + eligible * p["coverage"] * p["unit_cost"] if durations else 0
    )
    baseline_staff = len(durations) * (p["manual_minutes"] + p["review_minutes"]) / 60
    staff = baseline_staff - saved_hours
    return {
        "approach": p.get("approach"),
        "baseline_median": snapshot.median,
        "projected_median": round(median(durations), 2) if durations else None,
        "elapsed_hours_saved": round(
            sum(item[0] for item in snapshot.intervals) - sum(durations), 2
        ),
        "baseline_staff_hours": round(baseline_staff, 2),
        "staff_hours": round(staff, 2),
        "baseline_staff_cost": round(baseline_staff * p["hourly_rate"], 2),
        "staff_cost": round(staff * p["hourly_rate"], 2),
        "operating_cost": round(running_cost, 2),
        "failure_attempts": round(eligible * failure, 2),
        "eligible_cases": len(snapshot.eligible_cases),
        "review_cases": len(snapshot.refund_cases),
        "currency": "GBP",
        "sensitivity": {
            "low": round(min(bounds), 2) if bounds else None,
            "high": round(max(bounds), 2) if bounds else None,
        },
        "net_savings": round(saved_hours * p["hourly_rate"] - running_cost, 2),
        "attempts": round(eligible * p["coverage"], 2),
        "failure_cases": round(
            sum(1 - (1 - failure) ** n for n in snapshot.attempts_by_case.values()), 2
        ),
        "approvals_retained": len(durations),
    }


def _discovery(discovery, source, package, baseline):
    ev = source.evidence
    discovery.compare(
        "refund_cohort",
        "Refund cases reconcile with adjacent invoice and authorisation events.",
        len(source.refund_cases),
        discovery.body.get("matched_cases", baseline.get("cases")),
        ev,
    )
    reported_systems = discovery.body.get(
        "observed_systems", package.get("systems", [])
    )
    discovery.add(
        "systems",
        "Named systems occur on the measured refund case paths.",
        bool(reported_systems) and set(reported_systems) <= source.systems,
        sorted(source.systems),
        sorted(reported_systems),
        ev,
    )


def _process(process, source, baseline, report):
    ev = source.evidence
    process.add(
        "timestamps",
        "The evaluation window contains valid timezone-aware event timestamps.",
        not source.invalid_timestamps,
        "All event timestamps parse",
        {"invalid": len(source.invalid_timestamps)},
        ev,
    )
    process.compare(
        "interval_count",
        "Adjacent interval count matches the package baseline.",
        len(source.intervals),
        baseline.get("intervals"),
        ev,
    )
    process.compare(
        "median_hours",
        "Process-stage median is reproducible from source timestamps.",
        source.median,
        process.body.get("median_hours"),
        ev,
    )
    process.compare(
        "case_count",
        "Process-stage matched case count is reproducible.",
        len(source.refund_cases),
        process.body.get("matched_cases"),
        ev,
    )
    process.compare(
        "baseline_median",
        "Blueprint baseline median agrees with the source log.",
        source.median,
        baseline.get("median"),
        ev,
    )
    recommendation = next(
        (r for r in report.get("recommendations", []) if r.get("id") == "refund"), {}
    )
    process.compare(
        "original_report",
        "The original reported median and case count reconcile with source events.",
        {"hours": source.median, "cases": len(source.refund_cases)},
        {k: recommendation.get(k) for k in ("hours", "cases")},
        ev,
    )
    # A valid record ID alone cannot support an elapsed-time claim. Require linked
    # beginning and ending event witnesses on each observed process finding.
    event_pairs = [
        (a, b)
        for _, _, a, b in source.intervals
        if a in source.valid and b in source.valid
    ]
    observations = [f for f in process.findings if f.get("kind") == "observed"]
    witnessed = 0
    for f in observations:
        refs = set(_refs(f))
        witnessed += any(a in refs and b in refs for a, b in event_pairs)
    process.add(
        "matched_witnesses",
        "Observed interval findings cite both endpoints in a matching case.",
        bool(observations and witnessed == len(observations)),
        len(observations),
        witnessed,
        ev,
    )
    if any(f.get("kind") == "hypothesis" for f in process.findings):
        process.add(
            "causality",
            "The proposed cause still requires an independent observation.",
            None,
            "Evidence of the bottleneck mechanism",
            "Timestamp association",
            ev,
        )


def _strategy(strategy, source, baseline):
    strategy.compare(
        "dispute_count",
        "Observed dispute reviews agree with the retained control cohort.",
        len(source.disputes),
        baseline.get("disputes"),
        source.controls,
    )
    expected_roles = {
        "refund_authority": "finance_operator",
        "dispute_authority": "human_reviewer",
    }
    roles = {k: strategy.body.get(k) for k in expected_roles}
    declared = all(roles.values())
    strategy.add(
        "authority_roles",
        "Explicit refund and dispute decision owners are retained.",
        roles == expected_roles if declared else None,
        expected_roles,
        roles,
        source.controls,
    )
    strategy.control(
        ("pass" if roles == expected_roles else "fail") if declared else "review",
        "Finance authorises refunds and a human adjudicates disputes."
        if roles == expected_roles
        else "Review the decision-owner declarations in the saved strategy.",
        source.controls,
    )
    if not set(baseline.get("policy_evidence", [])) & source.policy_ids:
        strategy.weaknesses.append(
            "No cited policy page corroborates the operating decision rights for this snapshot."
        )


def _architect(architect, source, package):
    ev = source.evidence
    plans = {a.get("id"): a for a in package.get("approaches", [])}
    expected_plans = DESIGNS if source.eligible_cases else set()
    alternatives = {
        a.get("approach") if isinstance(a, dict) else a
        for a in architect.body.get("alternatives", [])
    }
    architect.compare(
        "alternate_designs",
        "Proposed options reflect the eligible routing scope.",
        sorted(expected_plans),
        sorted(alternatives),
        ev,
    )
    architect.compare(
        "blueprint_candidates",
        "Engineering packages match the proposed options.",
        sorted(expected_plans),
        sorted(plans),
        ev,
    )
    expected_end = ", ".join(sorted(source.authorisers)) + " human review"
    protected_plans = sorted(
        k for k, p in plans.items() if p.get("nodes") and p["nodes"][-1] == expected_end
    )
    protected = protected_plans == sorted(plans)
    architect.compare(
        "human_review_node",
        "Each proposed path ends with the source authoriser's human review.",
        sorted(plans),
        protected_plans,
        ev,
    )
    architect.control(
        "pass" if protected else "fail",
        "Every proposed path includes human review."
        if plans and protected
        else (
            "No pilot architecture is proposed."
            if not plans
            else "A proposed path omits the human review boundary."
        ),
        ev,
    )
    if plans:
        architect.weaknesses.append(
            "Proposed API contracts and integration access require validation with the source-system owners."
        )

    debate = architect.body.get("debate")
    blocked = set()
    if debate:
        reviewers = debate.get("assessments", [])
        votes = {r.get("reviewer"): r.get("preferred") for r in reviewers}
        rejected = {
            r.get("reviewer"): tuple(sorted(r.get("rejected", []))) for r in reviewers
        }
        differs = len(set(votes.values())) > 1 or len(set(rejected.values())) > 1
        blocked.update(k for values in rejected.values() for k in values)
        architect.compare(
            "reviewer_scope",
            "Two different review roles assessed the alternatives.",
            ["operations", "reliability"],
            sorted(votes),
            ev,
        )
        architect.compare(
            "reviewer_disagreement",
            "Recorded disagreement agrees with the two persisted assessments.",
            differs,
            debate.get("disagreement"),
            ev,
        )
        architect.compare(
            "vetoes",
            "Eligible options exclude all explicit reviewer vetoes.",
            sorted(DESIGNS - blocked),
            sorted(debate.get("eligible", [])),
            ev,
        )
        if differs:
            architect.disagreements.append(
                "Independent reviewers differ in preference or veto. "
                + ". ".join(
                    f"{k} prefers {votes[k]} and withholds {', '.join(rejected[k]) or 'none'}"
                    for k in sorted(votes)
                )
                + "."
            )
    else:
        architect.weaknesses.append(
            "This run contains no independent architecture reviewer assessments."
        )
    return plans, blocked


def _simulation(simulation, source, baseline, result, debate):
    ev = source.evidence
    trials = result.get("trials") or {}
    trial_designs = {r.get("approach") for r in trials.values()}
    simulation.compare(
        "scenario_coverage",
        "Both candidate designs received a scenario trial.",
        sorted(DESIGNS),
        sorted(trial_designs),
        ev,
    )
    retained = bool(trials)
    for key, row in sorted(trials.items()):
        params = row.get("assumptions")
        expected = _expected_trial(source, params)
        if expected is None:
            simulation.add(
                "trial_" + key,
                "Scenario assumptions must specify finite costs, times and probabilities.",
                False,
                "Replayable assumptions",
                key,
                ev,
            )
            retained = False
            continue
        simulation.compare(
            "trial_" + key,
            "Scenario " + key + " reproduces under its stated inputs.",
            expected,
            {k: row.get(k) for k in expected},
            row.get("evidence", ev),
        )
        retained = retained and row.get("approvals_retained") == len(source.intervals)
    for estimate in simulation.body.get("estimates", []):
        key = estimate.get("trial", "<missing trial>")
        receipt = trials.get(key, {})
        expected = {
            "approach": receipt.get("approach"),
            "hours": receipt.get("projected_median"),
            "net": receipt.get("net_savings"),
        }
        actual = {
            "approach": estimate.get("approach"),
            "hours": estimate.get("projected_median_hours"),
            "net": estimate.get("modelled_net_savings"),
        }
        simulation.add(
            "estimate_" + key,
            "Reported AI estimate links to the executed scenario receipt.",
            bool(receipt) and _same(expected, actual),
            expected,
            actual,
            ev,
        )
    simulation.compare(
        "eligible_cases",
        "Dispute-bearing cases are excluded from automated routing.",
        len(source.eligible_cases),
        baseline.get("eligible"),
        ev,
    )
    retained = retained and baseline.get("eligible") == len(source.eligible_cases)
    simulation.control(
        "pass" if retained else "fail",
        "Every measured authorisation remains in the model and disputed cases stay outside routing."
        if retained
        else "The recorded scenario omits required authorisations or misstates routing eligibility.",
        ev,
    )
    simulation.add(
        "realised_cost",
        "Staffing and cost assumptions need operating measurements.",
        None,
        "Measured handling time and financial outcomes",
        "Hypothetical cost model",
        ev,
    )
    if not debate and len(trials) == 2:
        choices = {}
        for key, selector, label in (
            ("projected_median", min, "elapsed time"),
            ("net_savings", max, "net savings"),
            ("failure_cases", min, "failure exposure"),
        ):
            values = {r["approach"]: r.get(key) for r in trials.values()}
            if set(values) == DESIGNS and all(_numeric(v) for v in values.values()):
                best = selector(values.values())
                choices[label] = {k for k, v in values.items() if v == best}
        if choices and not set.intersection(*choices.values()):
            simulation.disagreements.append(
                "The assumed inputs give different preferred designs. "
                + ". ".join(
                    f"{key} favours {', '.join(sorted(v))}"
                    for key, v in choices.items()
                )
                + "."
            )


def _verification(verification, source, result, stages, plans, blocked):
    ev = source.evidence
    flattened = [f for stage in stages for f in stage.findings]
    presented = result.get("findings", [])
    verification.add(
        "published_findings",
        "Published findings match the findings recorded by each stage.",
        flattened == presented,
        len(flattened),
        len(presented),
        ev,
    )
    final_refs = set(_refs({"evidence": result.get("evidence", [])}))
    final_unsupported = sorted(final_refs - source.valid)
    verification.add(
        "final_citations",
        "The final evidence register resolves to snapshot source locations.",
        bool(final_refs and not final_unsupported),
        0,
        len(final_unsupported),
        ev,
    )
    verdict = verification.body.get("verdict")
    selected = result.get("selected")
    allowed = DESIGNS - blocked - set(verification.body.get("withheld_designs", []))
    if "eligible_designs" in verification.body:
        allowed &= set(verification.body["eligible_designs"])
    gate_consistent = result.get("verified") is (verdict == "accept") and (
        selected in allowed & set(plans) and bool(source.eligible_cases)
        if verdict == "accept"
        else verdict in {"reject", "request_evidence"} and selected == "neither"
    )
    verification.compare(
        "selection",
        "Published selection agrees with the verifier's choice.",
        verification.body.get("selected"),
        selected,
        ev,
    )
    verification.add(
        "verdict_gate",
        "A selected pilot requires an accepted verdict, eligibility and no applicable veto.",
        gate_consistent,
        {"allowed": sorted(allowed), "verdict": verdict},
        {"selected": selected, "verified": result.get("verified")},
        ev,
    )
    safe = gate_consistent and verification.body.get("selected") == selected
    verification.control(
        "pass" if safe else "fail",
        "The recommendation respects the held or conditional pilot decision."
        if safe
        else "The published selection conflicts with a human-control or reviewer gate.",
        ev,
    )
    if any(
        f.get("kind") in {"hypothesis", "assumption", "recommendation"}
        for s in stages
        for f in s.findings
    ):
        verification.weaknesses.append(
            "Citation integrity and numeric replay cannot establish the truth of free-text judgements."
        )


def evaluate(data, report, result):
    """Evaluate a completed result against its frozen inputs, without mutating either."""
    source = Snapshot(data, report)
    stages = [Stage(k, (result.get("stages") or {}).get(k, {}), source) for k in STAGES]
    discovery, process, strategy, architect, simulation, verification = stages
    package = result.get("package") or {}
    baseline = package.get("baseline") or {}
    _discovery(discovery, source, package, baseline)
    _process(process, source, baseline, report)
    _strategy(strategy, source, baseline)
    plans, blocked = _architect(architect, source, package)
    _simulation(simulation, source, baseline, result, architect.body.get("debate"))
    _verification(verification, source, result, stages, plans, blocked)
    rows = [s.finish() for s in stages]
    checks = [c for row in rows for c in row["checks"]]
    support, score = _support(checks)
    relevant_controls = [
        r["human_control"]
        for r in rows
        if r["human_control"]["status"] != "not_applicable"
    ]
    control_status = _status([h["status"] for h in relevant_controls])
    return {
        "version": EVALUATION_VERSION,
        "method": "Snapshot replay",
        "snapshot_sha256": source.digest,
        "status": _status([r["status"] for r in rows]),
        "score": score,
        "support": support,
        "coverage": _coverage(
            [f for stage in stages for f in stage.findings], source.valid
        ),
        "stages": rows,
        "weaknesses": [w for r in rows for w in r["weaknesses"]],
        "disagreements": [d for r in rows for d in r["disagreements"]],
        "human_control": {
            "status": control_status,
            "detail": f"{sum(h['status'] == 'pass' for h in relevant_controls)} of {len(relevant_controls)} applicable stages pass their human-control checks.",
            "evidence": _witness(i for h in relevant_controls for i in h["evidence"]),
        },
    }
