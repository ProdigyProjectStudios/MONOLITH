/** Exercise the graph controls against the canonical backlog and recovery projections. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  epochRelationships,
  evidenceEpoch,
  relationshipTrend,
  visibleFlows,
} from "../apps/web/lib/graphHistory.ts";

const api = fileURLToPath(new URL("../apps/api/", import.meta.url));
const projection = JSON.parse(
  execFileSync(
    api + ".venv/bin/python",
    [
      "-c",
      `
import json
from monolith.continuous_engine import analyze_stream
from monolith.continuous_fixture import WAVES, fixture_csv
from monolith.core import merge, parse_csv
from monolith.seed import make_seed
data = make_seed()
out = {}
for wave, (_, filename) in WAVES.items():
    source, rows = parse_csv(fixture_csv(wave), filename, synthetic=True)
    data = merge(data, source, rows)
    out[wave] = analyze_stream(data)
out["events"] = data["events"]
print(json.dumps(out))
`,
    ],
    { cwd: api, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  ),
);

const times = new Map(
  projection.events.map((event) => [event.id, Date.parse(event.timestamp)]),
);
for (const [wave, analysis] of Object.entries(projection).filter(
  ([key]) => key !== "events",
)) {
  const { edges, nodes, epochs } = analysis.graph;
  const labels = new Map(nodes.map((node) => [node.id, node.label]));
  const current = epochs.at(-1);
  const process = epochRelationships(edges, current, "precedes");
  const refund = process.find(
    (edge) =>
      labels.get(edge.source) === "Invoice rekeyed" &&
      labels.get(edge.target) === "Refund authorised",
  );
  assert.ok(refund);
  assert.deepEqual(
    relationshipTrend(epochs, refund.id),
    epochs.map((epoch) => epoch.edge_counts[refund.id] || 0),
  );
  assert.equal(current.edge_counts[refund.id], 42);
  const interval = current.edge_median_hours[refund.id];
  if (wave === "backlog") assert.ok(interval > 65);
  else assert.ok(interval > 23 && interval < 31);

  // Selecting a lower-ranked relationship must keep its actual line available in the bounded visual.
  assert.ok(process.length > 7);
  assert.equal(
    visibleFlows(process, process.at(-1).id, 7).at(-1).id,
    process.at(-1).id,
  );
  assert.equal(visibleFlows(process, "", 7).length, 7);

  const currentHandoffs = epochRelationships(edges, current, "handoff");
  const billing = currentHandoffs.find(
    (edge) => labels.get(edge.target) === "Billing desk",
  );
  assert.ok(billing);
  assert.equal(current.edge_counts[billing.id], wave === "backlog" ? 33 : 2);
  for (const id of current.edge_evidence[billing.id]) assert.ok(times.has(id));
  for (const signal of analysis.signals)
    assert.ok(evidenceEpoch(epochs, signal.evidence, times));
  const boundary = new Map([
    ["first", Date.parse(current.start)],
    ["outside", Date.parse(current.end)],
  ]);
  assert.equal(evidenceEpoch(epochs, ["first"], boundary), current.id);
  assert.equal(evidenceEpoch(epochs, ["outside"], boundary), undefined);
}
console.log(
  "Graph history passed across backlog and recovery, including exact epoch counts, intervals, source IDs, boundaries and selected relationship visibility.",
);
