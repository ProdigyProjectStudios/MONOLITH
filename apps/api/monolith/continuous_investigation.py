"""Read-only specialist checkpoints and source-linked decision memory for the event stream.

The API and the static browser run these pure functions against a frozen local
dataset. An investigation can recommend a human review. An observed metric
change never records deployment, human approval, or an attributed intervention.
"""

import hashlib
import json
from datetime import UTC, datetime
from math import isfinite

STAGES = ("discovery", "process", "strategy", "architect", "simulation", "verification")
ROLES = (
    "Discovery Agent",
    "Process Intelligence Agent",
    "Automation Strategy Agent",
    "Solutions Architect Agent",
    "Simulation Agent",
    "Verification Agent",
)
HUMAN = "A named operator retains implementation approval and all financial, dispute and customer decisions."
METRICS = {
    "latency": ("transition_hours", "hours"),
    "variant": ("variant_share", "%"),
    "drift": ("activity_share", "%"),
    "duplicate": ("repeat_share", "%"),
    "handoff": ("handoff_share", "%"),
}
# These hypotheses and tests describe the particular condition the analyzer detected.
# None is treated as an explanation until an operator obtains the additional evidence.
QUESTIONS = {
    "latency": (
        "A queue or a recording delay could lengthen this interval.",
        "Compare queue-entry, work-start and completion timestamps for the same cases.",
    ),
    "variant": (
        "A different intake mix or an incomplete case history could change the observed path share.",
        "Review the entry criteria and completion status for cases in each path.",
    ),
    "drift": (
        "A change in demand or source coverage could alter activity prevalence.",
        "Reconcile activity counts with source exports and classify case types in both periods.",
    ),
    "duplicate": (
        "A repeated activity can be legitimate rework or duplicate logging.",
        "Check source event identifiers and operator notes before classifying any repetition.",
    ),
    "handoff": (
        "A shift in team or system routing could change the observed handoff share.",
        "Match the observed transfers to routing configuration and case ownership records.",
    ),
}


def _json_numbers(v):
    # IndexedDB's JSON boundary serializes integral floats as integers.
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: _json_numbers(i) for k, i in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_numbers(i) for i in v]
    return v


def _hash(value):
    return hashlib.sha256(
        json.dumps(
            _json_numbers(value),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _unique(values):
    return list(dict.fromkeys(values))


def _number(value):
    return type(value) in (int, float) and isfinite(value)


def _time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def _scope(signal):
    return (
        signal.get("kind"),
        tuple(signal.get("subject", [])),
        signal.get("metric_key") or signal.get("metric", {}).get("id"),
        signal.get("unit") or signal.get("metric", {}).get("unit"),
    )


def _related(memory, signal):
    return sorted(
        (d for d in memory if _scope(d) == _scope(signal)),
        key=lambda d: (_time(d.get("at")) or datetime.min.replace(tzinfo=UTC), d["id"]),
    )


def _source_rows(data, ids):
    sources = {s["id"] for s in data["sources"]}
    wanted = set(ids)
    found = {
        r["id"]: r
        for r in data["events"]
        if r["id"] in wanted
        and r.get("source") in sources
        and type(r.get("row")) is int
        and r["row"] > 0
    }
    return [found[i] for i in _unique(ids) if i in found]


def _signal_inputs(signal):
    if signal.get("kind") not in METRICS:
        raise ValueError("Unknown signal kind.")
    metric = signal["metric"]
    if not (
        signal.get("id")
        and signal.get("subject")
        and signal.get("evidence")
        and _time(signal.get("as_of"))
        and signal.get("windows")
        and (metric.get("id"), metric.get("unit")) == METRICS[signal["kind"]]
        and _number(metric.get("recent"))
        and (
            (metric.get("previous") is None and metric.get("delta") is None)
            or (_number(metric.get("previous")) and _number(metric.get("delta")))
        )
        and type(signal["support"]) is int
        and signal["support"] >= 3
    ):
        raise ValueError(
            "An investigation needs a measured two-period signal and its source witnesses."
        )


def _chain(signal, checkpoints, scope=None):
    if len(checkpoints) > len(STAGES):
        raise ValueError("Too many investigation checkpoints.")
    prior = None
    for index, row in enumerate(checkpoints):
        recorded = row.get("scope_sha256")
        if index == 0 and scope is None:
            scope = recorded
        if (
            row.get("stage") != STAGES[index]
            or row.get("signal_id") != signal["id"]
            or row.get("signal_sha256") != _hash(signal)
            or recorded != scope
            or row.get("previous_checkpoint") != prior
            or row.get("checkpoint_id")
            != _hash({k: v for k, v in row.items() if k != "checkpoint_id"})
        ):
            raise ValueError(
                "The saved checkpoint does not match the frozen investigation."
            )
        prior = row["checkpoint_id"]
    return prior


def _finding(kind, text, evidence):
    return {"kind": kind, "text": text, "evidence": list(evidence)}


def _plans(signal, records):
    systems = sorted({row["system"] for row in records})
    subject = " → ".join(signal["subject"])
    source = ", ".join(systems) or "the source system"
    evidence = signal["evidence"]
    return [
        {
            "id": "review_worklist",
            "name": "Case review worklist",
            "contract": f"Compile case and evidence IDs for {subject} into a read-only worklist from {source}.",
            "key": "snapshot ID + signal ID + case ID",
            "validation": "Replay the same revision twice and reconcile distinct cases to the source log.",
            "failure": "Hold an item with missing provenance. A reviewer resolves the source discrepancy.",
            "human_control": HUMAN,
            "evidence": list(evidence),
        },
        {
            "id": "source_audit",
            "name": "Source reconciliation sample",
            "contract": f"Sample cases from both observation periods and reconcile the source trail for {subject}.",
            "key": "snapshot ID + source ID + source row",
            "validation": QUESTIONS[signal["kind"]][1],
            "failure": "Record unavailable source rows as unresolved. Leave the operational system unchanged.",
            "human_control": HUMAN,
            "evidence": list(evidence),
        },
    ]


def _measurement(signal):
    m = signal["metric"]
    return {k: m[k] for k in ("id", "label", "unit", "previous", "recent", "delta")}


def _display(value, unit):
    return f"{value:g}%" if unit == "%" else f"{value:g} {unit}"


def advance_investigation(data, signal, memory, checkpoints):
    """Compute exactly one checkpoint. Use the same frozen inputs for every retry."""
    _signal_inputs(signal)
    relevant = _related(memory or [], signal)
    # Bind the chain to row values (including uncited rows that affect denominators),
    # the selected metric, and the historical decision records used by the specialists.
    dataset_digest = _hash(
        {
            k: sorted(data.get(k, []), key=lambda r: r["id"])
            for k in ("sources", "events", "docs")
        }
    )
    scope = _hash([dataset_digest, signal, relevant])
    prior = _chain(signal, checkpoints, scope)
    if len(checkpoints) == len(STAGES):
        raise ValueError("All specialist checkpoints are already complete.")
    index = len(checkpoints)
    stage = STAGES[index]
    evidence = list(signal["evidence"])
    records = _source_rows(data, evidence)
    known = [r["id"] for r in records]
    metric = _measurement(signal)
    kind = signal["kind"]
    restrictions = {}
    for decision in relevant:
        for rejected in decision.get("rejected_designs", []):
            restrictions.setdefault(rejected["id"], {})[_hash(rejected)] = rejected
        if decision.get("decision") == "approved" and decision.get("approval"):
            restrictions.pop(decision["approval"]["approach"], None)
    if stage == "discovery":
        summary = f"{signal['title']}. The detector reports {signal['support']} supporting cases in its {signal.get('support_period', 'recent')} cohort."
        findings = [_finding("observed", summary, known)]
        details = {
            "support": signal["support"],
            "support_period": signal.get("support_period", "recent"),
            "systems": sorted({r["system"] for r in records}),
            "case_ids": list(signal.get("case_ids", [])),
            "witnesses": [
                {k: r[k] for k in ("id", "source", "row", "case", "timestamp")}
                for r in records
            ],
            "data_as_of": signal["as_of"],
            "dataset_sha256": dataset_digest,
        }
    elif stage == "process":
        summary = (
            f"{metric['label']} moved from {_display(metric['previous'], metric['unit'])} to {_display(metric['recent'], metric['unit'])}."
            if metric["previous"] is not None
            else f"{metric['label']} measured {_display(metric['recent'], metric['unit'])}. The previous period had no comparable denominator."
        )
        hypothesis, test = QUESTIONS[kind]
        findings = [
            _finding("observed", summary, known),
            _finding("hypothesis", hypothesis, known),
        ]
        details = {
            "metric": metric,
            "windows": signal["windows"],
            "method": signal["method"],
            "caveat": signal["caveat"],
            "test": test,
        }
    elif stage == "strategy":
        summary = QUESTIONS[kind][1]
        if relevant:
            last = relevant[-1]
            if last["decision"] == "approved":
                summary += f" Confirm whether the previously approved {last['approval']['approach']} design was deployed before interpreting any change."
            elif last["decision"] == "held":
                summary += " Recheck the reason the previous decision was held before proposing another pilot."
            else:
                summary += " Review the outstanding proposal with its owner before opening another pilot."
        findings = [_finding("recommendation", summary, known)]
        details = {
            "human_authority": HUMAN,
            "prior_decision_ids": [d["id"] for d in relevant],
            "prior_decisions": [
                {
                    "id": d["id"],
                    "at": d["at"],
                    "summary": d.get("summary", ""),
                    "run_id": d["run_id"],
                    "evidence": list(d.get("evidence", [])),
                    "decision": d["decision"],
                    "selected": d["selected"],
                    "approval": d.get("approval"),
                    "rejected_designs": d.get("rejected_designs", []),
                }
                for d in relevant
            ],
            "operating_mode": "Read-only investigation",
        }
    elif stage == "architect":
        plans = _plans(signal, records)
        summary = "Compare a review worklist with a source reconciliation sample. Both preserve the original systems and require an operator."
        findings = [_finding("recommendation", summary, known)]
        details = {
            "alternatives": plans,
            "prior_rejections": [
                r for rows in restrictions.values() for r in rows.values()
            ],
            "eligible_designs": [p["id"] for p in plans if p["id"] not in restrictions],
        }
    elif stage == "simulation":
        cases = signal["support"]
        assumptions = {
            "reviewer_minutes_per_period": 60,
            "worklist_minutes_per_case": 6,
            "audit_minutes_per_case": 12,
        }
        trials = []
        for design, minutes in (
            ("review_worklist", assumptions["worklist_minutes_per_case"]),
            ("source_audit", assumptions["audit_minutes_per_case"]),
        ):
            count = min(cases, assumptions["reviewer_minutes_per_period"] // minutes)
            trials.append(
                {
                    "approach": design,
                    "supporting_cases": cases,
                    "cases_reviewed": count,
                    "unreviewed_cases": cases - count,
                    "review_minutes": count * minutes,
                }
            )
        summary = f"With a hypothetical 60 reviewer-minutes, the worklist covers {trials[0]['cases_reviewed']} cases and the audit covers {trials[1]['cases_reviewed']}."
        findings = [_finding("assumption", summary, known)]
        details = {
            "assumptions": assumptions,
            "trials": trials,
            "limitation": "Review capacity is a scenario estimate. Operational improvement, costs and handling times require pilot measurements.",
        }
    else:
        from .continuous_engine import observe_subject

        measured = observe_subject(data, signal)
        # Preserve the detector's tested rules, units, support and both periods'
        # witnesses. Callers can still attach unrelated scheduling metadata.
        reproduced = bool(measured and measured["active"]) and all(
            signal.get(k) == value for k, value in measured.items()
        )
        eligible = checkpoints[3]["eligible_designs"]
        checks = {
            "detector_reproduced": reproduced,
            "source_rows_resolve": bool(evidence) and len(known) == len(set(evidence)),
            "human_decision_retained": checkpoints[2]["human_authority"] == HUMAN,
            "eligible_design_remains": bool(eligible),
        }
        verified = all(checks.values())
        # Backlogs support case-by-case triage. A new path, rework, activity
        # drift or past approval needs source reconciliation before a pilot.
        approved_before = any(d["decision"] == "approved" for d in relevant)
        prefer = (
            "review_worklist"
            if kind in ("latency", "handoff") and not approved_before
            else "source_audit"
        )
        selection = (
            (prefer if prefer in eligible else eligible[0]) if verified else None
        )
        name = next(
            (p["name"] for p in checkpoints[3]["alternatives"] if p["id"] == selection),
            None,
        )
        summary = (
            f"The measured change and its source rows reconcile. Submit the {name.lower()} to an operator for approval."
            if verified
            else "Hold the design. A source, measurement or prior design constraint failed verification."
        )
        findings = [
            _finding("recommendation" if verified else "limitation", summary, known)
        ]
        details = {
            "verdict": "recommend_review" if verified else "hold",
            "verified": verified,
            "selected": selection,
            "checks": checks,
            "eligible_designs": eligible,
            "rejected_designs": checkpoints[3]["prior_rejections"],
            "approval": None,
            "human_authority": HUMAN,
        }
    output = {
        "stage": stage,
        "agent": ROLES[index],
        "mode": "deterministic",
        "signal_id": signal["id"],
        "summary": summary,
        "findings": findings,
        "evidence": known,
        "scope_sha256": scope,
        "signal_sha256": _hash(signal),
        "previous_checkpoint": prior,
        **details,
    }
    output["checkpoint_id"] = _hash(output)
    return output


def finish_investigation(signal, checkpoints):
    """Collect a fully replayable specialist chain. It never grants approval."""
    if len(checkpoints) != len(STAGES):
        raise ValueError("Six ordered specialist checkpoints are required.")
    _chain(signal, checkpoints)
    final = checkpoints[-1]
    return {
        "mode": "deterministic",
        "signal": signal,
        "summary": final["summary"],
        "verified": final["verified"],
        "selected": final["selected"],
        "approval": None,
        "human_authority": HUMAN,
        "stages": {r["stage"]: r for r in checkpoints},
        "findings": [f for r in checkpoints for f in r["findings"]],
        "evidence": _unique(i for r in checkpoints for i in r["evidence"]),
    }


def _rejections(result):
    stages = result.get("stages") or {}
    verifier = stages.get("verification") or {}
    rows = []
    for rejection in verifier.get("rejected_designs", []):
        if isinstance(rejection, dict):
            rows.append(
                {
                    "id": rejection["id"],
                    "reason": rejection["reason"],
                    "evidence": list(rejection.get("evidence", [])),
                }
            )
            continue
        reasons = []
        evidence = []
        for review in (
            stages.get("architect", {}).get("debate", {}).get("assessments", [])
        ):
            if rejection not in review.get("rejected", []):
                continue
            for assessment in review.get("tradeoffs", []):
                if assessment.get("approach") == rejection and assessment.get(
                    "rejection_reason"
                ):
                    reasons.append(
                        f"{review['reviewer']} review: {assessment['rejection_reason']}"
                    )
                    evidence.extend(assessment.get("evidence", []))
        if not reasons:
            reasons = verifier.get("enforced_reasons", []) or [
                verifier.get("reconciliation")
                or "The verifier withheld this design. No design-specific reason was recorded."
            ]
            evidence.extend(verifier.get("evidence", []))
        rows.append(
            {
                "id": rejection,
                "reason": " ".join(reasons),
                "evidence": _unique(evidence),
            }
        )
    return rows


def normalize_decision(run, signal=None):
    """Return a durable decision record for a completed continuous or historic Studio run.

    Callers can attach run.as_of from the frozen Studio report. Its event-time
    anchor is required for a later quantitative comparison to that historic run.
    run.created, including for an imported investigation, is a processing time.
    """
    result = run.get("result")
    if (
        run.get("status") != "completed"
        or not run.get("id")
        or not isinstance(result, dict)
    ):
        return None
    verification = (result.get("stages") or {}).get("verification") or {}
    if not verification:
        return None
    signal = signal or result.get("signal")
    package = result.get("package") or {}
    base = package.get("baseline") or {}
    if signal:
        kind = signal["kind"]
        if kind not in METRICS:
            return None
        metric = signal["metric"]
        kind_source = "continuous"
        signal_id = signal["id"]
        metric_key = metric["id"]
        title = signal["title"]
        subject = list(signal["subject"])
        unit = metric["unit"]
        previous, current = metric.get("previous"), metric.get("recent")
        windows, as_of = signal.get("windows"), signal.get("as_of")
        candidates = set(verification.get("eligible_designs", []))
    elif _number(base.get("median")) and _number(base.get("cases")):
        kind_source = "refund_studio"
        kind = "latency"
        metric_key, unit = METRICS[kind]
        subject = ["Invoice rekeyed", "Refund authorised"]
        title = "Refund approval delays"
        signal_id = None
        previous, current = None, base["median"]
        windows = None
        as_of = run.get("as_of") or result.get("as_of")
        candidates = {a["id"] for a in package.get("approaches", [])}
        if "eligible_designs" in verification:
            candidates &= set(verification["eligible_designs"])
    else:
        return None
    rejections = _rejections(result)
    approvals = run.get("approval") or {}
    selected = result.get("selected")
    selected = None if selected in (None, "neither") else selected
    valid = (
        result.get("verified") is True
        and verification.get("verdict")
        == ("recommend_review" if kind_source == "continuous" else "accept")
        and selected in candidates
        and selected not in {v["id"] for v in rejections}
    )
    approval = None
    if (
        valid
        and approvals.get("approach") in candidates
        and _time(approvals.get("at"))
        and approvals["approach"] not in {v["id"] for v in rejections}
    ):
        approval = {"approach": approvals["approach"], "at": approvals["at"]}
    decision = "approved" if approval else ("proposed" if valid else "held")
    at = (
        (approval or {}).get("at")
        or run.get("finished_at")
        or run.get("updated_at")
        or run.get("created")
        or run.get("created_at")
        or ""
    )
    # Preserve source IDs of historic findings even when today's incoming data
    # no longer includes that row. The run_id resolves the original frozen input.
    findings = [
        {"kind": v["kind"], "text": v["text"], "evidence": list(v.get("evidence", []))}
        for v in result.get("findings", [])
        if v.get("kind") and isinstance(v.get("text"), str)
    ]
    return {
        "id": "decision-" + str(run["id"]),
        "run_id": run["id"],
        "signal_id": signal_id,
        "origin": kind_source,
        "kind": kind,
        "metric_key": metric_key,
        "title": title,
        "subject": subject,
        "unit": unit,
        "at": at,
        "mode": run.get("mode") or result.get("mode") or "unknown",
        "summary": result.get("summary", ""),
        "findings": findings,
        "evidence": list(result.get("evidence", [])),
        "decision": decision,
        "selected": selected,
        "approval": approval,
        "rejected_designs": rejections,
        "human_authority": HUMAN,
        "baseline": previous,
        "current": current,
        "windows": windows,
        "as_of": as_of,
    }


def reassess_decision(decision, signal, data):
    """Observe the same subject in newer event data, even when its alert has cleared.

    A signal argument must be an analyzer observation for this frozen dataset.
    When omitted, measure the stored decision's exact subject independently of
    the alert threshold. No new source evidence means no recorded outcome.
    """
    from .continuous_engine import observe_subject

    measured = observe_subject(data, decision)
    if not measured or (
        signal is not None
        and (
            _scope(signal) != _scope(measured)
            or any(
                signal.get(k) != measured.get(k)
                for k in ("id", "metric", "as_of", "windows", "evidence")
            )
        )
    ):
        return None
    return _outcome(decision, measured, data)


def reassess_decisions(decisions, data):
    """Re-evaluate tracked subjects once per source revision, including cleared alerts."""
    from .continuous_engine import observe_subjects

    if not decisions:
        return []
    observations = observe_subjects(data, decisions)
    by_scope = {_scope(s): s for s in observations.values()}
    return [
        result
        for d in decisions
        if (s := by_scope.get(_scope(d)))
        and (result := _outcome(d, s, data)) is not None
    ]


def _outcome(decision, signal, data):
    if _scope(decision) != _scope(signal):
        return None
    at, baseline_at = _time(signal.get("as_of")), _time(decision.get("as_of"))
    before, after = decision.get("current"), signal["metric"]["recent"]
    if (
        at is None
        or baseline_at is None
        or at <= baseline_at
        or not _number(before)
        or not _number(after)
    ):
        return None
    # Witnesses are bounded samples. A rolling window can change because earlier
    # cases leave its denominator even if every sampled case predates ingestion.
    ids = signal.get("evidence_by_window", {}).get("recent", [])
    rows = _source_rows(data, ids)
    if not ids or len(rows) != len(set(ids)):
        return None
    evidence = [r["id"] for r in rows]
    delta = round(after - before, 4)
    status = "increased" if delta > 0 else "decreased" if delta < 0 else "unchanged"
    comparison = (
        "legacy_context" if decision["origin"] == "refund_studio" else "matched_metric"
    )
    unit = decision["unit"]
    amount_unit = "percentage points" if unit == "%" else unit
    wording = f"{signal['metric']['label']} was {_display(before, unit)} at the saved decision and {_display(after, unit)} in the later window ({delta:+g} {amount_unit})."
    if comparison == "legacy_context":
        wording += " The historic refund dossier used all matched intervals. The later measurement uses per-case medians in a seven-day cohort."
    wording += " The records establish the observed values. Attribution to the proposed design is unestablished."
    identity = _hash(
        [
            decision["id"],
            signal["id"],
            signal["as_of"],
            signal["windows"],
            after,
            evidence,
        ]
    )
    return {
        "id": "observation-" + identity[:24],
        "decision_id": decision["id"],
        "signal_id": signal["id"],
        "metric_key": decision["metric_key"],
        "status": status,
        "comparison": comparison,
        "attribution": "unestablished",
        "from_value": before,
        "to_value": after,
        "delta": delta,
        "unit": unit,
        "summary": wording,
        "evidence": evidence,
        "at": signal["as_of"],
        "windows": signal["windows"],
        "active": signal.get("active"),
        "prior_as_of": decision["as_of"],
        "prior_evidence": list(decision.get("evidence", [])),
        "support": signal.get("support_by_window", {}).get("recent"),
        "method": signal["method"],
    }
