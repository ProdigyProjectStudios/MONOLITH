import type { InvestigationRun } from "../lib/investigations";
import type { State } from "../lib/types";
import {
  elapsed,
  metering,
  modelCalls,
  investigationEngine,
} from "./studioReceipts";

export type Verdict = "pass" | "review" | "fail";
export type Check = {
  id: string;
  label: string;
  status: Verdict;
  expected: unknown;
  actual: unknown;
  evidence: string[];
};
export type Coverage = {
  findings: number;
  covered: number;
  percent: number | null;
  unique_evidence: number;
};
export type HumanControl = {
  status: Verdict | "not_applicable";
  detail: string;
  evidence: string[];
};
export type EvaluationStage = {
  id: string;
  status: Verdict;
  score: number | null;
  coverage: Coverage;
  checks: Check[];
  finding_audits?: {
    index: number;
    kind: string | null;
    text: string;
    citation_status: "resolved" | "unresolved" | "missing";
    evidence: string[];
    unresolved: string[];
    interpretation: string;
  }[];
  weaknesses: string[];
  disagreements: string[];
  human_control: HumanControl;
};
export type RunEvaluation = {
  version: number;
  method: string;
  snapshot_sha256: string;
  status: Verdict;
  score: number | null;
  coverage: Coverage;
  stages: EvaluationStage[];
  weaknesses: string[];
  disagreements: string[];
  human_control: HumanControl;
  support: { passed: number; failed: number; review: number };
};
export type Observation = {
  run: InvestigationRun;
  snapshot?: State;
  evaluation?: RunEvaluation;
  error?: string;
};
export type Measurement = {
  value: number | null;
  unit: string;
  detail?: string;
  comparable: boolean;
};
export const names: Record<string, string> = {
  discovery: "Discovery",
  process: "Process intelligence",
  strategy: "Automation strategy",
  architect: "Solutions architect",
  simulation: "Simulation",
  verification: "Verification",
};
const measured = (
  value: number | null | undefined,
  unit: string,
  detail?: string,
  comparable = true,
): Measurement => ({
  value: typeof value === "number" && Number.isFinite(value) ? value : null,
  unit,
  detail,
  comparable,
});
export function runMetrics({ run, snapshot, evaluation }: Observation) {
  const events = run.events,
    { calls, pending } = modelCalls(events),
    tokens = metering(calls);
  const end = events.find((e) =>
    ["run_completed", "run_failed", "run_interrupted"].includes(e.kind),
  )?.at;
  const started = events.find((e) => e.kind === "run_started")?.at;
  const wall = elapsed(started, end);
  const tools = events.filter((e) => e.kind === "tool_result").length;
  const handoffs = events.filter((e) => e.kind === "handoff").length;
  const provider = run.mode === "live",
    complete = run.status === "completed";
  const reported = (n: number) =>
    n
      ? `${n}/${calls.length + pending.length} calls`
      : provider
        ? "Unavailable"
        : "No provider execution";
  const schema = run.result?.package.baseline;
  const chosen = Object.values(run.result?.trials || {}).filter(
    (t) => t.approach === run.result?.selected,
  );
  // A live specialist may run sensitivity trials. An ambiguous choice has no single comparable forecast.
  const trial = chosen.length === 1 ? chosen[0] : undefined;
  const referenceLabel =
    chosen.length > 1
      ? "Multiple trials for selected design"
      : "Modelled scenario";
  return {
    matched: measured(schema?.cases, "cases"),
    median: measured(schema?.median, "h"),
    events: measured(snapshot?.report.events, "events"),
    forecast: measured(trial?.projected_median, "h", referenceLabel),
    savings: measured(
      trial?.net_savings,
      trial?.currency || "GBP",
      referenceLabel,
    ),
    checks: measured(
      evaluation?.score,
      "%",
      evaluation
        ? `${evaluation.support.passed}/${evaluation.support.passed + evaluation.support.failed} testable checks`
        : undefined,
    ),
    coverage: measured(evaluation?.coverage.percent, "%"),
    wall: measured(
      wall == null ? null : wall / 1000,
      "s",
      wall === null ? "Terminal timing unavailable" : undefined,
      complete,
    ),
    calls: measured(
      provider && calls.length ? calls.length : null,
      "calls",
      provider
        ? pending.length
          ? `${pending.length} pending`
          : undefined
        : "No provider execution",
      complete && !pending.length,
    ),
    tokens: measured(
      provider && tokens.tracked ? tokens.total : null,
      "tokens",
      reported(tokens.tracked),
      complete &&
        tokens.tracked > 0 &&
        tokens.tracked === calls.length &&
        !pending.length,
    ),
    cost: measured(
      provider && tokens.priced ? tokens.cost : null,
      "USD",
      reported(tokens.priced),
      complete &&
        tokens.priced > 0 &&
        tokens.priced === calls.length &&
        !pending.length,
    ),
    tools: measured(tools, "tools", "Completed receipts", complete),
    handoffs: measured(handoffs, "handoffs", "Recorded transfers", complete),
  };
}
export type Metric = keyof ReturnType<typeof runMetrics>;
export const metricLabels: Record<Metric, string> = {
  matched: "Refund cases",
  median: "Median refund interval",
  events: "Source events in window",
  forecast: "Projected median · selected design",
  savings: "Modelled net savings · selected design",
  checks: "Objective checks passed",
  coverage: "Findings with evidence",
  wall: "Execution time",
  calls: "Provider call receipts",
  tokens: "Reported tokens",
  cost: "Estimated provider cost",
  tools: "Tool results",
  handoffs: "Stage handoffs",
};
export function display(m: Measurement) {
  if (m.value === null) return "Unavailable";
  if (m.unit === "USD" || m.unit === "GBP")
    return m.value.toLocaleString(m.unit === "USD" ? "en-US" : "en-GB", {
      style: "currency",
      currency: m.unit,
      minimumFractionDigits: 2,
      maximumFractionDigits: m.value > 0 && m.value < 0.00001 ? 10 : 6,
    });
  const value = m.value.toLocaleString("en-GB", {
    maximumFractionDigits: m.unit === "s" ? 3 : 2,
  });
  return (
    value +
    (m.unit === "%" ? "%" : ["h", "s"].includes(m.unit) ? " " + m.unit : "")
  );
}
export function delta(a: Measurement, b: Measurement) {
  if (
    a.value == null ||
    b.value == null ||
    a.unit !== b.unit ||
    !a.comparable ||
    !b.comparable
  )
    return null;
  const d = a.value - b.value;
  if (Math.abs(d) < 1e-12) return "No change";
  const v = display({ ...a, value: Math.abs(d) });
  return (d > 0 ? "+" : "−") + (a.unit === "%" ? v.replace("%", " pp") : v);
}
export function cited(run: InvestigationRun) {
  return new Set(run.result?.findings.flatMap((f) => f.evidence) || []);
}
function overlap(left: Set<string>, right: Set<string>) {
  const shared = [...left].filter((v) => right.has(v)).length;
  const total = left.size + right.size - shared;
  return { shared, total, percent: total ? (100 * shared) / total : null };
}
export function compareRuns(a: Observation, b: Observation) {
  const afp = a.evaluation?.snapshot_sha256,
    bfp = b.evaluation?.snapshot_sha256;
  const sameSnapshot = afp && bfp ? afp === bfp : null;
  const verified =
    a.run.result && b.run.result
      ? a.run.result.verified === b.run.result.verified
      : null;
  const decision =
    a.run.result && b.run.result
      ? a.run.result.selected === b.run.result.selected
      : null;
  const ae = a.evaluation,
    be = b.evaluation;
  const changedChecks =
    ae && be
      ? ae.stages.flatMap((stage) => {
          const prev = be.stages.find((s) => s.id === stage.id);
          return stage.checks.flatMap((c) => {
            const other = prev?.checks.find((x) => x.id === c.id);
            return other && other.status !== c.status
              ? [
                  {
                    stage: stage.id,
                    label: c.label,
                    first: c.status,
                    second: other.status,
                  },
                ]
              : [];
          });
        })
      : [];
  const sourceOverlap =
    a.snapshot && b.snapshot
      ? overlap(
          new Set(a.snapshot.report.case_ids),
          new Set(b.snapshot.report.case_ids),
        )
      : null;
  return {
    sameSnapshot,
    verified,
    decision,
    changedChecks,
    sourceOverlap,
    citationOverlap:
      a.run.result && b.run.result ? overlap(cited(a.run), cited(b.run)) : null,
  };
}
export function selectedName(run: InvestigationRun) {
  if (!run.result) return "Decision unavailable";
  return (
    run.result.package.approaches.find((a) => a.id === run.result?.selected)
      ?.name ||
    (run.result.selected === "neither"
      ? "Hold both designs"
      : run.result.selected)
  );
}
export function recordedModels(run: InvestigationRun) {
  return [
    ...new Set(
      run.events
        .filter((e) => e.kind === "model_call")
        .map((e) => e.payload.model)
        .filter((s): s is string => typeof s === "string" && !!s),
    ),
  ];
}
export function runLabel(run: InvestigationRun) {
  const time = new Date(run.created);
  const date = Number.isNaN(time.getTime())
    ? "Time unavailable"
    : time.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC";
  const mode = investigationEngine(run);
  return `${date} · ${mode} · ${run.id.slice(-7)}`;
}
