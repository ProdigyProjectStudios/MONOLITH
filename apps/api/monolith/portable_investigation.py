"""Source-bound refund investigation tools shared by Python, WebAssembly and the SDK."""

from collections import Counter
from functools import wraps
from itertools import pairwise
from statistics import median

from .core import elapsed, group_cases
from .evaluation import evaluate
from .flagship import build_package, compare_reference_scenarios, simulate_scenario

STAGES = ("discovery", "process", "strategy", "architect", "simulation", "verification")
DOMAIN_TOOL = {
    "discovery": "discover_scope",
    "process": "measure_intervals",
    "strategy": "inspect_controls",
    "architect": "compare_architectures",
    "simulation": "simulate_routing",
    "verification": "audit_recommendation",
}
MODE_RULES = "deterministic"
MODE_LIVE = "live"
NEITHER = "neither"


class InvestigationError(ValueError):
    """Safe-to-display investigation rejection."""


def unique(values):
    return list(dict.fromkeys(values))


def finding(kind, text, evidence):
    return {"kind": kind, "text": text, "evidence": list(evidence)}


class Research:
    """Immutable dataset/window with per-run permission and measurement boundaries."""

    def __init__(self, data, report, search_docs=None):
        self.data, self.report = data, report
        self.package = build_package(data, report)
        self.search_docs = search_docs
        self.history = {}
        self.trials = {}
        ids = set(report["case_ids"])
        self.groups = group_cases([e for e in data["events"] if e["case"] in ids])
        self.docs = {d["id"]: d for d in data["docs"]}
        self.events = {r["id"]: r for case in self.groups.values() for r in case}
        self.pairs = []
        self.disputes = []
        prior_steps = []
        self.relevant_cases = set()
        for case, rows in self.groups.items():
            for index, (left, right) in enumerate(pairwise(rows)):
                if (
                    left["activity"].casefold() == "invoice rekeyed"
                    and right["activity"].casefold() == "refund authorised"
                ):
                    self.pairs.append((left, right))
                    prior_steps.append(
                        {r["activity"] for r in rows[max(0, index - 6) : index]}
                    )
                    self.relevant_cases.add(case)
            self.disputes.extend(
                r for r in rows if r["activity"].casefold() == "dispute reviewed"
            )
        if not self.pairs:
            raise InvestigationError(
                "The selected window contains no invoice re-entry to refund authorisation transition."
            )
        pairs_by_wait = sorted(self.pairs, key=lambda pair: elapsed(*pair))
        sample_pairs = [
            pairs_by_wait[0],
            pairs_by_wait[len(pairs_by_wait) // 2],
            pairs_by_wait[-1],
        ]
        self.sample = unique(r["id"] for pair in sample_pairs for r in pair)
        self.controls = unique(
            [r["id"] for r in self.disputes[:2]]
            + [
                doc["id"]
                for doc in data["docs"]
                if any(word in doc["text"].lower() for word in ("dispute", "refund"))
            ][:2]
            + self.sample[:2]
        )
        self.case_total = len({r["case"] for r, _ in self.pairs})
        self.median = round(median(elapsed(*pair) for pair in self.pairs), 2)
        # Compare a well-represented optional upstream step. Evidence timestamps alone cannot
        # establish that the earlier step caused a later authorisation delay.
        counts = Counter(step for steps in prior_steps for step in steps)
        optional = [
            step for step, n in counts.items() if min(n, len(prior_steps) - n) >= 2
        ]
        self.cohort_comparison = None
        if optional:
            marker = min(
                optional, key=lambda k: (abs(counts[k] - len(prior_steps) / 2), k)
            )

            def summarise(includes):
                pairs = [
                    pair
                    for steps, pair in zip(prior_steps, self.pairs)
                    if (marker in steps) == includes
                ]
                ordered = sorted(pairs, key=lambda pair: elapsed(*pair))
                exemplar = ordered[len(ordered) // 2]
                witness = [e["id"] for e in exemplar]
                if includes:
                    rows = self.groups[exemplar[0]["case"]]
                    pivot = next(
                        i for i, e in enumerate(rows) if e["id"] == exemplar[0]["id"]
                    )
                    witness.extend(
                        e["id"]
                        for e in rows[max(0, pivot - 6) : pivot]
                        if e["activity"] == marker
                    )
                return {
                    "intervals": len(pairs),
                    "median_hours": round(median(elapsed(*p) for p in pairs), 2),
                    "evidence": witness,
                }

            self.cohort_comparison = {
                "upstream_step": marker,
                "with_step": summarise(True),
                "without_step": summarise(False),
                "lookback": "Six recorded steps before invoice re-entry.",
            }

    def discover_scope(self):
        """Inspect measured workspace and refund-path coverage and representative case IDs."""
        systems = Counter(
            r["system"]
            for case in sorted(self.relevant_cases)
            for r in self.groups[case]
        )
        variants = Counter(
            tuple(r["activity"] for r in self.groups[case])
            for case in sorted(self.relevant_cases)
        )
        system_examples = {}
        for case in sorted(self.relevant_cases):
            for r in self.groups[case]:
                system_examples.setdefault(r["system"], r["id"])
        return {
            "events": len(self.events),
            "cases": len(self.groups),
            "refund_cases": self.case_total,
            "systems": dict(systems.most_common(20)),
            "total_systems": len(systems),
            "paths": [
                {"steps": list(p[:24]), "total_steps": len(p), "cases": n}
                for p, n in variants.most_common(6)
            ],
            "sample_cases": unique(self.events[e]["case"] for e in self.sample),
            "synthetic": all(e["synthetic"] for e in self.events.values()),
            "evidence": unique(
                self.sample + [system_examples[k] for k, _ in systems.most_common(20)]
            ),
        }

    def measure_intervals(self):
        """Compute wall-clock intervals from consecutive source events in individual case timelines."""
        evidence = list(self.sample)
        if self.cohort_comparison:
            for k in ("with_step", "without_step"):
                evidence.extend(self.cohort_comparison[k]["evidence"])
        return {
            "cohort_comparison": self.cohort_comparison,
            "transition": ["Invoice rekeyed", "Refund authorised"],
            "cases": self.case_total,
            "intervals": len(self.pairs),
            "median_hours": self.median,
            "min_hours": round(min(elapsed(*p) for p in self.pairs), 2),
            "max_hours": round(max(elapsed(*p) for p in self.pairs), 2),
            "source_method": self.report.get("mining", "Directly-follows"),
            "measurement": "Elapsed interval between recorded events; active handling time is unmeasured.",
            "evidence": unique(evidence),
        }

    def read_case(self, case_id: str):
        """Read a refund case timeline by its exact observed case ID."""
        if case_id not in self.relevant_cases:
            raise InvestigationError("Case outside the investigation scope.")
        rows = self.groups[case_id][:30]
        return {"case": case_id, "events": rows, "evidence": [r["id"] for r in rows]}

    def read_evidence(self, evidence_id: str):
        """Inspect a cited event row or a bounded source document excerpt."""
        rec = self.events.get(evidence_id)
        if rec and (
            rec["case"] in self.relevant_cases
            or rec["activity"].casefold() == "dispute reviewed"
        ):
            return {"record": rec, "evidence": [rec["id"]]}
        if evidence_id in self.docs:
            rec = self.docs[evidence_id]
            return {
                "record": {**rec, "text": rec["text"][:1300]},
                "evidence": [rec["id"]],
            }
        raise InvestigationError("Evidence outside the investigation scope.")

    def find_policy(self, query: str):
        """Find relevant document passages with the workspace's available retrieval method."""
        if len(query) > 180 or not query.strip():
            raise InvestigationError("Policy query must contain 1 to 180 characters.")
        if self.search_docs:
            matches = self.search_docs(query)
            method = "Frozen workspace documents · hashed lexical similarity"
        else:
            words = {w for w in query.lower().split() if len(w) > 2}
            ranked = [
                (sum(w in d["text"].lower() for w in words), d["id"])
                for d in self.docs.values()
            ]
            matches = [
                {"id": i, "score": s} for s, i in sorted(ranked, reverse=True) if s
            ]
            method = "Local term overlap"
        passages = [
            {
                **m,
                "page": self.docs[m["id"]]["page"],
                "text": self.docs[m["id"]]["text"][:850],
            }
            for m in matches
            if m["id"] in self.docs
        ][:3]
        return {
            "method": method,
            "passages": passages,
            "evidence": [m["id"] for m in passages],
        }

    def inspect_controls(self):
        """Inspect observed dispute cases and immutable platform constraints for any proposed pilot."""
        return {
            "dispute_cases": len({d["case"] for d in self.disputes}),
            "review_events": len(self.disputes),
            "refund_control": "Finance retains refund authorisation.",
            "dispute_control": "An authorised human retains every dispute decision.",
            "operating_mode": "Shadow evaluation; no external business writes.",
            "policy_excerpts": [
                self.read_evidence(i)["record"] for i in self.controls if i in self.docs
            ],
            "evidence": self.controls,
        }

    def compare_architectures(self):
        """Inspect evidence-constrained competing designs, dependencies, proposed contracts and risks."""
        fields = (
            "id",
            "name",
            "summary",
            "complexity",
            "risk",
            "dependencies",
            "nodes",
            "artifacts",
            "assumptions",
            "evidence",
        )
        plans = [
            {k: a[k] for k in fields if k in a} for a in self.package["approaches"]
        ]
        return {
            "approaches": plans,
            "evidence": unique(self.sample + [i for p in plans for i in p["evidence"]]),
        }

    def simulate_routing(
        self, approach: str, coverage: float, reduction: float, failure: float
    ):
        """Simulate a registered approach with three explicit fractions between zero and one."""
        plans = {a["id"]: a for a in self.package["approaches"]}
        if approach not in ("queue", "batch") or any(
            not 0 <= v <= 1 for v in (coverage, reduction, failure)
        ):
            raise InvestigationError(
                "Specify a registered approach and fractions in [0, 1]."
            )
        args = {
            **plans.get(approach, {}).get("assumptions", {}),
            "approach": approach,
            "coverage": coverage,
            "reduction": reduction,
            "failure": failure,
        }
        result = simulate_scenario(self.data, self.report, args)
        trial = f"{approach}-{len(self.trials) + 1}"
        self.trials[trial] = result
        return {"trial": trial, "scenario": result, "evidence": self.sample}

    def audit_recommendation(self):
        """Reconcile source case counts, median, provenance, prior claims and both scenario receipts."""
        rec = next(
            (r for r in self.report["recommendations"] if r["id"] == "refund"), {}
        )
        base = self.package["baseline"]
        sources = {s["id"] for s in self.data["sources"]}
        cited = unique(
            i
            for stage in self.history.values()
            for f in stage["findings"]
            for i in f["evidence"]
        )
        missing = [i for i in cited if i not in self.events and i not in self.docs]
        missing_sources = [
            r["id"] for pair in self.pairs for r in pair if r["source"] not in sources
        ]
        for i in cited:
            record = self.events.get(i) or self.docs.get(i)
            if record and (
                record["source"] not in sources
                or (not record.get("row") and not record.get("page"))
            ):
                missing_sources.append(i)
        evidenced = {self.trials[t]["approach"] for t in self.trials}
        checks = {
            "case_count_agrees": self.case_total == base["cases"] == rec.get("cases"),
            "median_agrees": abs(self.median - base["median"]) < 0.011
            and self.median == rec.get("hours"),
            "case_rows_have_sources": not missing_sources,
            "all_prior_citations_resolve": not missing,
            "two_approaches_evaluated": len(evidenced) >= 2,
            "eligible_case_exists": base["eligible"] > 0,
        }
        return {
            "checks": checks,
            "passed": all(checks.values()),
            "missing_evidence": missing[:10],
            "source_case_count": self.case_total,
            "source_median_hours": self.median,
            "sample_limit": "Case timestamps measure elapsed intervals. Staffing and monetary savings are assumptions.",
            "evidence": unique(self.sample + self.controls),
        }

    def snapshot(self, stage, payload):
        self.history[stage] = payload

    def finish(self):
        verdict = self.history["verification"]
        result = {
            "summary": verdict["summary"],
            "verified": verdict["verdict"] == "accept",
            "selected": verdict["selected"],
            "evidence": unique(i for h in self.history.values() for i in h["evidence"]),
            "findings": [f for h in self.history.values() for f in h["findings"]],
            "stages": self.history,
            "package": self.package,
            "comparison": compare_reference_scenarios(self.package),
            "trials": self.trials,
        }
        result["evaluation"] = evaluate(self.data, self.report, result)
        return result


class StageSession:
    """Persist the actual tool boundary so an SDK item cannot impersonate a tool receipt."""

    def __init__(self, research, stage, emit, mode):
        self.research, self.stage, self.emit, self.mode = research, stage, emit, mode
        self.calls = []
        self.seen = set()

    def start(self):
        self.emit("stage_started", self.stage, {"mode": self.mode, "stage": self.stage})

    def tool(self, name):
        fn = getattr(self.research, name)

        @wraps(fn)
        def wrapped(*args, **kwargs):
            from inspect import signature

            if len(self.calls) >= 9:
                raise InvestigationError("Specialist tool budget exhausted.")
            params = dict(signature(fn).bind(*args, **kwargs).arguments)
            sequence = len(self.calls) + 1
            self.calls.append(name)
            self.emit(
                "tool_started",
                self.stage,
                {"name": name, "input": params, "call": sequence, "mode": self.mode},
            )
            try:
                output = fn(*args, **kwargs)
            except Exception as exc:
                self.emit(
                    "tool_error",
                    self.stage,
                    {"name": name, "call": sequence, "error": type(exc).__name__},
                )
                raise
            self.seen.update(output["evidence"])
            self.emit(
                "tool_result",
                self.stage,
                {
                    "name": name,
                    "input": params,
                    "result": output,
                    "evidence": output["evidence"],
                    "call": sequence,
                    "mode": self.mode,
                },
            )
            return output

        return wrapped

    def complete(self, out):
        if DOMAIN_TOOL[self.stage] not in self.calls:
            raise InvestigationError(
                "The specialist did not execute its required investigation tool."
            )
        if not out["evidence"] or not set(out["evidence"]) <= self.seen:
            raise InvestigationError(
                "A stage cited evidence outside its own tool results."
            )
        for f in out["findings"]:
            if not f["evidence"] or not set(f["evidence"]) <= self.seen:
                raise InvestigationError(
                    "A finding cited evidence outside the specialist's tool results."
                )
        self.research.snapshot(self.stage, out)
        self.emit("stage_completed", self.stage, {**out, "mode": self.mode})
        i = STAGES.index(self.stage)
        if i < len(STAGES) - 1:
            self.emit(
                "handoff",
                self.stage,
                {
                    "from": self.stage,
                    "to": STAGES[i + 1],
                    "summary": out["summary"],
                    "evidence": out["evidence"],
                },
            )

    def fail(self, exc):
        self.emit(
            "stage_failed",
            self.stage,
            {
                "error": str(exc)
                if isinstance(exc, InvestigationError)
                else type(exc).__name__,
                "mode": self.mode,
            },
        )


def deterministic_stage(session):
    stage = session.stage
    research = session.research
    extra = {}
    if stage == "simulation":
        trials = []
        for plan in research.package["approaches"] or [
            {"id": k, "assumptions": {"coverage": 0, "reduction": 0, "failure": 0}}
            for k in ("queue", "batch")
        ]:
            assumptions = plan["assumptions"]
            result = session.tool("simulate_routing")(
                plan["id"],
                assumptions["coverage"],
                assumptions["reduction"],
                assumptions["failure"],
            )
            trials.append(result["trial"])
        e = research.sample
        text = f"Evaluated {len(trials)} shadow-routing scenarios against measured intervals. Workload and cost depend on the displayed assumptions."
        kind = "assumption"
        extra = {"trials": trials}
    else:
        result = session.tool(DOMAIN_TOOL[stage])()
        e = result["evidence"]
        kind = "observed"
        if stage == "discovery":
            text = f"Correlated {result['refund_cases']} refund cases with {result['total_systems']} observed systems in the selected window."
            extra = {
                "matched_cases": result["refund_cases"],
                "observed_systems": sorted(result["systems"]),
            }
        elif stage == "process":
            text = f"{result['cases']} cases contain {result['intervals']} adjacent refund intervals with a median of {result['median_hours']:g} hours."
            extra = {
                "median_hours": research.median,
                "matched_cases": research.case_total,
            }
        elif stage == "strategy":
            text = f"Preserve finance sign-off and human dispute decisions. The log contains {result['dispute_cases']} cases with a dispute review."
            extra = {
                "refund_authority": "finance_operator",
                "dispute_authority": "human_reviewer",
            }
            kind = "recommendation"
        elif stage == "architect":
            text = (
                "Compare "
                + " and ".join(p["name"] for p in result["approaches"])
                + " using the observed source systems and human approval boundary."
            )
            if not result["approaches"]:
                text = "All matched cases require a dispute hold. Keep the existing human review workflow."
            kind = "recommendation"
            extra = {"alternatives": [p["id"] for p in result["approaches"]]}
        elif stage == "verification":
            options = sorted(
                research.trials.values(),
                key=lambda v: (v["projected_median"], -v["net_savings"], v["approach"]),
            )
            selected = options[0]["approach"] if result["passed"] else NEITHER
            text = (
                f"Reconciled the measured {research.median:g}-hour median with source rows. The {selected} shadow pilot has the lowest projected median under these inputs. Validate handling time and cost before rollout."
                if result["passed"]
                else "Source reconciliation or control checks failed. Hold the pilot for evidence review."
            )
            kind = "recommendation" if result["passed"] else "limitation"
            extra = {
                "verdict": "accept" if result["passed"] else "reject",
                "selected": selected,
                "checks": result["checks"],
            }
    findings = [finding(kind, text, e)]
    if stage == "process":
        comparison = research.cohort_comparison
        if comparison:
            a, b = comparison["with_step"], comparison["without_step"]
            findings.append(
                finding(
                    "observed",
                    f"The median following {comparison['upstream_step']} was {a['median_hours']:g}h across {a['intervals']} intervals. The {b['intervals']} intervals without that earlier step had a {b['median_hours']:g}h median.",
                    a["evidence"] + b["evidence"],
                )
            )
        findings.append(
            finding(
                "hypothesis",
                "Review-queue waiting may account for part of the interval. Queue admission and reviewer start timestamps would test this explanation.",
                e[:2],
            )
        )
    return {"summary": text, "evidence": e, "findings": findings, **extra}


def investigate_deterministic(data, report, emit, search_docs=None):
    research = Research(data, report, search_docs)
    for stage in STAGES:
        session = StageSession(research, stage, emit, MODE_RULES)
        session.start()
        try:
            session.complete(deterministic_stage(session))
        except Exception as exc:
            session.fail(exc)
            raise
    return research.finish()
