import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  indexJourneys,
  intervalHours,
  journeyStages,
} from "../apps/web/lib/journey.ts";

const seed = JSON.parse(
  await readFile(new URL("../apps/web/public/demo.json", import.meta.url)),
);
const paths = indexJourneys(seed.data.events, seed.report.case_ids);
assert.equal(paths.size, seed.report.variants);
for (const variant of seed.report.paths) {
  const cases = paths.get(JSON.stringify(variant.steps));
  assert.equal(cases.length, variant.count);
  for (const c of cases) {
    assert.deepEqual(
      c.rows.map((e) => e.activity),
      variant.steps,
    );
    assert.ok(c.rows.every((e) => e.case === c.id));
  }
}
const normal = seed.report.paths.find(
  (p) =>
    p.steps.includes("Refund authorised") &&
    !p.steps.includes("Details requested"),
);
const cases = paths.get(JSON.stringify(normal.steps));
const refundStep = normal.steps.indexOf("Refund authorised");
// Independently calculated from the timestamps of the 112-case standard path.
// The whole-workspace refund median includes another 20 cases on a different path.
assert.equal(cases.length, 112);
assert.equal(
  journeyStages(normal.steps, cases)[refundStep].median.toFixed(2),
  "31.80",
);
assert.equal(
  seed.report.recommendations.find((r) => r.id === "refund").hours,
  31.15,
);

const arrivals = [
  {
    id: "4",
    case: "included",
    activity: "Done",
    timestamp: "2026-11-01T03:00:00Z",
    system: "Finance",
  },
  {
    id: "2",
    case: "outside",
    activity: "Queued",
    timestamp: "2026-10-01T00:00:00Z",
    system: "Support",
  },
  {
    id: "3",
    case: "included",
    activity: "Queued",
    timestamp: "2026-11-01T01:00:00Z",
    system: "Support",
  },
];
const scoped = indexJourneys(arrivals, ["included"]);
assert.equal(scoped.size, 1);
const route = scoped.get(JSON.stringify(["Queued", "Done"]));
assert.deepEqual(
  route[0].rows.map((row) => row.id),
  ["3", "4"],
);
assert.equal(intervalHours(route[0].rows, 0), null);
assert.equal(intervalHours(route[0].rows, 1), 2);
assert.deepEqual(
  journeyStages(["Queued", "Done"], route).map((s) => s.median),
  [null, 2],
);
assert.equal(indexJourneys(arrivals, []).size, 0);
console.log(
  "Process journeys passed: exact path membership, source pairs, scoped records and per-transition medians.",
);
