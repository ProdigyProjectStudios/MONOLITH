/** Cross-run comparison contracts using synthetic elapsed-time and provider receipts. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const base = new URL("../apps/web/components/", import.meta.url);
const metricsUrl = new URL("observatoryMetrics.ts", base);
const hooks = registerHooks({
  resolve(name, context, next) {
    // The app bundler handles extensionless TypeScript imports. Resolve this local runtime dependency in Node's TS loader.
    return next(
      name === "./studioReceipts" && context.parentURL === metricsUrl.href
        ? new URL("studioReceipts.ts", base).href
        : name,
      context,
    );
  },
});
const { runMetrics, delta, compareRuns } = await import(metricsUrl);
hooks.deregister();
const time = (n) => new Date(1760000000000 + n).toISOString();
const event = (seq, kind, payload, at) => ({
  seq,
  kind,
  stage: "process",
  at: time(at),
  payload,
});
const liveEvents = [
  event(1, "run_started", {}, 0),
  event(
    2,
    "model_call",
    {
      call: 1,
      agent: "agent",
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      estimated_cost_usd: 0.001,
    },
    2000,
  ),
  event(
    3,
    "model_call",
    { call: 2, agent: "agent", usage: null, estimated_cost_usd: null },
    6000,
  ),
  event(4, "run_completed", {}, 6500),
];
const result = {
  selected: "queue",
  verified: true,
  findings: [{ evidence: ["EV-01", "EV-02"] }],
  trials: {
    a: {
      approach: "queue",
      currency: "GBP",
      net_savings: -4,
      projected_median: 16,
    },
  },
  package: { baseline: { cases: 2, median: 20 }, approaches: [] },
};
const evalFor = (digest, pass) => ({
  snapshot_sha256: digest,
  score: pass ? 100 : 0,
  support: { passed: Number(pass), failed: Number(!pass) },
  coverage: { percent: 100 },
  stages: [
    {
      id: "process",
      checks: [
        { id: "source", label: "Source test", status: pass ? "pass" : "fail" },
      ],
    },
  ],
});
const A = {
  run: { mode: "live", status: "completed", events: liveEvents, result },
  snapshot: { report: { events: 4, case_ids: ["A", "B"] } },
  evaluation: evalFor("abc", true),
};
const B = {
  ...A,
  run: {
    ...A.run,
    mode: "deterministic",
    events: [event(1, "run_started", {}, 0), event(2, "run_completed", {}, 50)],
  },
};
const a = runMetrics(A),
  b = runMetrics(B);
assert.equal(a.wall.value, 6.5);
assert.equal(delta(a.wall, b.wall), "+6.45 s");
assert.equal(a.tokens.value, 30);
assert.equal(a.tokens.detail, "1/2 calls");
assert.equal(a.tokens.comparable, false);
assert.equal(delta(a.tokens, a.tokens), null);
assert.equal(a.cost.comparable, false);
assert.equal(b.tokens.value, null);
assert.equal(b.cost.value, null);
assert.equal(b.calls.value, null);
assert.equal(delta(a.cost, b.cost), null);
assert.equal(delta(a.median, b.median), "No change");
assert.equal(a.forecast.value, 16);
assert.equal(a.savings.value, -4);
assert.equal(delta(a.savings, { ...a.savings, value: -10 }), "+£6.00");
assert.equal(compareRuns(A, B).sameSnapshot, true);
assert.equal(compareRuns(A, B).citationOverlap.percent, 100);
const C = {
  ...B,
  evaluation: evalFor("xyz", false),
  snapshot: { report: { events: 2, case_ids: ["A"] } },
  run: {
    ...B.run,
    result: {
      ...result,
      selected: "batch",
      findings: [{ evidence: ["EV-02", "EV-03"] }],
    },
  },
};
const d = compareRuns(A, C);
assert.equal(d.sameSnapshot, false);
assert.equal(d.decision, false);
assert.equal(d.sourceOverlap.percent, 50);
assert.equal(d.citationOverlap.shared, 1);
assert.equal(d.changedChecks[0].second, "fail");
const partial = {
  run: {
    mode: "live",
    status: "failed",
    events: [event(1, "run_started", {}, 0), event(2, "run_failed", {}, 200)],
  },
};
assert.equal(runMetrics(partial).wall.comparable, false);
assert.equal(compareRuns(partial, A).citationOverlap, null);
const ambiguous = runMetrics({
  ...A,
  run: {
    ...A.run,
    result: { ...result, trials: { a: result.trials.a, b: result.trials.a } },
  },
});
assert.equal(ambiguous.forecast.value, null);
console.log(
  "Observatory metrics passed for receipt completeness, same/changed inputs, check drift, citation overlap, modelled comparisons and incomplete runs.",
);
