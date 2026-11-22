"""Evidence-bound refund routing designs and a deterministic observed-window model.

No network, database or provider access. The same module runs in the API and
in a browser Python worker. Input event times describe elapsed time only.
"""

from collections import Counter
from math import ceil, floor, isfinite
from statistics import mean, median

from .core import elapsed, group_cases


# Pilot assumptions, including GBP costs across the selected report window.
_DEFAULTS = {
    "queue": {
        "coverage": 0.75,
        "reduction": 0.40,
        "failure": 0.04,
        "manual_minutes": 12,
        "review_minutes": 8,
        "assist_minutes": 3,
        "exception_minutes": 18,
        "failure_delay": 4,
        "cadence_hours": 0,
        "hourly_rate": 40,
        "fixed_cost": 180,
        "unit_cost": 0.06,
    },
    "batch": {
        "coverage": 0.65,
        "reduction": 0.30,
        "failure": 0.02,
        "manual_minutes": 12,
        "review_minutes": 8,
        "assist_minutes": 6,
        "exception_minutes": 12,
        "failure_delay": 2,
        "cadence_hours": 4,
        "hourly_rate": 40,
        "fixed_cost": 45,
        "unit_cost": 0.02,
    },
}
_UPPER_BOUND = {
    "coverage": 1,
    "reduction": 1,
    "failure": 1,
    "manual_minutes": 240,
    "review_minutes": 240,
    "assist_minutes": 240,
    "exception_minutes": 240,
    "failure_delay": 168,
    "cadence_hours": 168,
    "hourly_rate": 1000,
    "fixed_cost": 100_000,
    "unit_cost": 1000,
}


def _parameters(overrides):
    if not isinstance(overrides, dict):
        raise ValueError("Scenario assumptions must be an object")
    name = overrides.get("approach", "queue")
    if not isinstance(name, str) or name not in _DEFAULTS:
        raise ValueError("Choose the queue or batch approach")
    params = dict(_DEFAULTS[name])
    for key, value in overrides.items():
        if key == "approach":
            continue
        if key not in params:
            raise ValueError(f"Unknown scenario assumption {key}")
        if (
            type(value) not in (int, float)
            or not 0 <= value <= _UPPER_BOUND[key]
            or not isfinite(value)
        ):
            raise ValueError(
                f"{key} must be a finite number from 0 to {_UPPER_BOUND[key]}"
            )
        params[key] = value
    if name == "queue" and params["cadence_hours"] != 0:
        raise ValueError("Queue routing has no batch cadence")
    return {"approach": name, **params}


def _percentile(ordered, fraction):
    """Interpolated percentile, including one-observation windows."""
    position = (len(ordered) - 1) * fraction
    lower = floor(position)
    return ordered[lower] + (position - lower) * (
        ordered[ceil(position)] - ordered[lower]
    )


def _collect(data, report):
    # Scope by the report's retained complete cases, including their early events.
    scoped = set(report["case_ids"])
    groups = group_cases(row for row in data["events"] if row["case"] in scoped)
    pairs = []
    refund_systems = set()
    dispute_cases = set()
    dispute_evidence = []
    for case, rows in groups.items():
        has_dispute = any("dispute" in row["activity"].casefold() for row in rows)
        for row in rows:
            if row["activity"].casefold() == "dispute reviewed":
                dispute_cases.add(case)
                if len(dispute_evidence) < 3:
                    dispute_evidence.append(row["id"])
        for first, last in zip(rows, rows[1:]):
            if (first["activity"].casefold(), last["activity"].casefold()) == (
                "invoice rekeyed",
                "refund authorised",
            ):
                pairs.append((first, last, elapsed(first, last), not has_dispute))
                refund_systems.update(r["system"] for r in rows)
    pairs.sort(key=lambda item: (item[2], item[1]["id"]))
    durations = [hours for _, _, hours, _ in pairs]
    policy_evidence = [
        d["id"]
        for d in data["docs"]
        if ("refund" in d["text"].casefold() or "dispute" in d["text"].casefold())
        and any(
            word in d["text"].casefold() for word in ("human", "reviewer", "operator")
        )
    ][:3]
    # Representative short, median and long intervals, each with both endpoints.
    sampled = (
        sorted({0, (len(pairs) - 1) // 2, len(pairs) // 2, len(pairs) - 1})
        if pairs
        else []
    )
    pair_evidence = [row["id"] for idx in sampled for row in pairs[idx][:2]]
    baseline = {
        "cases": len({first["case"] for first, _, _, _ in pairs}),
        "intervals": len(pairs),
        "median": round(median(durations), 2) if pairs else None,
        "mean": round(mean(durations), 2) if pairs else None,
        "p25": round(_percentile(durations, 0.25), 2) if pairs else None,
        "p75": round(_percentile(durations, 0.75), 2) if pairs else None,
        "disputes": len(dispute_cases),
        "eligible": len({first["case"] for first, _, _, ok in pairs if ok}),
        "eligible_intervals": sum(ok for _, _, _, ok in pairs),
        "source_systems": sorted({first["system"] for first, _, _, _ in pairs}),
        "authority_systems": sorted({last["system"] for _, last, _, _ in pairs}),
        "dispute_evidence": dispute_evidence,
        "policy_evidence": policy_evidence,
        "evidence": pair_evidence,
        "days": report.get("days"),
        "asof": report.get("asof"),
    }
    return baseline, pairs, sorted(refund_systems)


def _estimate(baseline, pairs, params):
    eligible_intervals = baseline["eligible_intervals"]
    attempts = eligible_intervals * params["coverage"]
    failures = attempts * params["failure"]
    successes = attempts - failures
    success_prob = params["coverage"] * (1 - params["failure"])
    fail_prob = params["coverage"] * params["failure"]
    poll_delay = params["cadence_hours"] / 2
    review_hours = params["review_minutes"] / 60

    def project(effect):
        # Each eligible interval is a mixture of uninterrupted manual routing,
        # successful routing and failed routing with a return to the manual queue.
        projected = []
        for _, _, hours, eligible in pairs:
            if not eligible:
                projected.append(hours)
                continue
            reducible = max(0, hours - review_hours)
            gain_on_success = reducible * effect - poll_delay
            # Failed digest attempts also wait for their scheduled poll.
            extra_on_failure = params["failure_delay"] + poll_delay
            projected.append(
                hours - success_prob * gain_on_success + fail_prob * extra_on_failure
            )
        return projected

    expected = project(params["reduction"])
    sensitivity_values = (
        [median(project(min(1, params["reduction"] * scale))) for scale in (0.8, 1.2)]
        if pairs
        else []
    )
    baseline_staff = (
        len(pairs) * (params["manual_minutes"] + params["review_minutes"]) / 60
    )
    staff = (
        baseline_staff
        + (
            successes * (params["assist_minutes"] - params["manual_minutes"])
            + failures * params["exception_minutes"]
        )
        / 60
    )
    fixed = params["fixed_cost"] if pairs else 0
    operating_cost = fixed + attempts * params["unit_cost"]
    staff_cost = staff * params["hourly_rate"]
    baseline_staff_cost = baseline_staff * params["hourly_rate"]
    case_exposures = Counter(first["case"] for first, _, _, ok in pairs if ok)
    failed_cases = sum(
        1 - (1 - fail_prob) ** count for count in case_exposures.values()
    )
    return {
        "approach": params["approach"],
        "assumptions": params,
        "baseline_median": baseline["median"],
        "projected_median": round(median(expected), 2) if pairs else None,
        "elapsed_hours_saved": round(sum(row[2] for row in pairs) - sum(expected), 2),
        "baseline_staff_hours": round(baseline_staff, 2),
        "staff_hours": round(staff, 2),
        "baseline_staff_cost": round(baseline_staff_cost, 2),
        "staff_cost": round(staff_cost, 2),
        "operating_cost": round(operating_cost, 2),
        "net_savings": round(baseline_staff_cost - staff_cost - operating_cost, 2),
        "failure_cases": round(failed_cases, 2),
        "failure_attempts": round(failures, 2),
        "attempts": round(attempts, 2),
        "eligible_cases": baseline["eligible"],
        "review_cases": baseline["cases"],
        "approvals_retained": len(pairs),
        "sensitivity": {
            "low": round(min(sensitivity_values), 2) if pairs else None,
            "high": round(max(sensitivity_values), 2) if pairs else None,
        },
        "evidence": baseline["evidence"],
        "currency": "GBP",
    }


def simulate_scenario(data, report, assumptions):
    """Model one approach using checked assumptions and the supplied case cohort."""
    params = _parameters(assumptions)
    baseline, pairs, _ = _collect(data, report)
    return _estimate(baseline, pairs, params)


def _design(name, baseline):
    queue = name == "queue"
    sources = ", ".join(baseline["source_systems"])
    authorities = ", ".join(baseline["authority_systems"])
    title = "Event-driven review queue" if queue else "Scheduled review digest"
    stage = "Materialise review item" if queue else "Assemble review digest"
    dependencies = [
        f"Obtain read access to invoice-rekey events from {sources}.",
        f"Have the {authorities} owner map the local case key to its human review record.",
        "Validate principal-to-workspace scope and assign a named refund reviewer.",
        (
            "Confirm stable upstream event IDs and duplicate delivery semantics."
            if queue
            else "Agree the digest cadence, timezone, late-arrival overlap and reviewer rota."
        ),
    ]
    evidence = list(
        dict.fromkeys(
            baseline["evidence"]
            + baseline["policy_evidence"]
            + baseline["dispute_evidence"]
        )
    )
    ledger = (
        "CREATE TABLE refund_review_item (\n"
        "  tenant text NOT NULL, source_event_id text NOT NULL, case_id text NOT NULL,\n"
        "  evidence_ids jsonb NOT NULL, status text NOT NULL DEFAULT 'shadow'\n"
        "    CHECK (status IN ('shadow','held','reviewed')),\n"
        "  created_at timestamptz NOT NULL DEFAULT now(), reviewed_by text, reviewed_at timestamptz,\n"
        "  PRIMARY KEY (tenant,source_event_id),\n"
        "  CHECK (status <> 'reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))\n"
        ");"
    )
    if queue:
        contract = (
            "Proposed internal endpoint\nPOST /v1/shadow/refund-review-items\n"
            "Require a workspace-scoped service credential. The authenticated principal supplies the tenant.\n"
            '{"case_id":"<canonical case>","source_event_id":"<invoice event>","evidence_ids":["<invoice event>"]}\n'
            "Validate invoice activity, event ownership, case linkage and evidence availability in one transaction. "
            "Return 201 on creation, 200 for identical replay, 409 for a conflicting payload and 422 for a mismatched case."
        )
        orchestration = (
            "Consume Invoice rekeyed → resolve the local case → inspect known dispute or missing evidence → hold or insert a shadow review item. "
            "After commit, expose the item to the scoped reviewer inbox. Recheck holds before a reviewer marks a local item reviewed. "
            "A later observed Refund authorised event provides the evaluation endpoint."
        )
        recovery = (
            "Acknowledge delivery only after the ledger commits. Retry transient reads with bounded exponential backoff; "
            "quarantine unresolved case keys with a reason. For out-of-order dispute openings, move pending items to held and alert the reviewer."
        )
        rollout = (
            "1. Add the shadow ledger and scoped reader.\n2. Backfill an historical event window with writes limited to MONOLITH.\n"
            "3. Replay duplicate and out-of-order deliveries.\n4. Expose the pilot inbox to named reviewers after their sign-off.\n"
            "5. Disable the consumer to roll back; retain the ledger and audit evidence."
        )
    else:
        contract = (
            "Proposed internal endpoint\nGET /v1/shadow/refund-digests/{window_end}/items?cursor=<opaque>\n"
            "Read a committed UTC window using the authenticated tenant and a scoped reviewer.\n"
            '{"window_end":"<UTC timestamp>","items":[{"case_id":"<case>","source_event_id":"<invoice event>",'
            '"decision_owner":"human","evidence_ids":["<invoice event>"]}],"next_cursor":null}\n'
            "Return 200 for a complete window, 404 for unavailable or out-of-scope windows. Publish the manifest only after all items commit."
        )
        ledger += (
            "\nCREATE TABLE refund_digest_item (tenant text NOT NULL, window_end timestamptz NOT NULL, "
            "source_event_id text NOT NULL, PRIMARY KEY (tenant,window_end,source_event_id), "
            "UNIQUE (tenant,source_event_id), FOREIGN KEY (tenant,source_event_id) "
            "REFERENCES refund_review_item(tenant,source_event_id));\n"
            "CREATE TABLE refund_digest_window (tenant text NOT NULL, window_end timestamptz NOT NULL, "
            "cursor_received_at timestamptz NOT NULL, cursor_event_id text NOT NULL, PRIMARY KEY (tenant,window_end));"
        )
        orchestration = (
            "Capture a UTC ingestion cutoff → read newly received invoice events using (received_at, event_id) → resolve case records "
            "→ exclude known disputes → commit reviewer items, window manifest and next cursor together. "
            "A late source event joins the next digest by arrival time. Future authorisation records are excluded from routing inputs."
        )
        recovery = (
            "Persist source arrival time at intake and add a bounded reconciliation scan over recent event time. "
            "On scheduler failure resume from the last committed cursor. Unique source keys suppress digest duplicates. "
            "Keep uncovered and stale cases in the existing review process and alert the duty reviewer for missed windows."
        )
        rollout = (
            "1. Add arrival metadata and the review-item, digest-item and cursor tables.\n"
            "2. Rebuild one historical window with deterministic pagination.\n3. Compare eligibility and timing against a manual case sample.\n"
            "4. Schedule a read-only pilot after reviewer sign-off.\n5. Pause the scheduler for rollback; preserve committed manifests."
        )
    artifacts = [
        {"title": "Integration requirements", "body": "\n".join(dependencies)},
        {"title": "API and data contract", "body": contract},
        {"title": "Proposed PostgreSQL migration", "body": ledger},
        {"title": "Workflow logic", "body": orchestration},
        {
            "title": "Security and decision rights",
            "body": (
                f"Require human authorisation in {authorities} for each refund. Dispute decisions stay with a human reviewer. "
                "Derive tenant scope from verified credentials on every ledger query. Give the pilot read-only source scopes. "
                "Projected routes cannot issue a refund, change a dispute outcome or send a customer notice."
            ),
        },
        {"title": "Failure handling", "body": recovery},
        {"title": "Engineering and rollout sequence", "body": rollout},
        {
            "title": "Acceptance and evaluation",
            "body": (
                f"Replay the scoped baseline of {baseline['intervals']} invoice-to-authorisation intervals and verify the measured "
                f"median of {baseline['median']:g}h against source timestamps. Reprocessing an event yields one ledger item. "
                "Run equal case keys through two tenants and verify isolation. Include a dispute opened before routing and a dispute "
                "opened after intake. Assert the hold and the reviewer's retained decision rights. "
                "Measure handling minutes, arrival-to-claim time, claim-to-authorisation time and rejection rate during the pilot before pricing wider rollout."
            ),
        },
    ]
    return {
        "id": name,
        "name": title,
        "summary": (
            f"Prepare a review item when {sources} records invoice re-entry; retain the {authorities} authoriser."
            if queue
            else f"Batch eligible {sources} events into a reviewer digest at a configurable cadence."
        ),
        "complexity": "Higher · event delivery and replay"
        if queue
        else "Lower · scheduler and checkpoint",
        "risk": (
            "Duplicate or out-of-order events can create an incorrect pending route."
            if queue
            else "Late arrivals and missed digest windows can extend the measured delay."
        ),
        "dependencies": dependencies,
        "nodes": [
            f"{sources} invoice event",
            "Case and dispute check",
            stage,
            f"{authorities} human review",
        ],
        "artifacts": artifacts,
        "assumptions": _parameters({"approach": name}),
        "evidence": evidence,
    }


def build_package(data, report):
    """Compile evidence, competing designs and scenarios for the selected report window."""
    baseline, pairs, systems = _collect(data, report)
    designs = (
        [_design(k, baseline) for k in _DEFAULTS]
        if baseline["eligible_intervals"]
        else []
    )
    return {
        "baseline": baseline,
        "systems": systems,
        "evidence": list(
            dict.fromkeys(
                baseline["evidence"]
                + baseline["policy_evidence"]
                + baseline["dispute_evidence"]
            )
        ),
        "approaches": designs,
        "assumptions": _parameters({}),
        "scenarios": [_estimate(baseline, pairs, d["assumptions"]) for d in designs],
        "limitations": [
            "The event log measures elapsed time. Queue ownership, staffing cost and touch time require field validation.",
            "The projected median is the median of case-interval expectations; realised outcomes vary.",
            "Sensitivity varies routing effectiveness by ±20% relative to its input. This range is a what-if interval.",
            "Modelled costs use GBP over the observed window. Savings exclude implementation cost, tax and wider organisational effects.",
            "A case with a dispute activity is excluded from routing in historical replay. A live pilot needs point-in-time dispute checks.",
        ],
    }
