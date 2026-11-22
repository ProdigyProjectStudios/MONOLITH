"""A publication projection of a verified, approved Northstar run.

The release CLI obtains the run from the authenticated service and verifies its
original provider receipts before calling this module. Only the pinned public
dataset and whitelisted, validated investigation fields can reach the archive.
"""

import hashlib
import json
import math
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

from .architecture_review import REVIEWERS, Assessment, assemble
from .core import analyse
from .evaluation import evaluate
from .investigator import OUTPUTS, PERMISSIONS, ROLES, attach_verified_designs
from .mining import mine
from .portable_investigation import STAGES, Research

CAPTURE_ID = "northstar-refund-live"
SEED_SHA256 = "bd4da6173d4dc37007ac60e6ffd116d818536067d7769489e1a590d08417fc0c"
LIMIT = 8 * 1024 * 1024
DEMO = Path(__file__).resolve().parents[2] / "web" / "public" / "demo.json"
CHECKS = {
    "case_count_agrees",
    "median_agrees",
    "case_rows_have_sources",
    "all_prior_citations_resolve",
    "two_approaches_evaluated",
    "eligible_case_exists",
    "independent_reviews_resolved",
    "eligible_design_remains",
}
# Assessments and blueprint proposals contain bounded, user-visible model prose.
# Never include raw prompts, free-form tool search queries or HTTP envelopes.
SENSITIVE = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{12,}|(?:gh[pousr]_|github_pat_|xox[baprs]-|pat-(?:na|eu)\d-)[A-Za-z0-9_-]{10,}"
    r"|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._~+/-]{8,}"
    r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}"
    r"|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    r"|(?:password|api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s*[:=]\s*[A-Za-z0-9._/-]{6,})"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?://[^\s/]+@",
    re.IGNORECASE,
)


class CaptureError(ValueError):
    """Safe diagnostics leave customer content and credentials out of CLI output."""


def check(condition, message):
    if not condition:
        raise CaptureError(message)


def encoded(obj):
    return json.dumps(
        obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def seed_hash(data):
    check(set(data) == {"sources", "events", "docs"}, "Unexpected dataset structure.")
    ordered = {k: sorted(rows, key=lambda r: r["id"]) for k, rows in data.items()}
    check(
        all(row.get("synthetic") is True for rows in ordered.values() for row in rows),
        "Only synthetic source records are eligible for publication.",
    )
    return sha(encoded(ordered))


def moment(value):
    parsed = datetime.fromisoformat(value)
    check(parsed.tzinfo is not None, "The replay contains an unzoned timestamp.")
    return parsed.astimezone(UTC).isoformat()


def alias(prefix, value):
    return prefix + "-" + sha(value.encode())[:24] if value else None


def provenance_ids(value, known):
    check(
        isinstance(value, list) and set(value) <= known,
        "Unknown source evidence in recorded output.",
    )
    return list(value)


def approve_checkpoint(run, terminal_seq):
    approval = run.get("approval") or {}
    result = run["result"]
    checkpoint = run["events"][terminal_seq:]
    check(
        result.get("verified") is True
        and result["stages"]["verification"]["verdict"] == "accept",
        "The verifier must accept a design before capture.",
    )
    verification = result["stages"]["verification"]
    designs = {"queue", "batch"}
    reviews = result["stages"]["architect"]["debate"]["assessments"]
    vetoes = {name for reviewer in reviews for name in reviewer["rejected"]}
    permitted = designs - vetoes - set(verification["withheld_designs"])
    check(
        permitted == set(verification["eligible_designs"])
        and designs - permitted == set(verification["rejected_designs"]),
        "Approval eligibility contradicts the review and verification gates.",
    )
    selected = approval.get("approach")
    check(
        selected in permitted and result["selected"] in permitted,
        "An explicit approval for an eligible blueprint is required.",
    )
    check(
        len(checkpoint) == 1
        and checkpoint[0]["seq"] == terminal_seq + 1
        and checkpoint[0]["kind"] == "blueprint_approved"
        and checkpoint[0]["stage"] == "verification"
        and checkpoint[0]["payload"] == approval,
        "A matching persisted human-approval event must follow the completed run.",
    )
    check(
        moment(approval["at"]) >= moment(run["events"][terminal_seq - 1]["at"])
        and moment(checkpoint[0]["at"]) >= moment(approval["at"]),
        "Invalid approval chronology.",
    )
    return {"approach": selected, "at": moment(approval["at"])}


def public_model(model):
    if re.fullmatch(r"(?:gpt|chatgpt|o[1-9])(?:-[a-z0-9.]+)*", model):
        return model
    return "model-" + sha(json.dumps(model).encode())[:12]


def receipt(p):
    check(
        p.get("provider") == "openai"
        and p.get("provider_endpoint") == "https://api.openai.com/v1/responses"
        and p.get("transport") == "responses"
        and p.get("mode") == "live"
        and p.get("status") == "completed",
        "Only successful official OpenAI receipts are publishable.",
    )
    # The backend's explicit test adapter uses distinct provider metadata. Also
    # reject self-identifying fixtures when presented under a mislabeled origin.
    check(
        not any(
            re.search(r"(mock|fixture|replay)", str(p.get(k, "")), re.IGNORECASE)
            for k in ("response_id", "request_id", "model")
        ),
        "A protocol fixture cannot be published as live.",
    )
    check(
        type(p["call"]) is int
        and 0 < p["call"] <= 8
        and type(p["duration_ms"]) in (int, float)
        and math.isfinite(p["duration_ms"])
        and p["duration_ms"] >= 0,
        "Invalid call telemetry.",
    )
    return {
        "agent": p["agent"],
        "call": p["call"],
        "model": public_model(p["model"]),
        "mode": "live",
        "provider": "openai",
        "transport": "responses",
        "provider_endpoint": "https://api.openai.com/v1/responses",
        "status": "completed",
        "model_source": "requested_model",
        "call_scope": "sdk_turn",
        "duration_ms": p["duration_ms"],
        "estimated_cost_usd": p["estimated_cost_usd"],
        "response_id": alias("response", p["response_id"]),
        "request_id": alias("request", p.get("request_id")),
        "usage": {
            k: p["usage"].get(k)
            for k in (
                "input_tokens",
                "output_tokens",
                "cached_input_tokens",
                "total_tokens",
            )
        },
    }


def stage_output(stage, raw, research):
    # Observed numerics are added by the deterministic backend validator after the
    # model's structured output has been parsed. Reconstruct that row ourselves.
    reported = raw["findings"]
    observed = [v for v in reported if v["kind"] == "observed"]
    out = (
        OUTPUTS[stage]
        .model_validate(
            {**raw, "findings": [v for v in reported if v["kind"] != "observed"]}
        )
        .model_dump()
    )
    if stage == "process":
        fact = {
            "kind": "observed",
            "text": f"{research.case_total} refund cases have a {research.median:g}-hour median interval.",
            "evidence": research.sample,
        }
        check(
            observed == [fact],
            "The measured process finding differs from the canonical cohort.",
        )
        out["findings"].insert(0, fact)
    else:
        check(
            not observed, "Unexpected observed assertion in a live specialist finding."
        )
    if stage == "verification":
        check(
            set(raw["checks"]) == CHECKS
            and all(val is True for val in raw["checks"].values()),
            "Verification checks are incomplete.",
        )
        out["checks"] = {k: True for k in sorted(CHECKS)}
        check(
            raw.get("model_selected", out["selected"]) == out["selected"]
            and raw.get("model_verdict", out["verdict"]) == out["verdict"]
            and not raw.get("enforced_reasons"),
            "An accepted verifier decision contradicts its model output or blockers.",
        )
        for field in ("model_selected", "model_verdict", "enforced_reasons"):
            if field in raw:
                out[field] = raw[field]
        for k in ("eligible_designs", "rejected_designs"):
            check(
                set(raw[k]) <= {"queue", "batch"},
                "Unknown design in verification output.",
            )
            out[k] = list(raw[k])
    return out


def public_tool(name, inputs, original, research, known):
    ids = provenance_ids(original["evidence"], known)
    if name == "find_policy":
        # Retrieval methods and ranks can differ across database engines. Publish
        # the actual matched references; the public snapshot supplies the text.
        check(
            all(i in research.docs for i in ids),
            "A policy lookup references a noncanonical document.",
        )
        passages = original["passages"]
        check(
            [p["id"] for p in passages] == ids
            and all(
                p["text"] == research.docs[p["id"]]["text"][:850]
                and p["page"] == research.docs[p["id"]]["page"]
                for p in passages
            ),
            "Retrieved policy content differs from the public source.",
        )
        return {"evidence": ids, "matches": len(ids)}
    if name == "simulate_routing":
        computed = research.simulate_routing(**inputs)
    elif name in {
        "discover_scope",
        "measure_intervals",
        "inspect_controls",
        "compare_architectures",
        "audit_recommendation",
        "read_case",
        "read_evidence",
    }:
        computed = getattr(research, name)(**inputs)
    else:
        raise CaptureError("Unexpected tool in a release trace.")
    check(
        encoded(computed) == encoded(original),
        "Recorded tool output disagrees with the canonical replay.",
    )
    # Keep a bounded public projection. Full public source rows are in snapshot.
    keys = {
        "read_case": ("case", "evidence"),
        "read_evidence": ("evidence",),
        "discover_scope": (
            "events",
            "cases",
            "refund_cases",
            "systems",
            "total_systems",
            "evidence",
        ),
        "measure_intervals": (
            "cases",
            "intervals",
            "median_hours",
            "min_hours",
            "max_hours",
            "cohort_comparison",
            "evidence",
        ),
        "inspect_controls": (
            "dispute_cases",
            "review_events",
            "refund_control",
            "dispute_control",
            "evidence",
        ),
        "audit_recommendation": (
            "checks",
            "passed",
            "source_case_count",
            "source_median_hours",
            "evidence",
        ),
        "simulate_routing": ("trial", "scenario", "evidence"),
        "compare_architectures": ("evidence",),
    }[name]
    result = {k: computed[k] for k in keys}
    if name == "compare_architectures":
        result["approaches"] = [
            {"id": a["id"], "name": a["name"]} for a in computed["approaches"]
        ]
    return result


def tool_inputs(name, raw, research):
    if name == "read_case":
        check(
            raw.get("case_id") in research.relevant_cases,
            "Unknown case in published tool input.",
        )
        return {"case_id": raw["case_id"]}
    if name == "read_evidence":
        ident = raw.get("evidence_id")
        check(
            ident in research.docs or ident in research.events,
            "Unknown evidence in published tool input.",
        )
        return {"evidence_id": ident}
    if name == "simulate_routing":
        return {k: raw[k] for k in ("approach", "coverage", "reduction", "failure")}
    return {}


def project(run, demo, approved):
    research = Research(demo["data"], demo["report"])
    known = research.docs.keys() | research.events.keys()
    events, assessments, receipts = [], [], []
    per_stage = {s: [] for s in STAGES}
    debate = None
    for event in run["events"]:
        kind, stage, p = event["kind"], event["stage"], event["payload"]
        base = {}
        if stage in STAGES:
            actor = p.get("agent", ROLES[stage])
            check(
                actor == ROLES[stage]
                or (stage == "architect" and actor in REVIEWERS.values()),
                "Unknown investigation role.",
            )
            base = {"mode": "live", "agent": actor}
            if "reviewer" in p:
                check(
                    REVIEWERS.get(p["reviewer"]) == actor,
                    "Unknown independent reviewer.",
                )
                base["reviewer"] = p["reviewer"]
        else:
            check(stage == "run", "Unknown investigation stage.")
        if kind in {"run_queued", "run_started", "stage_started", "assessment_started"}:
            payload = {**base, "mode": "live"}
        elif kind == "run_completed":
            payload = {"verified": True}
        elif kind == "blueprint_approved":
            payload = approved
        elif kind == "model_call":
            payload = {**base, **receipt(p)}
            receipts.append(payload)
            per_stage[stage].append(payload)
        elif kind == "model_call_started":
            check(
                p.get("provider") == "openai" and p.get("mode") == "live",
                "Unexpected model transport.",
            )
            payload = {
                **base,
                "provider": "openai",
                "transport": "responses",
                "model": public_model(p["model"]),
                "call": int(p["call"]),
            }
        elif kind in {"tool_started", "tool_result"}:
            name = p["name"]
            check(
                name in PERMISSIONS[stage]
                or (
                    stage == "architect"
                    and base.get("reviewer")
                    and name
                    in {
                        "compare_architectures",
                        "read_evidence",
                        "find_policy",
                        "inspect_controls",
                        "measure_intervals",
                    }
                ),
                "Unexpected role-tool combination.",
            )
            inputs = tool_inputs(name, p["input"], research)
            payload = {**base, "name": name, "call": int(p["call"]), "input": inputs}
            if kind == "tool_result":
                payload["result"] = public_tool(
                    name, inputs, p["result"], research, known
                )
                check(
                    p["evidence"] == payload["result"]["evidence"],
                    "Tool citations disagree with its result.",
                )
                payload["evidence"] = payload["result"]["evidence"]
        elif kind == "architecture_assessment":
            assessment = Assessment.model_validate(p).model_dump()
            assessment["reviewer"] = p["reviewer"]
            assessments.append(assessment)
            payload = {**base, **assessment}
        elif kind == "architecture_debate":
            debate = assemble(assessments)
            check(
                all(debate[k] == p[k] for k in debate),
                "Review reconciliation differs from its assessments.",
            )
            payload = {**debate, "mode": "live"}
        elif kind == "stage_completed":
            raw = run["result"]["stages"][stage]
            check(
                all(p.get(k) == v for k, v in raw.items()),
                "Saved specialist output differs from its recorded event.",
            )
            out = stage_output(stage, raw, research)
            if stage == "architect":
                check(debate is not None, "Missing independent assessments.")
                out["debate"] = debate
            out["model_calls"] = per_stage[stage]
            research.snapshot(stage, out)
            payload = {**base, **out}
        elif kind == "handoff":
            index = STAGES.index(stage)
            check(
                p["from"] == stage
                and index + 1 < len(STAGES)
                and p["to"] == STAGES[index + 1],
                "Unknown specialist handoff.",
            )
            previous = research.history[stage]
            payload = {
                **base,
                "from": stage,
                "to": p["to"],
                "summary": previous["summary"],
                "evidence": previous["evidence"],
            }
        else:
            raise CaptureError("Unrecognised or failed event in a release trace.")
        events.append(
            {
                "seq": event["seq"],
                "at": moment(event["at"]),
                "kind": kind,
                "stage": stage,
                "payload": payload,
            }
        )
    attach_verified_designs(research)
    check(
        research.package == run["result"]["package"],
        "Recorded blueprint disagrees with the validated designs and public seed.",
    )
    result = research.finish()
    check(
        result["trials"] == run["result"]["trials"],
        "Recorded scenario estimates disagree with their tool receipts.",
    )
    result["model_calls"] = receipts
    return {
        "id": run["id"],
        "mode": "live",
        "status": "completed",
        "days": 30,
        "created": moment(run["created"]),
        "events": events,
        "result": result,
        "approval": approved,
    }


def verify_safeguards(demo, result):
    grade = evaluate(demo["data"], demo["report"], result)
    check(
        grade["status"] != "fail"
        and grade["support"]["failed"] == 0
        and grade["human_control"]["status"] != "fail",
        "Independent evaluation failed a source or human-control safeguard.",
    )
    return grade


def build_capture(run, snapshot, events, acceptance, tenant, private_token):
    check(
        tenant == "northstar", "Only the Northstar showcase workspace can be captured."
    )
    check(
        acceptance.get("acceptance") == "live_provider_execution_verified"
        and acceptance["run_id"] == run["id"]
        and re.fullmatch(r"[a-f0-9]{32}", run["id"])
        and run["mode"] == "live"
        and run["status"] == "completed"
        and run["days"] == 30,
        "A verified, completed 30-day Northstar live run is required.",
    )
    data = json.loads(DEMO.read_bytes())["data"]
    check(
        seed_hash(data) == SEED_SHA256 and seed_hash(snapshot["data"]) == SEED_SHA256,
        "Snapshot is different from the pinned public Northstar seed.",
    )
    # Recompute the public report using the same deterministic backend analysis.
    # Its preparation timings belong to this verifier process, outside the saved run.
    report = mine(data, analyse(data, 30))
    report["traces"] = []
    demo = {"data": data, "report": report}
    check(
        snapshot["report"]["days"] == 30
        and snapshot["report"]["asof"] == demo["report"]["asof"]
        and set(snapshot["report"]["case_ids"]) == set(demo["report"]["case_ids"]),
        "The captured case window differs from the public seed.",
    )
    check(
        run["events"][: len(events)] == events
        and events
        and events[-1]["kind"] == "run_completed",
        "Receipt replay and terminal event do not match.",
    )
    approved = approve_checkpoint(run, len(events))
    verify_safeguards(demo, run["result"])
    projected = project(run, demo, approved)
    projected["result"]["evaluation"] = verify_safeguards(demo, projected["result"])
    audit_fields = (
        "acceptance",
        "run_id",
        "models",
        "model_calls",
        "summed_model_call_ms",
        "calls_with_request_id",
        "calls_by_agent",
        "tokens",
        "estimated_cost_usd",
        "priced_calls",
        "events",
        "evidence_references",
        "source_count",
        "receipt_set_sha256",
        "stream_sha256",
        "verification",
        "attestation_basis",
    )
    payload = {
        "schema": "monolith.replay.v1",
        "id": CAPTURE_ID,
        "provenance": {
            "kind": "verified_live_capture",
            "scope": "full_investigation",
            "tenant": "northstar",
            "dataset": "Northstar Commerce",
            "synthetic": True,
            "seed_sha256": SEED_SHA256,
            "provider": "openai",
            "transport": "responses",
            "captured_at": approved["at"],
            "timestamp_basis": "recorded design approval",
            "report_basis": "Recomputed from pinned public records. Investigation timing is preserved in run events.",
            "projection": "Public evidence and structured outputs; provider identifiers are hashed.",
        },
        "snapshot": demo,
        "run": projected,
        "acceptance": {k: acceptance[k] for k in audit_fields},
    }
    body = encoded(payload)
    check(len(body) <= LIMIT, "Replay exceeds the publication size limit.")
    text = body.decode()
    check(
        not SENSITIVE.search(text) and (not private_token or private_token not in text),
        "Potential credential or contact information in publication fields. Inspect the recorded run privately.",
    )
    return body


def publish(directory, body):
    """Write payload first and atomically replace the catalog. Identical exports are reusable."""
    archive = json.loads(body)
    check(
        set(archive) == {"schema", "id", "provenance", "snapshot", "run", "acceptance"}
        and archive["schema"] == "monolith.replay.v1"
        and archive["id"] == CAPTURE_ID
        and archive["provenance"].get("scope") == "full_investigation"
        and archive["provenance"].get("kind") == "verified_live_capture"
        and archive["acceptance"].get("acceptance")
        == "live_provider_execution_verified",
        "Only full release captures may be staged in a public catalog.",
    )
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    token = sha(body)
    filename = f"{CAPTURE_ID}-{token}.json"
    dest = directory / filename
    if dest.exists():
        check(
            not dest.is_symlink() and dest.read_bytes() == body,
            "Existing release artifact fails its content hash.",
        )
    else:
        _atomic_write(dest, body)
    entry = {
        "id": CAPTURE_ID,
        "path": "/replays/" + filename,
        "sha256": token,
        "bytes": len(body),
    }
    _atomic_write(
        directory / "index.json",
        encoded({"schema": "monolith.replays.index.v1", "captures": [entry]}) + b"\n",
    )
    return entry


def _atomic_write(target, body):
    with NamedTemporaryFile(dir=target.parent, prefix=".replay-", delete=False) as temp:
        name = temp.name
        try:
            temp.write(body)
            temp.flush()
            os.fsync(temp.fileno())
        except BaseException:
            Path(name).unlink(missing_ok=True)
            raise
    try:
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)
