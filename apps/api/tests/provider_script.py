"""Scripted, source-dependent model choices for protocol tests. No provider secrets or sockets."""

from monolith.architecture_review import REVIEWERS
from monolith.portable_investigation import DOMAIN_TOOL


async def reply(stage, invoke, misbehaviour=None):
    if stage in REVIEWERS:
        designs = await invoke("compare_architectures")
        record = await invoke("read_evidence", evidence_id=designs["evidence"][0])
        cites = record["evidence"]
        preferred = "queue" if stage == "reliability" else "batch"
        return {
            "preferred": preferred,
            "confidence": "medium",
            "confidence_basis": "Review is limited to the sampled records.",
            "rationale": "Reliability fixture rationale"
            if stage == "reliability"
            else "Operations fixture rationale",
            "tradeoffs": [
                {
                    "approach": p["id"],
                    "benefit": "Replayable local review.",
                    "risk": "Reviewer availability requires validation.",
                    "rejection_reason": "Queue escalation ownership is unresolved."
                    if misbehaviour == "veto"
                    and stage == "operations"
                    and p["id"] == "queue"
                    else None,
                    "evidence": cites,
                }
                for p in designs["approaches"]
            ],
            "rejected": ["queue"]
            if misbehaviour in ("veto", "unexplained_veto") and stage == "operations"
            else [],
            "constraints": ["Keep external writes disabled."],
            "evidence": cites,
        }
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
            withheld_designs=[],
            reconciliation="The controls apply to both designs; the selected queue pilot has a replay test.",
            review_resolutions=[
                {
                    "reviewer": reviewer,
                    "conclusion": "Confirm owner-scoped case reconciliation.",
                    "evidence": cites,
                }
                for reviewer in ("reliability", "operations")
            ],
        )
    return output
