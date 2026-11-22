"""Independent proposal reviews with reviewer-local tools and enforceable vetoes."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .portable_investigation import InvestigationError

Text = Annotated[str, Field(min_length=1, max_length=600)]
Design = Literal["queue", "batch"]
IDs = Annotated[list[str], Field(min_length=1, max_length=8)]
REVIEWERS = {"reliability": "Reliability reviewer", "operations": "Operations reviewer"}
BRIEFS = {
    "reliability": "Evaluate duplicate delivery, partial failure, replay, tenant isolation and human approval controls.",
    "operations": "Evaluate reviewer burden, polling delay, escalation ownership, pilot cost uncertainty and finance sign-off.",
}


class Tradeoff(BaseModel):
    approach: Design
    benefit: Text
    risk: Text
    rejection_reason: Text | None
    evidence: IDs


class Assessment(BaseModel):
    preferred: Literal["queue", "batch", "neither"]
    confidence: Literal["low", "medium", "high"]
    confidence_basis: Text
    rationale: Text
    tradeoffs: list[Tradeoff] = Field(min_length=2, max_length=2)
    rejected: list[Design] = Field(max_length=2)
    constraints: list[Text] = Field(min_length=1, max_length=4)
    evidence: IDs


def validate_review(session, out):
    if not {"compare_architectures", "read_evidence"} <= set(session.calls):
        raise InvestigationError(
            "The reviewer must inspect both designs and a source record."
        )
    if {t["approach"] for t in out["tradeoffs"]} != {"queue", "batch"}:
        raise InvestigationError(
            "Both designs require an independently cited tradeoff."
        )
    for ids in [out["evidence"], *(t["evidence"] for t in out["tradeoffs"])]:
        if not set(ids) <= session.seen or not set(ids) & session.inspected:
            raise InvestigationError(
                "Each assessment must cite evidence the reviewer inspected directly."
            )
    pool = {p["id"]: set(p["evidence"]) for p in session.research.package["approaches"]}
    for tradeoff in out["tradeoffs"]:
        if (
            not session.inspected
            & pool[tradeoff["approach"]]
            & set(tradeoff["evidence"])
        ):
            raise InvestigationError(
                "A tradeoff lacks a directly inspected source from its design."
            )
    rejected = set(out["rejected"])
    for tradeoff in out["tradeoffs"]:
        if (tradeoff["approach"] in rejected) != bool(tradeoff.get("rejection_reason")):
            raise InvestigationError(
                "Each veto requires a reason specific to that design."
            )
    if out["preferred"] in rejected or (
        out["preferred"] == "neither" and rejected != {"queue", "batch"}
    ):
        raise InvestigationError(
            "The review preference contradicts the stated rejection constraints."
        )


def assemble(assessments):
    rejected = set.union(*(set(r["rejected"]) for r in assessments))
    return {
        "assessments": assessments,
        "eligible": sorted({"queue", "batch"} - rejected),
        "disagreement": len({r["preferred"] for r in assessments}) > 1
        or len({tuple(sorted(r["rejected"])) for r in assessments}) > 1,
        "evidence": list(dict.fromkeys(i for r in assessments for i in r["evidence"])),
    }
