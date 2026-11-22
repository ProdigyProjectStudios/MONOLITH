"""Portable deterministic analysis. Also runs in a dedicated browser Python worker."""

import csv
import hashlib
import io
import json
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median


def digest(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[
        :16
    ]


def stamp(value):
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            raise ValueError("timestamp needs a timezone")
        return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"Invalid timezone-aware timestamp: {value}") from exc


def parse_csv(content, filename, synthetic=False):
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    required = {"case_id", "activity", "timestamp", "system"}
    missing = required - set(reader.fieldnames or [])
    if missing:
        raise ValueError("Missing columns: " + ", ".join(sorted(missing)))
    source_id = "SRC-" + digest(filename, content)
    events = []
    for rownum, row in enumerate(reader, 2):
        if rownum > 25001:
            raise ValueError("Maximum 25,000 rows per file")
        if any(not (row.get(k) or "").strip() for k in required):
            raise ValueError(f"Row {rownum} has an empty required field")
        case = row["case_id"].strip().upper()
        activity = row["activity"].strip()
        system = row["system"].strip()
        if max(map(len, [case, activity, system])) > 160:
            raise ValueError(f"Row {rownum} has a field longer than 160 characters")
        ts = stamp(row["timestamp"])
        external = (row.get("event_id") or "").strip()
        ident = (
            digest(system.casefold(), external)
            if external
            else digest(case, system.casefold(), activity.casefold(), ts)
        )
        hubspot_ref = {}
        for field in ("hubspot_portal_id", "hubspot_deal_id"):
            value = (row.get(field) or "").strip()
            if value:
                if (
                    len(value) > 32
                    or not value.isascii()
                    or not value.isdigit()
                    or value.startswith("0")
                ):
                    raise ValueError(
                        f"Row {rownum} has an invalid {field}; use a positive HubSpot integer ID"
                    )
                hubspot_ref[field] = value
        if "hubspot_portal_id" in hubspot_ref and "hubspot_deal_id" not in hubspot_ref:
            raise ValueError(
                f"Row {rownum} must include hubspot_deal_id with hubspot_portal_id"
            )
        events.append(
            dict(
                id="EV-" + ident,
                case=case,
                activity=activity,
                timestamp=ts,
                system=system,
                source=source_id,
                row=rownum,
                synthetic=synthetic,
                **hubspot_ref,
            )
        )
    if not events:
        raise ValueError("The CSV contains no event rows")
    return {
        "id": source_id,
        "name": filename,
        "kind": "CSV",
        "synthetic": synthetic,
    }, events


def document(pages, filename, synthetic=False):
    if not any(p.strip() for p in pages):
        raise ValueError("The PDF has no extractable text. Supply a text PDF.")
    sid = "SRC-" + digest(filename, pages)
    docs = [
        dict(
            id="DOC-" + digest(sid, i),
            source=sid,
            page=i,
            text=p[:20000],
            synthetic=synthetic,
        )
        for i, p in enumerate(pages, 1)
        if p.strip()
    ]
    return {"id": sid, "name": filename, "kind": "PDF", "synthetic": synthetic}, docs


def merge(dataset, source, rows):
    key = "events" if source["kind"] != "PDF" else "docs"
    known = {r["id"]: r for r in dataset[key]}
    for r in rows:
        previous = known.get(r["id"])
        if (
            previous
            and key == "events"
            and (
                any(
                    previous[k] != r[k]
                    for k in ("case", "system", "activity", "timestamp")
                )
                or any(
                    r.get(k) and previous.get(k) != r[k]
                    for k in ("hubspot_portal_id", "hubspot_deal_id")
                )
            )
        ):
            raise ValueError("Conflicting canonical event: " + r["id"])
        known.setdefault(r["id"], r)
    dataset[key] = list(known.values())
    if not any(s["id"] == source["id"] for s in dataset["sources"]):
        dataset["sources"].append(source)
    return dataset


def group_cases(events):
    groups = defaultdict(list)
    for e in sorted(events, key=lambda e: (e["timestamp"], e["id"])):
        groups[e["case"]].append(e)
    return groups


def elapsed(first, last):
    return (
        datetime.fromisoformat(last["timestamp"])
        - datetime.fromisoformat(first["timestamp"])
    ).total_seconds() / 3600


def pattern_stats(groups):
    paths, systems, links = Counter(), Counter(), Counter()
    steps = defaultdict(list)
    durations = []
    for case, records in groups.items():
        paths[tuple(r["activity"] for r in records)] += 1
        systems.update(r["system"] for r in records)
        durations.append(elapsed(records[0], records[-1]))
        for a, b in zip(records, records[1:]):
            steps[(a["activity"], b["activity"])].append((elapsed(a, b), b["id"]))
            if a["system"] != b["system"]:
                links[(a["system"], b["system"])] += 1
    return paths, systems, links, steps, durations


RULES = [
    (
        "refund",
        "Refund routing",
        "Invoice rekeyed",
        "Refund authorised",
        "Refunds",
        "Route validated refund requests to finance",
        "Automate",
        "Confirm finance queue ownership",
        "Queue adapter",
        "Finance queue",
    ),
    (
        "entry",
        "Duplicate order entry",
        None,
        "Invoice rekeyed",
        "Finance",
        "Replace manual re-entry with a validated order mapping",
        "Automate",
        "Agree on the order and invoice field contract",
        "Field validator",
        "Invoice draft",
    ),
    (
        "handoff",
        "Fulfilment handoffs",
        "Order confirmed",
        "Picking assigned",
        "Operations",
        "Dispatch confirmed orders to the fulfilment queue",
        "Assist",
        "Validate warehouse capacity and exceptions",
        "Capacity check",
        "Dispatch queue",
    ),
    (
        "review",
        "Dispute adjudication",
        None,
        "Dispute reviewed",
        "Support",
        "Keep dispute decisions with an authorised reviewer",
        "Human-led",
        "Name an accountable dispute reviewer",
        "Evidence bundle",
        "Human review",
    ),
]


def opportunities(groups, docs):
    result = []
    for (
        key,
        title,
        previous,
        target,
        area,
        action,
        kind,
        dependency,
        middle,
        end,
    ) in RULES:
        matches = []
        for case, records in groups.items():
            for idx, row in enumerate(records):
                if row["activity"].casefold() == target.casefold() and (
                    previous is None
                    or idx
                    and records[idx - 1]["activity"].casefold() == previous.casefold()
                ):
                    matches.append((row, records[idx - 1] if idx else row))
        if not matches:
            continue
        cases = len({row["case"] for row, _ in matches})
        wait = round(median(elapsed(prev, row) for row, prev in matches), 2)
        cited = list(
            dict.fromkeys(r["id"] for row, prev in matches[:4] for r in (prev, row))
        )
        if key == "review":
            cited += [
                d["id"]
                for d in docs
                if "dispute" in d["text"].lower() and "human" in d["text"].lower()
            ][:1]
        confidence = round(100 * cases / (cases + 4))
        # Suitability is a transparent rubric; observed duration is not labour cost.
        score = (
            0
            if kind == "Human-led"
            else min(95, 40 + min(30, cases) + min(25, round(wait * 1.8)))
        )
        result.append(
            dict(
                id=key,
                title=title,
                area=area,
                action=action,
                kind=kind,
                score=score,
                confidence=confidence,
                cases=cases,
                hours=wait,
                evidence=cited,
                observed=f"{len(matches)} matching events across {cases} cases. Median preceding interval {wait:g} hours.",
                inference=f"The {area.lower()} team may benefit from a controlled pilot."
                if score
                else "Dispute decisions require contextual judgement.",
                limitations="Timestamps measure elapsed time. Staffing effort, exception rates and financial benefit require field validation.",
                dependencies=[dependency, "Approve a read-only shadow run"],
                architecture=["Source event", middle, end],
                roadmap=[
                    "Validate source identifiers and review cited cases",
                    "Pilot in shadow mode with a named owner",
                    "Review mismatches and authorise controlled rollout",
                ],
            )
        )
    return sorted(result, key=lambda r: -r["score"])


def analyse(dataset, days=30):
    traces = []

    def run(role, tool, fn):
        t = time.perf_counter()
        result = fn()
        traces.append(
            dict(
                role=role,
                tool=tool,
                ms=round((time.perf_counter() - t) * 1000, 2),
                status="Complete",
            )
        )
        return result

    all_groups = group_cases(dataset["events"])
    latest = max((v[-1]["timestamp"] for v in all_groups.values()), default=None)
    cutoff = (
        (datetime.fromisoformat(latest) - timedelta(days=int(days))).isoformat()
        if latest
        else ""
    )
    groups = run(
        "Discovery",
        "resolve_cases",
        lambda: {k: v for k, v in all_groups.items() if v[-1]["timestamp"] > cutoff},
    )
    paths, systems, links, steps, durations = run(
        "Process analysis", "discover_directly_follows", lambda: pattern_stats(groups)
    )
    recs = run(
        "Automation evaluation",
        "score_observed_patterns",
        lambda: opportunities(groups, dataset["docs"]),
    )
    blueprints = run(
        "Solution architecture",
        "compile_blueprints",
        lambda: {
            r["id"]: dict(
                nodes=r["architecture"],
                phases=r["roadmap"],
                dependencies=r["dependencies"],
            )
            for r in recs
        },
    )
    evidence = {r["id"] for rows in groups.values() for r in rows} | {
        d["id"] for d in dataset["docs"]
    }

    def verify():
        for r in recs:
            if not r["evidence"] or not set(r["evidence"]) <= evidence:
                raise ValueError("Recommendation evidence validation failed")

    run("Adversarial verification", "validate_evidence_references", verify)
    n_auto = sum(r["kind"] != "Human-led" for r in recs)
    series = [[], [], [], []]
    # Bucket by case completion to keep full variants intact at window boundaries.
    buckets = [{} for _ in range(12)]
    for k, v in groups.items():
        age = (
            datetime.fromisoformat(latest) - datetime.fromisoformat(v[-1]["timestamp"])
        ).total_seconds() / 86400
        buckets[max(0, 11 - int(age * 12 / days))][k] = v
    for bucket in buckets:
        p, _, _, _, ds = pattern_stats(bucket)
        for s, value in zip(
            series,
            [
                sum(map(len, bucket.values())),
                len(p),
                sum(r["kind"] != "Human-led" for r in opportunities(bucket, [])),
                round(median(ds), 1) if ds else 0,
            ],
        ):
            s.append(value)
    return dict(
        days=days,
        asof=latest,
        engine="Deterministic",
        mining="Directly-follows",
        events=sum(systems.values()),
        cases=len(groups),
        variants=len(paths),
        cycle=round(median(durations), 1) if durations else 0,
        auto=n_auto,
        series=series,
        systems=[dict(name=k, count=v) for k, v in sorted(systems.items())],
        links=[dict(source=a, target=b, count=c) for (a, b), c in links.items()],
        paths=[dict(steps=list(p), count=n) for p, n in paths.most_common()],
        bottlenecks=sorted(
            [
                dict(
                    first=a,
                    last=b,
                    hours=round(median(t for t, _ in data), 2),
                    count=len(data),
                    evidence=[i for _, i in data[:3]],
                )
                for (a, b), data in steps.items()
            ],
            key=lambda x: -x["hours"],
        ),
        recommendations=recs,
        traces=traces,
        blueprints=blueprints,
        case_ids=list(groups),
    )


def simulate(rec, coverage, reduction):
    if not (0 <= coverage <= 1 and 0 <= reduction <= 1):
        raise ValueError("Scenario inputs must be between zero and one")
    if rec["kind"] == "Human-led":
        return 0
    return round(rec["cases"] * rec["hours"] * coverage * reduction, 1)
