import type { InvestigationRun, RunEvent } from "../lib/investigations";
type Json = Record<string, unknown>;
export const object = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const numeric = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
export const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 0.00001 ? 10 : 6,
  });
export const format = (n: number) => n.toLocaleString("en-GB");

export function duration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
export function elapsed(start: string | undefined, end: string | undefined) {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
function callKey(e: RunEvent) {
  return [e.stage, e.payload.agent, e.payload.reviewer, e.payload.call].join(
    "/",
  );
}
export function modelCalls(events: RunEvent[]) {
  const calls = events.filter((e) => e.kind === "model_call");
  const ended = new Set(calls.map(callKey));
  const pending = events.filter(
    (e) => e.kind === "model_call_started" && !ended.has(callKey(e)),
  );
  return { calls, pending };
}
export function metering(calls: RunEvent[]) {
  let input = 0,
    output = 0,
    tracked = 0,
    total = 0,
    breakdown = 0,
    priced = 0,
    cost = 0;
  for (const c of calls) {
    const u = object(c.payload.usage);
    const i = numeric(u.input_tokens),
      o = numeric(u.output_tokens),
      p = numeric(c.payload.estimated_cost_usd);
    const counted =
      numeric(u.total_tokens) ?? (i !== null && o !== null ? i + o : null);
    if (counted !== null) {
      tracked++;
      total += counted;
      if (i !== null && o !== null) {
        input += i;
        output += o;
        breakdown++;
      }
    }
    if (p !== null) {
      cost += p;
      priced++;
    }
  }
  return { input, output, total, tracked, breakdown, priced, cost };
}

export type Review = {
  reviewer: string;
  preferred: string;
  rationale: string;
  confidence: string;
  confidenceBasis: string;
  rejected: string[];
  constraints: string[];
  evidence: string[];
  tradeoffs: {
    approach: string;
    benefit: string;
    risk: string;
    rejectionReason: string;
    evidence: string[];
  }[];
};
function review(payload: Json): Review | null {
  const reviewer = str(payload.reviewer);
  if (!reviewer) return null;
  return {
    reviewer,
    preferred: str(payload.preferred),
    rationale: str(payload.rationale),
    confidence: str(payload.confidence),
    confidenceBasis: str(payload.confidence_basis),
    rejected: strings(payload.rejected),
    constraints: strings(payload.constraints),
    evidence: strings(payload.evidence),
    tradeoffs: Array.isArray(payload.tradeoffs)
      ? payload.tradeoffs.map((item) => {
          const row = object(item);
          return {
            approach: str(row.approach),
            benefit: str(row.benefit),
            risk: str(row.risk),
            rejectionReason: str(row.rejection_reason),
            evidence: strings(row.evidence),
          };
        })
      : [],
  };
}
export function latestAssessment(events: RunEvent[]) {
  const adopted = new Map<string, Review>();
  let disagreement: boolean | undefined, verification: Json | undefined;
  for (const e of events) {
    if (e.kind === "architecture_assessment") {
      const r = review(e.payload);
      if (r) adopted.set(r.reviewer, r);
    } else if (e.kind === "architecture_debate") {
      if (typeof e.payload.disagreement === "boolean")
        disagreement = e.payload.disagreement;
      if (Array.isArray(e.payload.assessments))
        for (const raw of e.payload.assessments) {
          const r = review(object(raw));
          if (r) adopted.set(r.reviewer, r);
        }
    } else if (e.kind === "stage_completed" && e.stage === "verification") {
      verification = e.payload;
    }
  }
  return { reviews: [...adopted.values()], disagreement, verification };
}
export function approvedDesigns(run: InvestigationRun): Set<string> | null {
  const verification = run.events.findLast(
    (e) => e.kind === "stage_completed" && e.stage === "verification",
  )?.payload;
  return Array.isArray(verification?.eligible_designs)
    ? new Set(strings(verification.eligible_designs))
    : null;
}

export function investigationEngine(
  run: InvestigationRun,
  events = run.events,
) {
  if (run.mode === "deterministic") return "Deterministic investigation";
  const receipts = events.filter((e) => e.kind === "model_call");
  if (receipts.some((e) => e.payload.provider === "test-fixture"))
    return "SDK protocol fixture";
  if (receipts.some((e) => e.payload.provider === "openai-compatible"))
    return "OpenAI-compatible provider";
  if (
    receipts.some(
      (e) =>
        e.payload.provider === "openai" && e.payload.status === "completed",
    )
  )
    return "OpenAI investigation";
  return "AI mode · no completed provider receipt";
}
