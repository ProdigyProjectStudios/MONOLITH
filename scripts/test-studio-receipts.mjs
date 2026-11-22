/** Isolated trace-contract regression tests. These records are synthetic SDK receipt fixtures. */
import assert from "node:assert/strict";
import {
  approvedDesigns,
  elapsed,
  latestAssessment,
  investigationEngine,
  metering,
  modelCalls,
} from "../apps/web/components/studioReceipts.ts";
const event = (seq, kind, payload = {}, stage = "architect") => ({
  seq,
  kind,
  stage,
  payload,
  at: new Date(seq * 1000).toISOString(),
});
const start = (who) => ({ agent: who, reviewer: who, call: 1 });
const input = {
  input_tokens: 100,
  output_tokens: 25,
  total_tokens: 125,
  cached_input_tokens: 30,
};
const rows = [
  event(1, "model_call_started", start("reliability")),
  event(2, "model_call_started", start("operations")),
  event(3, "model_call", {
    ...start("reliability"),
    usage: input,
    estimated_cost_usd: 0.001,
  }),
];
const { calls, pending } = modelCalls(rows);
assert.equal(pending.length, 1);
assert.equal(pending[0].payload.reviewer, "operations");
assert.deepEqual(metering(calls), {
  input: 100,
  output: 25,
  total: 125,
  tracked: 1,
  breakdown: 1,
  priced: 1,
  cost: 0.001,
});
const partial = [
  ...calls,
  event(4, "model_call", { usage: null, estimated_cost_usd: null }),
  event(5, "model_call", {
    usage: { total_tokens: 76 },
    estimated_cost_usd: null,
  }),
];
assert.deepEqual(metering(partial), {
  input: 100,
  output: 25,
  total: 201,
  tracked: 2,
  breakdown: 1,
  priced: 1,
  cost: 0.001,
});
assert.equal(
  metering([
    event(6, "model_call", {
      usage: { input_tokens: 0, output_tokens: 0 },
      estimated_cost_usd: 0,
    }),
  ]).tracked,
  1,
);
assert.equal(elapsed(rows[0].at, rows[2].at), 2000);
assert.equal(elapsed(rows[2].at, rows[0].at), null);
const reliability = {
  reviewer: "reliability",
  preferred: "batch",
  confidence: "medium",
  confidence_basis: "The inspected row lacks a durable acknowledgement.",
  rationale: "Reconciliation requires a replayable source.",
  evidence: ["EV-test"],
  rejected: ["queue"],
  tradeoffs: [],
  constraints: [],
};
const operations = {
  ...reliability,
  reviewer: "operations",
  preferred: "queue",
  rejected: [],
};
const history = [
  event(7, "architecture_assessment", reliability),
  event(8, "architecture_assessment", operations),
  event(9, "architecture_debate", {
    assessments: [reliability, operations],
    disagreement: true,
  }),
  event(
    10,
    "stage_completed",
    {
      eligible_designs: ["batch"],
      rejected_designs: ["queue"],
      verdict: "accept",
    },
    "verification",
  ),
];
assert.equal(latestAssessment(history.slice(0, 1)).disagreement, undefined);
assert.equal(latestAssessment(history.slice(0, 2)).verification, undefined);
const debate = latestAssessment(history);
assert.equal(debate.reviews.length, 2);
assert.equal(debate.reviews[0].confidenceBasis, reliability.confidence_basis);
assert.deepEqual(debate.reviews[0].evidence, reliability.evidence);
assert.equal(debate.disagreement, true);
assert.deepEqual([...approvedDesigns({ events: history })], ["batch"]);
assert.equal(approvedDesigns({ events: [] }), null);
assert.deepEqual(
  [
    ...approvedDesigns({
      events: [
        event(11, "stage_completed", { eligible_designs: [] }, "verification"),
      ],
    }),
  ],
  [],
);
console.log(
  "Studio receipt checks passed for partial metering, reviewer identity, replay isolation and design vetoes.",
);

assert.equal(
  investigationEngine({ mode: "live", events: [] }),
  "AI mode · no completed provider receipt",
);
assert.equal(
  investigationEngine({
    mode: "live",
    events: [
      event(1, "model_call", { provider: "test-fixture", status: "completed" }),
    ],
  }),
  "SDK protocol fixture",
);
assert.equal(
  investigationEngine({
    mode: "live",
    events: [event(1, "model_call", { provider: "openai", status: "failed" })],
  }),
  "AI mode · no completed provider receipt",
);
assert.equal(
  investigationEngine({
    mode: "live",
    events: [
      event(1, "model_call", { provider: "openai", status: "completed" }),
    ],
  }),
  "OpenAI investigation",
);
