/** Reconcile the relief, history and displayed median witnesses to raw case events. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReliefHistory } from "../apps/web/components/relief/model.ts";
import { makeReliefMesh } from "../apps/web/components/relief/surface.ts";
import {
  intermediate,
  projectSections,
} from "../apps/web/components/relief/raster.ts";

const { report, data } = JSON.parse(
  await readFile(new URL("../apps/web/public/demo.json", import.meta.url)),
);
const sourceById = new Map(data.events.map((row) => [row.id, row]));
const history = buildReliefHistory(report, data.events);
assert.equal(history.report.count, report.events);
assert.equal(
  history.bars.reduce((a, b) => a + b, 0),
  report.events,
);
assert.deepEqual(history.peaks, ["CRM", "Support", "Operations", "Finance"]);
for (const frame of [history.report, ...history.windows]) {
  const windowRows = data.events.filter(
    (row) =>
      Date.parse(row.timestamp) >= frame.start &&
      Date.parse(row.timestamp) < frame.end,
  );
  assert.equal(frame.count, windowRows.length);
  for (const system of frame.systems) {
    assert.equal(
      system.count,
      windowRows.filter((row) => row.system === system.name).length,
    );
    assert.ok(system.witnesses.every((row) => row === sourceById.get(row.id)));
  }
  assert.equal(
    frame.systems.reduce((n, s) => n + s.arrivals, 0),
    frame.systems.reduce((n, s) => n + s.departures, 0),
  );
}
const finance = history.report.systems.find((s) => s.name === "Finance");
assert.equal(finance.wait, report.bottlenecks[0].hours);
assert.equal(finance.interval.count, 132);
assert.deepEqual(finance.interval, {
  from: "Invoice rekeyed",
  to: "Refund authorised",
  count: 132,
});
const observed = [];
for (let i = 0; i < finance.witnesses.length; i += 2) {
  const [before, after] = finance.witnesses.slice(i, i + 2);
  assert.equal(before.case, after.case);
  observed.push(
    (Date.parse(after.timestamp) - Date.parse(before.timestamp)) / 3_600_000,
  );
}
assert.equal(
  Number((observed.reduce((a, b) => a + b, 0) / observed.length).toFixed(2)),
  finance.wait,
);
const restricted = { ...report, case_ids: [report.case_ids[0]] };
const subset = buildReliefHistory(restricted, data.events);
assert.equal(
  subset.report.count,
  data.events.filter((r) => r.case === restricted.case_ids[0]).length,
);
assert.ok(
  subset.report.systems
    .flatMap((s) => s.witnesses)
    .every((row) => row.case === restricted.case_ids[0]),
);
const empty = buildReliefHistory({ ...report, systems: [], case_ids: [] }, []);
assert.equal(empty.windows.length, 0);
assert.deepEqual(empty.peaks, []);
const flow = makeReliefMesh(history, history.report, "flow", true);
const volume = makeReliefMesh(history, history.report, "volume", true);
const firstDay = makeReliefMesh(history, history.windows[0], "flow", true);
assert.deepEqual(
  flow.anchors.filter((a) => a.warm).map((a) => a.name),
  ["Finance"],
);
assert.ok(volume.anchors.every((a) => !a.warm));
const start = projectSections(flow, 180),
  end = projectSections(volume, 180),
  historic = projectSections(firstDay, 180);
assert.ok(start.top.some((point, i) => Math.abs(point - end.top[i]) > 0.12));
assert.ok(
  start.top.some((point, i) => Math.abs(point - historic.top[i]) > 0.12),
);
const mid = intermediate(start, end, 0.5);
assert.ok(
  mid.top.every(
    (value, i) => Math.abs(value - (start.top[i] + end.top[i]) / 2) < 1e-6,
  ),
);
console.log(
  "Overview relief reconciled source counts, transfer totals, median witness rows, case scoping, 31 historical frames and geometry in both encodings.",
);
