r"""Verify a live refund investigation against the authenticated MONOLITH API.

Example (from repository root, Python from the API environment):
  apps/api/.venv/bin/python scripts/verify-live-investigation.py --start \
      --api-url https://your-monolith-api.example --output ./live-run-audit.json

To stage a zero-credit replay of an already approved Northstar run:
  apps/api/.venv/bin/python scripts/verify-live-investigation.py --run-id RUN_ID \
      --api-url https://your-monolith-api.example --export-replay apps/web/public/replays

This verifies the full stored investigation and writes a content-addressed archive
and index locally. Review the generated files before publishing a new site version.
Set MONOLITH_WORKSPACE_TOKEN for the workspace bearer credential. Configure
OPENAI_API_KEY on the API and worker. --start requests a potentially billable
investigation. --run-id only verifies an existing run. The harness never approves
a design or prints raw prompts, records, provider response IDs or API bodies.

The attestation relies on a trusted MONOLITH backend recording genuine SDK HTTP
receipts. It is not an independent OpenAI billing statement or a cryptographic
attestation of an untrusted server. A valid reviewer rejection is a completed
live investigation; --require-accepted additionally requires a positive verdict.
"""

import argparse
import hashlib
import ipaddress
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from statistics import median
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

STAGES = {
    "discovery": ("Discovery Agent", "discover_scope"),
    "process": ("Process Intelligence Agent", "measure_intervals"),
    "strategy": ("Automation Strategy Agent", "inspect_controls"),
    "architect": ("Solutions Architect Agent", "compare_architectures"),
    "simulation": ("Simulation Agent", "simulate_routing"),
    "verification": ("Verification Agent", "audit_recommendation"),
}
REVIEWERS = {"reliability": "Reliability reviewer", "operations": "Operations reviewer"}
TERMINAL = {"run_completed", "run_failed", "run_interrupted"}
CITATION_KEYS = {
    "evidence",
    "evidence_ids",
    "agent_evidence",
    "policy_evidence",
    "dispute_evidence",
}


class Incomplete(Exception):
    """A safe diagnostics message, constructed only from local constants."""


def require(condition, message):
    if not condition:
        raise Incomplete(message)


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def api_origin(raw):
    try:
        parsed = urlsplit(raw)
        host = parsed.hostname
        port = parsed.port
        local = host == "localhost"
        if host and not local:
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                pass
        safe = (
            host
            and (parsed.scheme == "https" or (parsed.scheme == "http" and local))
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
            and parsed.path.strip("/") in ("", "api")
            and (port is None or 0 < port < 65536)
        )
    except ValueError:
        safe = False
    require(
        safe, "Use an HTTPS API origin or loopback HTTP without embedded credentials."
    )
    return f"{parsed.scheme}://{parsed.netloc}/api/"


def official_endpoint(url):
    if not isinstance(url, str):
        return False
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https"
        and parsed.netloc in ("api.openai.com", "api.openai.com:443")
        and parsed.path.rstrip("/") == "/v1/responses"
        and not parsed.query
        and not parsed.fragment
    )


def check_http(response, expected=200):
    if response.status_code == 409:
        try:
            key_absent = (
                response.json().get("detail")
                == "Live investigation requires a server-side OpenAI key."
            )
        except (ValueError, AttributeError):
            key_absent = False
        raise Incomplete(
            "Server-side OpenAI credentials are unavailable (HTTP 409)."
            if key_absent
            else "Backend refused the requested investigation (HTTP 409)."
        )
    require(
        response.status_code == expected,
        f"Backend returned HTTP {response.status_code}.",
    )


def frames(lines, deadline):
    ident, data = None, []
    for line in lines:
        require(
            time.monotonic() < deadline,
            "Investigation exceeded the verification deadline.",
        )
        if not line:
            if data:
                try:
                    obj = json.loads("\n".join(data))
                    seq = int(ident)
                except (ValueError, TypeError):
                    raise Incomplete("Malformed SSE event.") from None
                require(
                    isinstance(obj, dict)
                    and type(obj.get("seq")) is int
                    and obj["seq"] == seq,
                    "SSE sequence and event ID disagree.",
                )
                yield obj
            ident, data = None, []
        elif line.startswith("id:"):
            ident = line[3:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].removeprefix(" "))
        # Comments, including keepalive heartbeats, have no event payload.


def watch(client, rid, deadline, pause=time.sleep):
    events = []
    failures = 0
    while time.monotonic() < deadline:
        cursor = len(events)
        try:
            with client.stream(
                "GET",
                f"investigations/{rid}/events",
                params={"after": cursor},
                headers={"Accept": "text/event-stream", "Last-Event-ID": str(cursor)},
            ) as resp:
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise httpx.ReadError("Transient stream unavailability")
                check_http(resp)
                require(
                    resp.headers.get("content-type", "").split(";")[0]
                    == "text/event-stream",
                    "Backend returned an unexpected stream type.",
                )
                for evt in frames(resp.iter_lines(), deadline):
                    seq = evt["seq"]
                    if 0 < seq <= len(events):
                        require(evt == events[seq - 1], "A replayed event changed.")
                        continue
                    require(
                        seq == len(events) + 1,
                        "Investigation stream contains a sequence gap.",
                    )
                    events.append(evt)
                    failures = 0
                    if evt["kind"] in TERMINAL:
                        return events
        except httpx.TransportError:
            pass
        failures += 1
        require(failures < 8, "Event stream could not resume from its cursor.")
        pause(max(0, min(2 ** min(failures - 1, 4), deadline - time.monotonic())))
    raise Incomplete("Investigation exceeded the verification deadline.")


def citations(value):
    if isinstance(value, list):
        for item in value:
            yield from citations(item)
    elif isinstance(value, dict):
        for name, item in value.items():
            if name in CITATION_KEYS:
                require(
                    isinstance(item, list) and all(isinstance(i, str) for i in item),
                    "A citation field contains invalid references.",
                )
                yield from item
            else:
                yield from citations(item)


def check_sources(snapshot, cited, result):
    data = snapshot["data"]
    allowed_sources = {s["id"] for s in data["sources"]}
    lookup = {row["id"]: row for row in data["events"] + data["docs"]}
    require(
        cited and cited <= lookup.keys(),
        "One or more evidence references are absent from the saved snapshot.",
    )
    for ident in cited:
        row = lookup[ident]
        require(
            row.get("source") in allowed_sources
            and (row.get("row") or row.get("page")),
            "Cited evidence lacks source provenance.",
        )
    groups = defaultdict(list)
    for row in data["events"]:
        groups[row["case"]].append(row)
    waits = []
    matched = set()
    for case, group in groups.items():
        group.sort(key=lambda e: (e["timestamp"], e["id"]))
        for first, last in pairwise(group):
            if (first["activity"].casefold(), last["activity"].casefold()) == (
                "invoice rekeyed",
                "refund authorised",
            ):
                waits.append(
                    (
                        datetime.fromisoformat(last["timestamp"])
                        - datetime.fromisoformat(first["timestamp"])
                    ).total_seconds()
                    / 3600
                )
                matched.add(case)
    baseline = result["package"]["baseline"]
    process = result["stages"]["process"]
    require(
        waits
        and len(matched) == baseline["cases"] == process["matched_cases"]
        and abs(median(waits) - baseline["median"]) <= 0.011
        and abs(median(waits) - process["median_hours"]) <= 0.011,
        "The timing or case count disagrees with the independently recomputed source baseline.",
    )
    return len({lookup[i]["source"] for i in cited})


def check_receipt(payload, stage, seen, agents, usage, costs, models):
    group = payload.get("agent")
    names = {STAGES[stage][0]} if stage in STAGES else set()
    if stage == "architect":
        names.update(REVIEWERS.values())
    require(group in names, "Provider receipt is attributed to an unknown specialist.")
    require(
        payload.get("mode") == "live"
        and payload.get("provider") == "openai"
        and payload.get("transport") == "responses"
        and payload.get("status") == "completed"
        and official_endpoint(payload.get("provider_endpoint")),
        "Missing official OpenAI Responses transport receipt.",
    )
    rid = payload.get("response_id")
    require(
        isinstance(rid, str)
        and re.fullmatch(r"resp_[a-zA-Z0-9_-]{8,200}", rid)
        and rid not in seen,
        "Missing, malformed or repeated provider response ID.",
    )
    duration = payload.get("duration_ms")
    require(
        type(duration) in (float, int) and math.isfinite(duration) and duration >= 0,
        "Missing or invalid provider call duration.",
    )
    seen.add(rid)
    counts = payload.get("usage") or {}
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        value = counts.get(key)
        require(
            type(value) is int and value >= 0,
            "Missing or invalid provider token usage.",
        )
        usage[key] += value
    cached = counts.get("cached_input_tokens")
    if cached is not None:
        require(
            type(cached) is int and 0 <= cached <= counts["input_tokens"],
            "Inconsistent cached-token usage.",
        )
        usage["cached_input_tokens"] += cached
    else:
        usage["missing_cache_counts"] += 1
    require(
        counts["input_tokens"] > 0
        and counts["output_tokens"] > 0
        and counts["total_tokens"] == counts["input_tokens"] + counts["output_tokens"],
        "Inconsistent provider token usage.",
    )
    model = payload.get("model")
    require(isinstance(model, str) and bool(model.strip()), "Missing model identifier.")
    # Model labels can be fine-tune names or internal strings. Emit standard
    # public model names verbatim and fingerprint other labels in the audit.
    public = re.fullmatch(r"(?:gpt|chatgpt|o[1-9])(?:-[a-z0-9.]+)*", model)
    models[model if public else "model-" + digest(model)[:12]] += 1
    cost = payload.get("estimated_cost_usd")
    require(
        cost is None
        or (type(cost) in (float, int) and math.isfinite(cost) and cost >= 0),
        "Invalid estimated cost.",
    )
    costs.append(cost)
    agents[group] += 1


def attest(run, streamed, snapshot):
    require(
        run.get("mode") == "live" and run.get("status") == "completed",
        "A completed live-mode run is required.",
    )
    require(
        streamed
        and streamed[-1]["kind"] == "run_completed"
        and streamed == run["events"][: len(streamed)],
        "Persisted events disagree with the terminal SSE replay.",
    )
    require(
        all(evt["seq"] == n for n, evt in enumerate(streamed, 1)),
        "Persisted sequence contains a gap.",
    )
    result = run.get("result")
    require(isinstance(result, dict), "Missing persisted investigation result.")
    refs = set(citations(result))
    calls, agents, models, usage = defaultdict(set), Counter(), Counter(), Counter()
    receipts, costs, completed, started = set(), [], [], []
    assessed, debate = {}, None
    directly_inspected = defaultdict(set)
    model_receipts = []
    for evt in streamed:
        kind, stage, p = evt["kind"], evt["stage"], evt["payload"]
        refs.update(citations(p))
        if kind == "stage_started":
            require(p.get("mode") == "live", "A specialist ran in fallback mode.")
            started.append(stage)
        elif kind == "stage_completed":
            require(
                p.get("mode") == "live" and p.get("evidence") and p.get("findings"),
                "Stage lacks live, evidence-linked findings.",
            )
            completed.append(stage)
        elif kind == "tool_result":
            require(
                p.get("mode") == "live" and isinstance(p.get("result"), dict),
                "Missing executed live tool result.",
            )
            reviewer = p.get("reviewer")
            role = REVIEWERS.get(reviewer) if reviewer else STAGES.get(stage, ("",))[0]
            require(
                role and p.get("agent", role) == role,
                "Tool result is attributed to an unknown role.",
            )
            calls[role].add(p["name"])
            if p["name"] in ("read_evidence", "read_case"):
                directly_inspected[role].update(p["evidence"])
        elif kind == "model_call":
            check_receipt(p, stage, receipts, agents, usage, costs, models)
            model_receipts.append(p)
        elif kind == "architecture_assessment":
            which = p.get("reviewer")
            require(
                stage == "architect"
                and which in REVIEWERS
                and which not in assessed
                and p.get("evidence")
                and {x["approach"] for x in p.get("tradeoffs", [])}
                == {"queue", "batch"},
                "Independent architecture assessment is missing, duplicate or unsupported.",
            )
            direct = directly_inspected[REVIEWERS[which]]
            require(
                all(
                    set(e) & direct
                    for e in [p["evidence"], *(v["evidence"] for v in p["tradeoffs"])]
                ),
                "A reviewer did not inspect the sources cited in their assessment.",
            )
            require(
                all(
                    v["approach"] not in p["rejected"] or v.get("rejection_reason")
                    for v in p["tradeoffs"]
                ),
                "A design was vetoed without a specific reason.",
            )
            assessed[which] = p
        elif kind == "architecture_debate":
            debate = p
    require(
        started == list(STAGES) and completed == list(STAGES),
        "Six completed live specialist stages are required.",
    )
    for stage, (role, tool) in STAGES.items():
        require(
            agents[role] and tool in calls[role],
            "A specialist lacks a provider or required domain tool receipt.",
        )
        require(
            result["stages"][stage].get("evidence"),
            "A persisted specialist result lacks evidence.",
        )
    for role in REVIEWERS.values():
        require(
            agents[role] and {"compare_architectures", "read_evidence"} <= calls[role],
            "An independent reviewer lacks provider or source-tool receipts.",
        )
    require(
        set(assessed) == set(REVIEWERS)
        and debate
        and result["stages"]["architect"].get("debate"),
        "Independent architecture debate was not recorded.",
    )
    require(
        calls[STAGES["verification"][0]] & {"read_evidence", "read_case"},
        "Verifier did not inspect source evidence.",
    )
    require(
        result.get("model_calls") == model_receipts,
        "Final model receipts differ from provider events.",
    )
    require(
        set(debate["eligible"])
        == {"queue", "batch"}
        - {x for review in assessed.values() for x in review["rejected"]},
        "The architecture debate contradicts an independent reviewer veto.",
    )
    persisted_debate = result["stages"]["architect"]["debate"]
    require(
        all(persisted_debate.get(k) == v for k, v in debate.items() if k != "mode"),
        "The saved architecture debate differs from its event.",
    )
    for evaluation in persisted_debate["assessments"]:
        key = evaluation["reviewer"]
        require(
            key in assessed
            and all(assessed[key].get(k) == v for k, v in evaluation.items()),
            "The saved reviewer assessment differs from its event.",
        )
    require(
        streamed[-1]["payload"].get("verified") is result.get("verified"),
        "The terminal event contradicts the verifier.",
    )
    source_count = check_sources(snapshot, refs, result)
    verification = result["stages"]["verification"]
    require(
        {r["reviewer"] for r in verification.get("review_resolutions", [])}
        == set(REVIEWERS),
        "Verifier did not reconcile both independent assessments.",
    )
    require(
        all(
            set(r["evidence"]) & directly_inspected[STAGES["verification"][0]]
            for r in verification["review_resolutions"]
        ),
        "Verifier did not inspect the cited resolution evidence.",
    )
    verdict = verification.get("verdict")
    selected = result.get("selected")
    options = {"queue", "batch"}
    require(
        verdict in ("accept", "reject", "request_evidence")
        and result.get("verified") is (verdict == "accept")
        and verification.get("selected") == selected,
        "The final recommendation contradicts the verifier.",
    )
    require(
        isinstance(verification.get("checks"), dict) and verification["checks"],
        "Missing reconciliation checks.",
    )
    if verdict == "accept":
        require(
            all(x is True for x in verification["checks"].values())
            and selected in options
            and selected in debate["eligible"]
            and selected in verification["eligible_designs"]
            and selected not in verification["rejected_designs"],
            "Accepted design fails a verification gate.",
        )
    else:
        require(selected == "neither", "Rejected or held run selected a design.")
    if usage.pop("missing_cache_counts", 0):
        usage["cached_input_tokens"] = None
    return {
        "acceptance": "live_provider_execution_verified",
        "run_id": run["id"],
        "attestation_basis": "Authenticated MONOLITH backend receipts for OpenAI Responses",
        "checked_at": datetime.now(UTC).isoformat(),
        "models": dict(models),
        "model_calls": len(receipts),
        "summed_model_call_ms": round(sum(c["duration_ms"] for c in model_receipts), 1),
        "calls_with_request_id": sum(bool(c.get("request_id")) for c in model_receipts),
        "calls_by_agent": dict(agents),
        "tokens": dict(usage),
        "estimated_cost_usd": round(sum(costs), 8)
        if all(c is not None for c in costs)
        else None,
        "priced_calls": sum(c is not None for c in costs),
        "events": len(streamed),
        "evidence_references": len(refs),
        "source_count": source_count,
        "receipt_set_sha256": digest(sorted(receipts)),
        "stream_sha256": digest(streamed),
        "verification": {
            "verdict": verdict,
            "selected": selected,
            "completed_stages": len(completed),
            "reviewers": sorted(assessed),
            "approved_by_human": bool(run.get("approval")),
        },
    }


def verify(client, args, token):
    # Check that this is a protected API before sending a credential or starting a paid run.
    public = client.get("investigations")
    require(
        public.status_code in (401, 403),
        "Backend must require workspace authentication.",
    )
    require(token, "Set MONOLITH_WORKSPACE_TOKEN to a workspace bearer token.")
    client.headers["Authorization"] = "Bearer " + token
    if args.start:
        response = client.post(
            "investigations",
            json={"mode": "live", "days": args.days, "request_id": uuid4().hex},
        )
        check_http(response)
        rid = response.json()["id"]
    else:
        rid = args.run_id
    require(
        isinstance(rid, str) and re.fullmatch(r"[a-fA-F0-9-]{16,64}", rid),
        "Invalid run ID.",
    )
    print(json.dumps({"monitoring_run": rid}), file=sys.stderr, flush=True)
    req = f"investigations/{rid}"
    response = client.get(req)
    check_http(response)
    require(response.json().get("mode") == "live", "Run used deterministic execution.")
    events = watch(client, rid, time.monotonic() + args.timeout)
    require(
        events[-1]["kind"] == "run_completed",
        "Run failed or was interrupted. No live acceptance issued.",
    )
    final = client.get(req)
    check_http(final)
    snap = client.get(req + "/snapshot")
    check_http(snap)
    run = final.json()
    require(
        run.get("id") == rid, "Persisted result belongs to a different investigation."
    )
    snapshot = snap.json()
    summary = attest(run, events, snapshot)
    if getattr(args, "export_replay", None):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
        from monolith.replay_capture import CaptureError, build_capture, publish

        workspace = client.get("workspace")
        check_http(workspace)
        try:
            body = build_capture(
                run, snapshot, events, summary, workspace.json()["tenant"], token
            )
            summary["replay"] = publish(args.export_replay, body)
        except CaptureError as exc:
            raise Incomplete(str(exc)) from None
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    op = parser.add_mutually_exclusive_group(required=True)
    op.add_argument(
        "--start",
        action="store_true",
        help="Start a potentially billable, read-only live investigation",
    )
    op.add_argument(
        "--run-id", help="Verify an existing live run using its durable event replay"
    )
    parser.add_argument(
        "--api-url", default=os.getenv("MONOLITH_API_URL", "http://127.0.0.1:8000")
    )
    parser.add_argument("--days", type=int, choices=[7, 14, 30, 90], default=30)
    parser.add_argument("--timeout", type=int, default=720)
    parser.add_argument(
        "--output", type=Path, help="Write sanitized acceptance JSON to a new file"
    )
    parser.add_argument(
        "--require-accepted",
        action="store_true",
        help="Also require a verifier-accepted shadow design",
    )
    parser.add_argument(
        "--export-replay",
        type=Path,
        metavar="DIR",
        help="Stage an existing, approved 30-day Northstar live run in a local replay catalog",
    )
    args = parser.parse_args(argv)
    try:
        require(
            not args.export_replay or not args.start,
            "Capture requires --run-id for a run with a recorded human-approved design.",
        )
        require(1 <= args.timeout <= 3600, "Use a deadline from 1 to 3600 seconds.")
        if args.output:
            require(not args.output.exists(), "Choose a new audit output path.")
            require(
                args.output.parent.is_dir(), "Audit output directory is unavailable."
            )
        with httpx.Client(
            base_url=api_origin(args.api_url),
            timeout=httpx.Timeout(30, connect=10),
            follow_redirects=False,
        ) as client:
            summary = verify(client, args, os.getenv("MONOLITH_WORKSPACE_TOKEN"))
        if args.output:
            with args.output.open("x", encoding="utf8") as handle:
                json.dump(summary, handle, indent=2)
                handle.write("\n")
        print(json.dumps(summary, indent=2))
        return (
            3
            if args.require_accepted and summary["verification"]["verdict"] != "accept"
            else 0
        )
    except Incomplete as exc:
        print(
            json.dumps({"acceptance": "not_verified", "reason": str(exc)}),
            file=sys.stderr,
        )
    except (
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        IndexError,
        httpx.HTTPError,
        OSError,
    ):
        print(
            json.dumps(
                {
                    "acceptance": "not_verified",
                    "reason": "Incomplete evidence, transport or output failure.",
                }
            ),
            file=sys.stderr,
        )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
