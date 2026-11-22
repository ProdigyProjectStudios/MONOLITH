/** Reconcile field quantities with source events, then verify view transforms separately. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assemble, indexWorkspace } from "../apps/web/lib/twinField.ts";
import {
  at,
  focused,
  homeCamera,
  makeScene,
  screen,
  zoomAt,
} from "../apps/web/components/field/scene.ts";

const seed = JSON.parse(
  await readFile(new URL("../apps/web/public/demo.json", import.meta.url)),
);
const index = indexWorkspace(seed);
const graph = assemble(seed, index, "Systems", "", "");
const included = new Set(seed.report.case_ids);
const cases = Map.groupBy(
  seed.data.events.filter((e) => included.has(e.case)),
  (e) => e.case,
);
const traffic = new Map();
const volume = new Map();
for (const events of cases.values()) {
  events.sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );
  events.forEach((e, i) => {
    volume.set(e.system, 1 + (volume.get(e.system) ?? 0));
    if (!i || events[i - 1].system === e.system) return;
    const key = JSON.stringify([
      "system:" + events[i - 1].system,
      "system:" + e.system,
    ]);
    traffic.set(key, 1 + (traffic.get(key) ?? 0));
  });
}
for (const node of graph.nodes)
  assert.equal(node.data.count, volume.get(node.data.system));
assert.equal(graph.edges.length, traffic.size);
for (const edge of graph.edges) {
  assert.equal(
    edge.count,
    traffic.get(JSON.stringify([edge.source, edge.target])),
  );
  assert.ok(edge.data.evidence.length >= 2);
  const [a, b] = edge.data.evidence.map((id) => index.records.get(id));
  assert.equal(a.case, b.case);
  assert.equal("system:" + a.system, edge.source);
  assert.equal("system:" + b.system, edge.target);
}
const systems = graph.nodes.map((n) => ({
  id: n.id,
  name: n.data.title,
  count: n.data.count,
}));
function near(a, b) {
  assert.ok(Math.abs(a - b) < 1e-6, a + " differs from " + b);
}
for (const [width, height] of [
  [1080, 480],
  [390, 360],
]) {
  const s = makeScene(systems, graph.edges, width, height);
  assert.equal(s.nodes.length, volume.size);
  assert.equal(s.routes.length, traffic.size);
  const anchor = { x: 85, y: 92 };
  const zoomed = zoomAt(homeCamera, 1.8, anchor, s);
  near(screen(anchor, s, zoomed).x, anchor.x);
  near(screen(anchor, s, zoomed).y, anchor.y);
  for (const route of s.routes) {
    const start = at(route, 0),
      end = at(route, 1);
    near(start.x, route.a.x);
    near(end.y, route.d.y);
    const mid = screen(at(route, 0.5), s, focused(route.key, s));
    near(mid.x, width / 2);
    near(mid.y, height / 2);
  }
  for (const n of s.nodes) {
    const target = screen(n, s, focused(n.key, s));
    near(target.x, width / 2);
    near(target.y, height / 2);
  }
  assert.equal(makeScene([], [], width, height).routes.length, 0);
}
console.log(
  "Field projection passed: system volumes, directed counts and cited handoffs reconciled to the seed; desktop and mobile zoom, route direction and focus checked.",
);
