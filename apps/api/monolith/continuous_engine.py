"""Portable, event-time process monitoring. The same module runs in CPython and Pyodide."""

import math
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from itertools import groupby
from statistics import median

from .core import digest

WEEK = timedelta(days=7)
EPOCH_LIMIT = 8
MIN_SUPPORT = 3
EXAMPLES = 3
SIGNALS_PER_KIND = 12
METRICS = (
    ("events", "Observed events", "events"),
    ("cases", "Active cases", "cases"),
    ("cycle_hours", "Median observed case span", "hours"),
    ("handoffs_per_case", "Cross-system transitions per active case", "per case"),
    ("repeat_case_share", "Cases with a repeated activity", "%"),
    ("variants", "Distinct observed case paths", "paths"),
)
METHOD = (
    "Compare two consecutive seven-day UTC periods ending after the latest event date. "
    "Count distinct cases for support. Attribute transitions to their destination time "
    "and observed case paths to the last recorded event."
)
CAVEATS = [
    "The newest date may be incomplete. Late imports can revise earlier periods.",
    "A last recorded event may precede business completion. Case spans and variants describe observed paths.",
    "Elapsed time includes waiting and work. Repeated activities and system changes need operational review.",
    "Confidence describes case support under fixed detection rules. It is not a causal or statistical probability.",
]
PLAYBOOK = {
    "latency": (
        "Review the delayed transition",
        "Compare the handoff timestamps and validate queue ownership with the two step owners.",
    ),
    "variant": (
        "Review the emerging path",
        "Walk through the cited cases with the process owner and record whether the new route is intentional.",
    ),
    "drift": (
        "Check the change in activity mix",
        "Compare source coverage and case mix with the operating team before changing any workflow.",
    ),
    "duplicate": (
        "Inspect repeated work",
        "Check the cited source rows for corrections, retries or intended repeat handling.",
    ),
    "handoff": (
        "Review cross-system routing",
        "Confirm the receiving team's responsibilities, exception path and field requirements.",
    ),
}


def _ratio(numerator, denominator):
    return None if not denominator else round(100 * numerator / denominator, 3)


def _med(values):
    return round(median(values), 4) if values else None


def _metric(key, label, unit, previous, recent):
    delta = None if previous is None or recent is None else round(recent - previous, 4)
    return {
        "id": key,
        "label": label,
        "unit": unit,
        "previous": previous,
        "recent": recent,
        "delta": delta,
    }


def _iso(day):
    return day.isoformat() if day else None


def _records(data):
    """Keep exact reimports once and quarantine conflicting identities."""
    known, collisions = {}, set()
    invalid = 0
    for row in data.get("events", []):
        try:
            if not all(
                isinstance(row[k], str) and row[k].strip()
                for k in ("id", "case", "activity", "system", "timestamp")
            ):
                raise ValueError
            dt = datetime.fromisoformat(row["timestamp"])
            if dt.utcoffset() is None:
                raise ValueError
            dt = dt.astimezone(UTC)
        except (KeyError, TypeError, ValueError, OverflowError):
            invalid += 1
            continue
        key = row["id"]
        previous = known.get(key)
        if previous and previous != (dt, row):
            collisions.add(key)
        else:
            known[key] = (dt, row)
    return (
        sorted(
            (v for k, v in known.items() if k not in collisions),
            key=lambda v: (v[0], v[1]["id"]),
        ),
        invalid,
        len(collisions),
    )


class Observations:
    """Source witnesses and case-weighted measurements for one subject in one period."""

    def __init__(self):
        self.witnesses = {}
        self.values = defaultdict(list)
        self.latest = None

    def add(self, case, rows, value=None):
        ids = tuple(dict.fromkeys(r["id"] for r in rows))
        self.witnesses.setdefault(case, ids)
        newest = (datetime.fromisoformat(rows[-1]["timestamp"]), case, ids)
        if self.latest is None or newest > self.latest:
            self.latest = newest
        if value is not None:
            self.values[case].append((value, ids))

    def stats(self):
        return _med(
            [median(value for value, _ in rows) for rows in self.values.values()]
        )

    def sample(self):
        if self.latest is None:
            return [], []
        _, newest_case, newest_ids = self.latest
        cases = sorted(self.witnesses)
        if self.values:
            case_medians = {
                case: median(v for v, _ in rows) for case, rows in self.values.items()
            }
            center = median(case_medians.values())
            cases.sort(key=lambda c: (abs(case_medians[c] - center), c))
        chosen = list(dict.fromkeys([newest_case, *cases[:EXAMPLES]]))[:EXAMPLES]
        evidence = list(newest_ids)
        for case in chosen:
            if self.values:
                ordered = sorted(self.values[case])
                # An even-sized median interpolates the two middle durations.
                for _, ids in ordered[(len(ordered) - 1) // 2 : len(ordered) // 2 + 1]:
                    evidence.extend(ids)
            else:
                evidence.extend(self.witnesses[case])
        return chosen, list(dict.fromkeys(evidence))

    def __len__(self):
        return len(self.witnesses)


class Period:
    def __init__(self, start):
        self.start = start
        self.cases = set()
        self.events = 0
        self.closed = {}
        self.ordered_cases = 0
        self.ordered_examples = Observations()
        self.examples = Observations()
        self.variants = defaultdict(Observations)
        self.activity = defaultdict(Observations)
        self.transition = defaultdict(Observations)
        self.handoff = defaultdict(Observations)
        self.repeat = defaultdict(Observations)
        self.repeat_cases = set()
        self.handoffs = 0
        self.node_counts = Counter()
        self.edge_counts = Counter()
        self.node_evidence = {}
        self.edge_evidence = {}
        self.edge_hours = defaultdict(list)
        self.event_examples = set()

    def window(self, ident):
        return {
            "id": ident,
            "start": _iso(self.start),
            "end": _iso(self.start + WEEK) if self.start else None,
            "events": self.events,
            "cases": len(self.cases),
        }

    def metrics(self):
        size = len(self.cases)
        return {
            "events": self.events,
            "cases": size,
            "cycle_hours": _med(list(self.closed.values())),
            "handoffs_per_case": round(self.handoffs / size, 3) if size else None,
            "repeat_case_share": _ratio(len(self.repeat_cases), size),
            "variants": len(self.variants),
        }


def _source_department(row, source):
    for record in (row, source):
        for key in ("department", "owner_department", "team"):
            value = record.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip(), "observed"
    # Only infer when the source actually names an organisational function.
    tokens = set(re.findall(r"[a-z]+", row["system"].casefold()))
    for term, name in (
        ("operations", "Operations"),
        ("finance", "Finance"),
        ("billing", "Billing"),
        ("support", "Support"),
        ("warehouse", "Warehouse"),
        ("fulfilment", "Fulfilment"),
        ("fulfillment", "Fulfillment"),
        ("payroll", "Payroll"),
        ("procurement", "Procurement"),
        ("sales", "Sales"),
        ("marketing", "Marketing"),
    ):
        if term in tokens:
            return name, "inferred"
    return None, None


def _append_examples(mapping, key, evidence):
    sample = mapping.setdefault(key, [])
    if len(sample) < 8:
        sample.extend(e for e in evidence if e not in sample)


class Graph:
    def __init__(self):
        self.nodes = {}
        self.edges = {}
        self.node_cases = defaultdict(set)
        self.edge_cases = defaultdict(set)
        self.times = defaultdict(list)
        self.origins = defaultdict(set)
        self.ids = {}

    def node(self, period, kind, label, row, origin="observed", canonical_id=None):
        key = (kind, canonical_id or label)
        if key not in self.ids:
            self.ids[key] = canonical_id or f"{kind}-" + digest(*key)
        ident = self.ids[key]
        node = self.nodes.setdefault(
            ident,
            {
                "id": ident,
                "kind": kind,
                "label": label,
                "origin": origin,
                "events": 0,
                "evidence": [],
            },
        )
        self.origins[ident].add(origin)
        self.node_cases[ident].add(row["case"])
        if len(node["evidence"]) < 4 and row["id"] not in node["evidence"]:
            node["evidence"].append(row["id"])
        if period is not None:
            node["events"] += 1
            period.node_counts[ident] += 1
            _append_examples(period.node_evidence, ident, (row["id"],))
        return ident

    def edge(
        self, period, kind, source, target, case, rows, hours=None, origin="observed"
    ):
        key = (kind, source, target)
        if key not in self.ids:
            self.ids[key] = "edge-" + digest(*key)
        ident = self.ids[key]
        edge = self.edges.setdefault(
            ident,
            {
                "id": ident,
                "kind": kind,
                "source": source,
                "target": target,
                "origin": origin,
                "count": 0,
                "evidence": [],
            },
        )
        if origin == "inferred":
            edge["origin"] = "inferred"
        edge["count"] += 1
        self.edge_cases[ident].add(case)
        ids = [r["id"] for r in rows]
        if len(edge["evidence"]) < 8:
            edge["evidence"].extend(i for i in ids if i not in edge["evidence"])
        if hours is not None:
            self.times[ident].append(hours)
            period.edge_hours[ident].append(hours)
        period.edge_counts[ident] += 1
        _append_examples(period.edge_evidence, ident, ids)

    def finish(self, periods):
        # Keep each layer navigable while preserving exact counts for its visible subjects.
        by_kind = defaultdict(list)
        for node in self.nodes.values():
            ident = node["id"]
            node["cases"] = len(self.node_cases[ident])
            node["origins"] = sorted(self.origins[ident])
            if "inferred" in self.origins[ident]:
                node["origin"] = "inferred"
            by_kind[node["kind"]].append(node)
        nodes = []
        for kind, group in sorted(by_kind.items()):
            nodes.extend(
                sorted(group, key=lambda n: (-n["events"], n["label"], n["id"]))[:48]
            )
        node_ids = {n["id"] for n in nodes}
        by_kind.clear()
        for edge in self.edges.values():
            if edge["source"] in node_ids and edge["target"] in node_ids:
                edge["cases"] = len(self.edge_cases[edge["id"]])
                edge["median_hours"] = _med(self.times.get(edge["id"], []))
                by_kind[edge["kind"]].append(edge)
        edges = []
        for kind, group in sorted(by_kind.items()):
            edges.extend(sorted(group, key=lambda e: (-e["count"], e["id"]))[:80])
        edge_ids = {e["id"] for e in edges}
        epochs = []
        for p in periods:
            epoch = p.window(p.start.date().isoformat())
            ni = sorted(node_ids.intersection(p.node_counts))
            ei = sorted(edge_ids.intersection(p.edge_counts))
            # Dependencies crossing a window boundary may point to an older activity.
            endpoints = {
                x
                for e in ei
                for x in (self.edges[e]["source"], self.edges[e]["target"])
            }
            epoch.update(
                node_ids=sorted(set(ni) | endpoints),
                edge_ids=ei,
                metrics=p.metrics(),
                node_counts={n: p.node_counts[n] for n in ni},
                edge_counts={e: p.edge_counts[e] for e in ei},
                edge_median_hours={
                    e: _med(p.edge_hours[e]) for e in ei if e in p.edge_hours
                },
                node_evidence={n: p.node_evidence[n] for n in ni},
                edge_evidence={e: p.edge_evidence[e] for e in ei},
            )
            epochs.append(epoch)
        return {
            "nodes": nodes,
            "edges": edges,
            "epochs": epochs,
            "coverage": {
                "total_nodes": len(self.nodes),
                "total_edges": len(self.edges),
                "visible_nodes": len(nodes),
                "visible_edges": len(edges),
                "event_nodes": "One source event per activity per epoch, up to six per epoch.",
            },
        }


def _add_events(graph, groups, records, sources, get_period):
    for dt, row in records:
        groups[row["case"]].append((dt, row))
        p = get_period(dt)
        if p is None:
            continue
        case, activity = row["case"], row["activity"]
        p.events += 1
        p.cases.add(case)
        p.examples.add(case, (row,))
        p.activity[activity].add(case, (row,))
        if graph is None:
            continue
        process = graph.node(p, "process", activity, row)
        system = graph.node(p, "system", row["system"], row)
        graph.edge(p, "observed_in", process, system, case, (row,))
        department, origin = _source_department(row, sources.get(row.get("source"), {}))
        if department:
            owner = graph.node(p, "department", department, row, origin)
            graph.edge(p, "assigned_to", system, owner, case, (row,), origin=origin)
        if len(p.event_examples) < 6 and activity not in p.event_examples:
            p.event_examples.add(activity)
            event = graph.node(p, "event", activity, row, canonical_id=row["id"])
            graph.edge(p, "instance_of", event, process, case, (row,))


def _path_witness(rows):
    # Cover both boundaries and interior milestones while keeping the list compact.
    indexes = sorted({0, len(rows) // 3, 2 * len(rows) // 3, len(rows) - 1})
    return [rows[i][1] for i in indexes]


def _add_cases(graph, groups, get_period):
    tied_cases = 0
    for case, rows in groups.items():
        previous = None
        unambiguous = True
        seen = {}
        for dt, concurrent in groupby(rows, key=lambda pair: pair[0]):
            batch = [row for _, row in concurrent]
            p = get_period(dt)
            for row in batch:
                activity = row["activity"]
                earlier = seen.get(activity)
                if p and earlier:
                    p.repeat[activity].add(case, (earlier, row))
                    p.repeat_cases.add(case)
                seen.setdefault(activity, row)
            if len(batch) != 1:
                previous = None
                unambiguous = False
                continue
            row = batch[0]
            if previous is not None and p:
                before, first = previous
                hours = (dt - before).total_seconds() / 3600
                pair = (first["activity"], row["activity"])
                systems = (first["system"], row["system"])
                p.transition[pair].add(case, (first, row), hours)
                if graph:
                    start = graph.ids.get(("process", pair[0])) or graph.node(
                        None, "process", pair[0], first
                    )
                    graph.edge(
                        p,
                        "precedes",
                        start,
                        graph.ids[("process", pair[1])],
                        case,
                        (first, row),
                        hours,
                    )
                if systems[0] != systems[1]:
                    p.handoffs += 1
                    p.handoff[systems].add(case, (first, row))
                    if graph:
                        start = graph.ids.get(("system", systems[0])) or graph.node(
                            None, "system", systems[0], first
                        )
                        graph.edge(
                            p,
                            "handoff",
                            start,
                            graph.ids[("system", systems[1])],
                            case,
                            (first, row),
                            hours,
                        )
            previous = (dt, row)
        if not unambiguous:
            tied_cases += 1
        last = get_period(rows[-1][0])
        if last:
            last.closed[case] = (rows[-1][0] - rows[0][0]).total_seconds() / 3600
            if unambiguous:
                last.ordered_cases += 1
                path = tuple(row["activity"] for _, row in rows)
                sample = _path_witness(rows)
                last.variants[path].add(case, sample)
                last.ordered_examples.add(case, sample)
    return tied_cases


def _context(data, include_graph=True):
    records, invalid, conflicts = _records(data)
    graph = Graph() if include_graph else None
    caveats = list(CAVEATS)
    if invalid or conflicts:
        caveats.append(
            f"Excluded {invalid} unusable event rows and {conflicts} conflicting event identities."
        )
    if not records:
        return {
            "graph": graph,
            "periods": [],
            "previous": Period(None),
            "recent": Period(None),
            "as_of": None,
            "caveats": caveats,
        }
    latest = records[-1][0]
    stop = latest.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    count = max(2, min(EPOCH_LIMIT, math.ceil((stop - records[0][0]) / WEEK)))
    first = stop - count * WEEK
    periods = [Period(first + i * WEEK) for i in range(count)]

    def get_period(dt):
        index = (dt - first) // WEEK
        return periods[index] if 0 <= index < count else None

    groups = defaultdict(list)
    sources = {s["id"]: s for s in data.get("sources", [])}
    _add_events(graph, groups, records, sources, get_period)
    tied = _add_cases(graph, groups, get_period)
    if tied:
        caveats.append(
            f"{tied} cases contain simultaneous events. Their ambiguous adjacent transitions and ordered variants are excluded."
        )
    return {
        "graph": graph,
        "periods": periods,
        "previous": periods[-2],
        "recent": periods[-1],
        "as_of": _iso(latest),
        "caveats": caveats,
    }


def _windows(ctx):
    return {key: ctx[key].window(key) for key in ("previous", "recent")}


def _subject_id(kind, subject):
    return "sig-" + digest(kind, *subject)


def _examples(period, kind, subject):
    if kind == "duplicate":
        return period.activity.get(subject[0], Observations()).sample()
    if kind == "variant":
        return period.ordered_examples.sample()
    return period.examples.sample()


def _measurement(kind, subject, previous, recent):
    if kind == "latency":
        a, b = (
            period.transition.get(subject, Observations())
            for period in (previous, recent)
        )
        if min(len(a), len(b)) < MIN_SUPPORT:
            return None
        before, now = a.stats(), b.stats()
        metric = _metric(
            "transition_hours", "Median transition delay", "hours", before, now
        )
        active = now - before >= 1 and now >= before * 1.25
        title = f"{subject[0]} → {subject[1]} delay"
        method = "Median adjacent elapsed hours within each case, then median across cases. Flag increases of at least one hour and 25%."
        caveat = "Only unambiguous neighbouring event pairs are compared. Work duration and queue time are combined."
    elif kind == "variant":
        a, b = (
            period.variants.get(subject, Observations())
            for period in (previous, recent)
        )
        # Unordered cases are excluded from both numerator and denominator.
        bases = [p.ordered_cases for p in (previous, recent)]
        if min(bases) < MIN_SUPPORT:
            return None
        metric = _metric(
            "variant_share",
            "Share of observed case paths",
            "%",
            _ratio(len(a), bases[0]),
            _ratio(len(b), bases[1]),
        )
        active = not len(a) and len(b) >= MIN_SUPPORT and metric["recent"] >= 10
        path_label = " → ".join(subject[:3]) + (" → …" if len(subject) > 3 else "")
        title = f"Emerging path · {path_label}"
        method = "Compare complete observed activity sequences, attributed to the last event. Flag a previously unseen route covering at least 10% of recent paths."
        caveat = "New paths can reflect incomplete case logs, process changes or a different mix of work."
    elif kind == "duplicate":
        activity = subject[0]
        a, b = (
            period.repeat.get(activity, Observations()) for period in (previous, recent)
        )
        bases = [len(p.activity.get(activity, ())) for p in (previous, recent)]
        if bases[1] < MIN_SUPPORT:
            return None
        metric = _metric(
            "repeat_share",
            "Cases repeating this activity",
            "%",
            _ratio(len(a), bases[0]),
            _ratio(len(b), bases[1]),
        )
        active = len(b) >= MIN_SUPPORT and metric["recent"] >= 10
        title = f"Repeated activity · {activity}"
        method = "Among cases with the activity this period, count those with a second distinct occurrence during the period. Flag at 10% or higher."
        caveat = "Repeated work may be legitimate. An earlier occurrence may lie outside the comparison period."
    elif kind in ("drift", "handoff"):
        if min(len(previous.cases), len(recent.cases)) < MIN_SUPPORT:
            return None
        is_handoff = kind == "handoff"
        mapping = "handoff" if is_handoff else "activity"
        key = subject if is_handoff else subject[0]
        a, b = (
            getattr(p, mapping).get(key, Observations()) for p in (previous, recent)
        )
        before, now = (
            _ratio(len(a), len(previous.cases)),
            _ratio(len(b), len(recent.cases)),
        )
        if is_handoff:
            metric = _metric(
                "handoff_share", "Cases crossing these systems", "%", before, now
            )
            active = len(b) >= MIN_SUPPORT and metric["delta"] >= 15
            title = f"Cross-system handoff · {subject[0]} → {subject[1]}"
            method = "Compare distinct cases with the directed system crossing as a share of all active cases. Flag rises of at least 15 percentage points."
            caveat = "Two consecutive source systems show an observed crossing. They do not establish an automated integration."
        else:
            metric = _metric(
                "activity_share", "Cases containing this activity", "%", before, now
            )
            active = max(len(a), len(b)) >= MIN_SUPPORT and abs(metric["delta"]) >= 20
            title = f"Activity mix changed · {subject[0]}"
            method = "Compare distinct active cases containing the activity. Flag absolute changes of at least 20 percentage points."
            caveat = "Case mix and source coverage both affect activity shares."
    else:
        return None
    return a, b, metric, active, title, method, caveat


def _observation(ctx, kind, subject, active_only=False):
    measured = _measurement(kind, subject, ctx["previous"], ctx["recent"])
    if measured is None:
        return None
    a, b, metric, active, title, method, caveat = measured
    if active_only and not active:
        return None
    recent_cases, recent_ids = b.sample()
    previous_cases, previous_ids = a.sample()
    # To audit a zero numerator, show sampled source records in its denominator.
    if not recent_ids:
        recent_cases, recent_ids = _examples(ctx["recent"], kind, subject)
    if not previous_ids:
        previous_cases, previous_ids = _examples(ctx["previous"], kind, subject)
    counts = {"previous": len(a), "recent": len(b)}
    basis = "previous" if kind == "drift" and metric["delta"] < 0 else "recent"
    support = counts[basis]
    confidence = (
        "high"
        if support >= 10 and min(len(ctx[p].cases) for p in counts) >= 10
        else "moderate"
    )
    if kind == "latency" and min(len(a), len(b)) < 10:
        confidence = "moderate"
    before = "unavailable" if metric["previous"] is None else f"{metric['previous']:g}"
    after = f"{metric['recent']:g}"
    summary = f"{metric['label']} changed from {before} to {after} {metric['unit']}. {len(b)} recent and {len(a)} previous cases match."
    return {
        "id": _subject_id(kind, subject),
        "kind": kind,
        "title": title,
        "summary": summary,
        "active": active,
        "metric": metric,
        "subject": list(subject),
        "support": support,
        "support_period": basis,
        "support_by_window": counts,
        "confidence": confidence,
        "evidence": list(dict.fromkeys(recent_ids + previous_ids)),
        "case_ids": list(dict.fromkeys(recent_cases + previous_cases)),
        "windows": _windows(ctx),
        "as_of": ctx["as_of"],
        "evidence_by_window": {"previous": previous_ids, "recent": recent_ids},
        "case_ids_by_window": {"previous": previous_cases, "recent": recent_cases},
        "method": method,
        "caveat": caveat,
    }


def _signals(ctx):
    previous, recent = ctx["previous"], ctx["recent"]
    subjects = {
        "latency": recent.transition.keys() & previous.transition.keys(),
        "variant": recent.variants.keys() - previous.variants.keys(),
        "duplicate": [(label,) for label in recent.repeat],
        "drift": [
            (label,) for label in recent.activity.keys() | previous.activity.keys()
        ],
        "handoff": recent.handoff.keys(),
    }
    signals = []
    coverage = {}
    for kind, candidates in subjects.items():
        found = []
        for subject in candidates:
            signal = _observation(ctx, kind, subject, active_only=True)
            if signal:
                found.append(signal)
        found.sort(
            key=lambda s: (-s["support"], -abs(s["metric"]["delta"] or 0), s["id"])
        )
        signals.extend(found[:SIGNALS_PER_KIND])
        coverage[kind] = {
            "qualifying": len(found),
            "shown": min(len(found), SIGNALS_PER_KIND),
        }
    return signals, coverage


def _decision_refs(decisions):
    """Attach explicit previous decision IDs without interpreting their state as an outcome."""
    result = defaultdict(list)
    if isinstance(decisions, dict):
        decisions = decisions.get("decisions", [])
    for d in decisions or ():
        if not isinstance(d, dict):
            continue
        signal_id, ident = d.get("signal_id"), d.get("id")
        if isinstance(signal_id, str) and isinstance(ident, str):
            result[signal_id].append(ident)
    return result


def analyze_stream(data, decisions=None):
    """Project canonical records into historical topology, monitoring signals and review opportunities."""
    ctx = _context(data)
    signals, coverage = _signals(ctx)
    if any(row["qualifying"] > row["shown"] for row in coverage.values()):
        ctx["caveats"].append(
            f"Each signal category shows up to {SIGNALS_PER_KIND} subjects ranked by distinct-case support, then absolute metric change."
        )
    previous, recent = ctx["previous"].metrics(), ctx["recent"].metrics()
    prior = _decision_refs(decisions)
    opportunities = []
    for sig in signals:
        heading, action = PLAYBOOK[sig["kind"]]
        opportunities.append(
            {
                "id": "opp-" + sig["id"][4:],
                "signal_id": sig["id"],
                "title": f"{heading} · {' → '.join(sig['subject'][:2])}",
                "action": action,
                "human_control": "A process owner reviews the cited cases and approves any operational change.",
                "evidence": sig["evidence"],
                "case_ids": sig["case_ids"],
                "prior_decision_ids": sorted(set(prior[sig["id"]])),
            }
        )
    return {
        "version": 1,
        "as_of": ctx["as_of"],
        "window_days": 7,
        "min_support": MIN_SUPPORT,
        "windows": _windows(ctx),
        "metrics": [
            _metric(k, name, unit, previous[k], recent[k]) for k, name, unit in METRICS
        ],
        "signals": signals,
        "signal_coverage": coverage,
        "opportunities": opportunities,
        "graph": ctx["graph"].finish(ctx["periods"]),
        "method": METHOD,
        "caveats": ctx["caveats"],
    }


def observe_subjects(data, subjects):
    """Measure tracked subjects after recovery using the same cohorts, statistics and detectors."""
    ctx = _context(data, include_graph=False)
    observations = {}
    for item in subjects:
        if not isinstance(item, dict):
            continue
        spec = item.get("signal", item)
        if not isinstance(spec, dict):
            continue
        kind, subject = spec.get("kind"), spec.get("subject")
        if (
            not isinstance(subject, (list, tuple))
            or not subject
            or not all(isinstance(label, str) and label for label in subject)
        ):
            continue
        expected_size = {"latency": 2, "handoff": 2, "duplicate": 1, "drift": 1}
        if (
            kind not in PLAYBOOK
            or kind in expected_size
            and len(subject) != expected_size[kind]
        ):
            continue
        sample = _observation(ctx, kind, tuple(subject))
        if sample:
            observations[sample["id"]] = sample
    return observations


def observe_subject(data, decision_or_signal):
    return next(iter(observe_subjects(data, [decision_or_signal]).values()), None)
