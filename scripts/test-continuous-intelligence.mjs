/**
 * Verify continuous monitoring, durable decisions and graph history against two opt-in
 * synthetic weeks. Run npm run build first. Supply QA_SCREENSHOT_DIR to save evidence.
 * The API, Redis, database and browser storage are isolated. No live credentials are inherited.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startRuntime } from "./observatory-test-runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = process.env.QA_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const stack = await startRuntime();
const { web, api, token, other } = stack;
let browser;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const stages = [
  "discovery",
  "process",
  "strategy",
  "architect",
  "simulation",
  "verification",
];
const snapshots = {};
async function endpoint(
  route,
  { method = "GET", credential = token, body } = {},
) {
  return fetch(api + "/api/" + route, {
    method,
    headers: {
      ...(credential ? { Authorization: "Bearer " + credential } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
}
async function get(route, options) {
  const res = await endpoint(route, options);
  assert.ok(
    res.ok,
    route +
      " returned " +
      res.status +
      ": " +
      (!res.ok ? await res.text() : ""),
  );
  return res.json();
}
async function ready(minimum, reason, credential = token) {
  let v;
  for (let i = 0; i < 240; i++) {
    v = await get("continuous", { credential });
    if (v.monitor.status === "failed")
      throw Error("Monitor failed (" + reason + "): " + v.monitor.error);
    if (
      v.snapshot?.revision >= minimum &&
      v.monitor.status === "current" &&
      v.monitor.pending === 0
    )
      return v;
    await pause(250);
  }
  throw Error(
    "Monitor did not settle (" + reason + "): " + JSON.stringify(v?.monitor),
  );
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
function refundMedian(rows, period) {
  const cases = new Map();
  for (const row of rows) {
    if (!cases.has(row.case)) cases.set(row.case, []);
    cases.get(row.case).push(row);
  }
  const measures = [];
  for (const group of cases.values()) {
    group.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    );
    const observations = [];
    for (let i = 1; i < group.length; i++) {
      const before = group[i - 1],
        after = group[i];
      if (
        before.activity === "Invoice rekeyed" &&
        after.activity === "Refund authorised" &&
        Date.parse(after.timestamp) >= Date.parse(period.start) &&
        Date.parse(after.timestamp) < Date.parse(period.end)
      )
        observations.push(
          (Date.parse(after.timestamp) - Date.parse(before.timestamp)) /
            3600000,
        );
    }
    if (observations.length) measures.push(median(observations));
  }
  return { cases: measures.length, median: median(measures) };
}
async function wave(which, expected) {
  const res = await get("continuous/fixtures/" + which, { method: "POST" });
  assert.equal(res.added, expected, which + " deduplication/ingestion");
}
function validEvidence(ids, allRows) {
  assert.ok(Array.isArray(ids) && ids.length);
  for (const id of ids)
    assert.ok(allRows.has(id), "Cited record resolves: " + id);
}
const roundClose = (a, b) =>
  assert.ok(
    Math.abs(a - b) < 0.01,
    `Expected ${a} and ${b} to agree within 0.01`,
  );
async function apiHistory() {
  assert.equal(
    (await endpoint("continuous", { credential: null })).status,
    401,
  );
  assert.equal(
    (
      await endpoint("continuous/fixtures/backlog", {
        method: "POST",
        credential: other,
      })
    ).ok,
    false,
  );
  // Boot the standard RQ worker for the workspace's report path. Continuous signals
  // use the API's database-fenced monitor; the test does not call its worker internals.
  stack.startWorker();
  const seed = await ready(1, "initial automatic snapshot");
  const seedEvents = seed.history.find((h) => h.id === seed.snapshot.id).events;
  const baseline = await get("workspace");
  assert.equal(seedEvents, baseline.data.events.length);
  assert.equal(baseline.data.events.length, 1706);
  await wave("backlog", 485);
  const backlog = await ready(
    seed.snapshot.revision + 1,
    "automatic backlog trigger",
  );
  const data = (await get("workspace")).data;
  const allRows = new Set([...data.events, ...data.docs].map((r) => r.id));
  const arrived = data.events.filter((e) =>
    e.case.startsWith("NS-SYN-BACKLOG-"),
  );
  assert.equal(arrived.length, 485);
  assert.ok(arrived.every((e) => e.synthetic));
  const source = data.sources.find(
    (s) => s.name === "synthetic-change-stream.csv",
  );
  assert.ok(source?.synthetic && arrived.every((e) => e.source === source.id));
  assert.deepEqual(
    new Set(backlog.signals.map((s) => s.kind)),
    new Set(["latency", "duplicate", "variant", "drift", "handoff"]),
  );
  const latency = backlog.signals.find(
    (s) =>
      s.kind === "latency" &&
      s.subject.join("|") === "Invoice rekeyed|Refund authorised",
  );
  assert.ok(latency, "Observed refund latency regression");
  const { previous, recent } = backlog.snapshot.analysis.windows;
  const before = refundMedian(data.events, previous),
    after = refundMedian(data.events, recent);
  assert.equal(after.cases, 42);
  roundClose(after.median, latency.metric.recent);
  roundClose(before.median, latency.metric.previous);
  for (const signal of backlog.signals) validEvidence(signal.evidence, allRows);
  const run = backlog.investigations.find(
    (r) => r.signal_id === latency.id && r.snapshot_id === backlog.snapshot.id,
  );
  assert.ok(run && run.status === "completed" && run.mode === "deterministic");
  assert.deepEqual(
    run.checkpoints.map((p) => p.stage),
    stages,
  );
  for (const checkpoint of run.checkpoints)
    validEvidence(checkpoint.evidence, allRows);
  const decision = backlog.decisions.find((d) => d.run_id === run.id);
  assert.ok(
    decision && !decision.approval,
    "Decision history records evidence, with no automatic human approval",
  );
  assert.ok(
    (await get("continuous/investigations/" + run.id)).checkpoints.length === 6,
  );
  assert.equal((await get("continuous/signals/" + latency.id)).id, latency.id);
  const billing = backlog.snapshot.analysis.graph.nodes.find(
    (n) => n.kind === "system" && n.label === "Billing desk",
  );
  assert.ok(
    billing &&
      !seed.snapshot.analysis.graph.nodes.some((n) => n.id === billing.id),
  );
  const billingHistory = await get("continuous/nodes/" + billing.id);
  assert.equal(billingHistory.history[0].snapshot_id, backlog.snapshot.id);
  for (const route of [
    "snapshots/" + backlog.snapshot.id,
    "signals/" + latency.id,
    "investigations/" + run.id,
    "nodes/" + billing.id,
  ]) {
    assert.equal(
      (await endpoint("continuous/" + route, { credential: other })).status,
      404,
    );
  }
  assert.equal(
    (
      await endpoint("continuous/investigations/" + run.id + "/resume", {
        credential: other,
        method: "POST",
      })
    ).status,
    404,
  );
  const empty = await get("continuous", { credential: other });
  assert.ok(
    !empty.decisions.length &&
      !empty.signals.length &&
      !empty.investigations.length,
  );
  await wave("backlog", 0);
  const same = await ready(backlog.snapshot.revision, "replayed fixture");
  assert.deepEqual(same.history, backlog.history);
  assert.equal(same.investigations.length, backlog.investigations.length);
  // Restart between capture and investigation completion. The new API process owns
  // the same isolated database and reconstructs any queued monitor stages.
  await wave("recovery", 393);
  await stack.restart();
  const recovery = await ready(
    backlog.snapshot.revision + 1,
    "restart and recovery",
  );
  const nextData = (await get("workspace")).data;
  const nextIds = new Set(
    [...nextData.events, ...nextData.docs].map((r) => r.id),
  );
  assert.equal(nextData.events.length, 1706 + 485 + 393);
  const next = refundMedian(
    nextData.events,
    recovery.snapshot.analysis.windows.recent,
  );
  assert.equal(next.cases, 42);
  roundClose(next.median, 25.2);
  assert.ok(
    !recovery.signals.some((s) => s.kind === "latency" && s.id === latency.id),
    "Resolved latency no longer raises an active alert",
  );
  const recheck = recovery.reassessments.find(
    (r) => r.decision_id === decision.id,
  );
  assert.ok(
    recheck,
    "Resolved regressions still receive a decision reassessment",
  );
  roundClose(recheck.from_value, after.median);
  roundClose(recheck.to_value, next.median);
  assert.equal(recheck.status, "decreased");
  validEvidence(recheck.evidence, nextIds);
  assert.equal(
    recovery.decisions.find((d) => d.id === decision.id).at,
    decision.at,
  );
  assert.deepEqual(
    await get("continuous/snapshots/" + backlog.snapshot.id),
    backlog.snapshot,
    "Historical graph and evidence are frozen",
  );
  assert.deepEqual(
    await get("continuous/investigations/" + run.id),
    run,
    "Completed checkpoint evidence survived restart",
  );
  await wave("recovery", 0);
  const post = await get("continuous/refresh", { method: "POST" });
  assert.deepEqual(post.history, recovery.history);
  assert.equal(post.reassessments.length, recovery.reassessments.length);
  const tenantHistory = await get("continuous/history", { credential: other });
  assert.ok(
    !tenantHistory.history.some(
      (x) => x.fingerprint === backlog.history[0].fingerprint,
    ),
  );
  Object.assign(snapshots, {
    seed,
    backlog,
    recovery,
    latency,
    run,
    decision,
    recheck,
    billing,
  });
  console.log(
    `Monitor API passed · ${backlog.signals.length} supported signals in five detector families, ${before.cases}/${after.cases}/${next.cases} observed cases, ${before.median.toFixed(2)} → ${after.median.toFixed(2)} → ${next.median.toFixed(2)} hours, six persisted checkpoints, evidence-linked reassessment, isolated restart and deduplication.`,
  );
}

try {
  await apiHistory();
  if (!process.argv.includes("--api-only")) await browserHistory();
  await ordinaryUpload();
} finally {
  await browser?.close();
  await stack.stop();
}

async function browserHistory() {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const errors = [];
  async function newPage({
    mobile = false,
    local = false,
    credential = token,
  } = {}) {
    const ctx = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1470, height: 980 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      serviceWorkers: "block",
      isMobile: mobile,
      hasTouch: mobile,
    });
    if (!local)
      await ctx.addInitScript(
        ({ api, credential }) => {
          sessionStorage.setItem("monolith-api-origin", api);
          sessionStorage.setItem("monolith-bearer/" + api, credential);
        },
        { api, credential },
      );
    const p = await ctx.newPage();
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => errors.push(e.message));
    return { ctx, p };
  }
  const tab = (p, name) =>
    p
      .getByRole("group", {
        name: "Continuous intelligence views",
        exact: true,
      })
      .getByRole("button", { name, exact: true })
      .click();
  const box = (p, name) => p.getByRole("combobox", { name, exact: true });
  const shot = async (p, name) => {
    if (out)
      await p.screenshot({
        path: path.join(out, name + ".png"),
        animations: "disabled",
      });
  };
  async function layout(p) {
    const w = await p.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    assert.ok(
      w.content <= w.viewport + 1,
      "Viewport overflow: " + JSON.stringify(w),
    );
  }
  const { backlog, latency, run, decision, recheck, recovery } = snapshots;
  async function beforeSignal(p) {
    await p.goto(web + "/#continuous-intelligence");
    await tab(p, "Periods");
    await box(p, "Observation revision").selectOption(backlog.snapshot.id);
    await p
      .getByRole("button", { name: "Return to latest", exact: true })
      .waitFor();
    const epoch = backlog.snapshot.analysis.graph.epochs[0];
    await p
      .getByRole("button", { name: /^Inspect period / })
      .first()
      .click();
    const chosenEpoch = box(p, "Observed period");
    assert.equal(
      await chosenEpoch.inputValue(),
      epoch.id,
      "A volume mark selects the corresponding archived epoch",
    );
    await p.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "Observed period",
    );
    await tab(p, "Signals");
    await box(p, "Filter detectors").selectOption("latency");
    await p
      .getByRole("button", {
        name: "Inspect signal " + latency.title,
        exact: true,
      })
      .click();
    const inspector = p.getByRole("region", {
      name: "Selected signal",
      exact: true,
    });
    await inspector
      .getByRole("heading", { name: latency.title, exact: true })
      .waitFor();
    const lead = p.getByRole("region", { name: "Operational observation" });
    await lead
      .getByRole("heading", { name: latency.title, exact: true })
      .waitFor();
    const format = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
    await lead
      .getByText(format.format(latency.metric.previous) + " h", { exact: true })
      .waitFor();
    await lead
      .getByText(format.format(latency.metric.recent) + " h", { exact: true })
      .waitFor();
    await lead.getByRole("button", { name: "Inspect change" }).click();
    await p.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "Selected signal",
    );
    return inspector;
  }
  async function clickEvidence(inside) {
    const source = inside
      .locator("details")
      .filter({
        has: inside.page().locator("summary", { hasText: "Source evidence" }),
      })
      .first();
    await source.locator(":scope > summary").click();
    const row = source.locator("details.evidence").first();
    await row.locator("summary").click();
    assert.match(await row.innerText(), /Synthetic/i);
  }
  async function memory(p) {
    if (
      await p
        .getByRole("button", { name: "Return to latest", exact: true })
        .isVisible()
    )
      await p
        .getByRole("button", { name: "Return to latest", exact: true })
        .click();
    await tab(p, "Decision memory");
    await box(p, "Filter decisions").selectOption("reassessed");
    await p
      .getByRole("button", {
        name: new RegExp(decision.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .first()
      .click();
    const heading = p.getByRole("heading", {
      name: "Reassessment history",
      exact: true,
    });
    await heading.waitFor();
    const history = heading.locator("..");
    await history.getByText(recheck.summary, { exact: true }).waitFor();
    assert.ok(
      (await history.innerText()).includes("25.2"),
      "Memory displays the measured recovery value",
    );
    return history;
  }
  const { p } = await newPage();
  const inspection = await beforeSignal(p);
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await shot(p, "monolith-continuous-desktop");
  await clickEvidence(inspection);
  await shot(p, "monolith-continuous-source-desktop");
  await inspection
    .getByRole("button", { name: "Inspect twin", exact: true })
    .click();
  const graph = p.getByRole("region", {
    name: "Historical graph",
    exact: true,
  });
  await graph
    .getByRole("heading", { name: "Relationship history", exact: true })
    .waitFor();
  assert.equal(
    await box(graph, "Graph revision").inputValue(),
    backlog.snapshot.id,
    "Historical signal opens its archived graph revision",
  );
  await box(graph, "Relationship layer").selectOption("handoff");
  const byLabel = new Map(
    backlog.snapshot.analysis.graph.nodes.map((n) => [n.id, n.label]),
  );
  const edge = backlog.snapshot.analysis.graph.edges.find(
    (e) =>
      e.kind === "handoff" &&
      byLabel.get(e.source) === "Billing desk" &&
      byLabel.get(e.target) === "Support",
  );
  assert.ok(edge);
  await box(graph, "Inspect a relationship").selectOption(edge.id);
  const epochSlider = graph.getByRole("slider", {
    name: "Graph epoch",
    exact: true,
  });
  const savedIdx = Number(await epochSlider.inputValue());
  const expectedEpoch = backlog.snapshot.analysis.graph.epochs[savedIdx];
  assert.equal(expectedEpoch.edge_counts[edge.id], 33);
  await shot(p, "monolith-twin-history-desktop");
  await graph
    .getByRole("button", { name: "Previous epoch", exact: true })
    .click();
  assert.equal(Number(await epochSlider.inputValue()), savedIdx - 1);
  await graph.getByRole("button", { name: "Next epoch", exact: true }).click();
  assert.equal(Number(await epochSlider.inputValue()), savedIdx);
  await graph
    .getByRole("button", { name: "Play timeline", exact: true })
    .click();
  await graph
    .getByRole("button", { name: "Pause timeline", exact: true })
    .click();
  await box(graph, "Graph revision").selectOption(recovery.snapshot.id);
  await box(graph, "Relationship layer").selectOption("handoff");
  const max = Number(await epochSlider.getAttribute("max"));
  await epochSlider.focus();
  await epochSlider.press("End");
  assert.equal(Number(await epochSlider.inputValue()), max);
  await box(graph, "Inspect a relationship").selectOption(edge.id);
  const latestEpoch = recovery.snapshot.analysis.graph.epochs.at(-1);
  assert.equal(latestEpoch.edge_counts[edge.id], 2);
  const count = graph
    .getByText("occurrences in this epoch", { exact: true })
    .locator("..");
  assert.match(await count.innerText(), /^2\s/);
  await p.goto(web + "/#continuous-intelligence");
  await memory(p);
  await shot(p, "monolith-continuous-memory");
  await tab(p, "Periods");
  await box(p, "Observation revision").selectOption(backlog.snapshot.id);
  await p
    .getByRole("heading", { name: "Period comparison", exact: true })
    .scrollIntoViewIfNeeded();
  await shot(p, "monolith-continuous-periods-desktop");
  await tab(p, "Investigations");
  await p
    .getByRole("heading", { name: "Recorded investigations", exact: true })
    .waitFor();
  const timeline = p.getByRole("region", {
    name: "Investigation checkpoints",
    exact: true,
  });
  await timeline
    .getByRole("button", { name: /Inspect checkpoint Verification/ })
    .click();
  await timeline.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await shot(p, "monolith-continuous-checkpoints");
  const mobile = await newPage({ mobile: true });
  const mobileInspector = await beforeSignal(mobile.p);
  await mobile.p.evaluate(() =>
    window.scrollTo({ top: 0, behavior: "instant" }),
  );
  await shot(mobile.p, "monolith-continuous-mobile-overview");
  await mobileInspector.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await layout(mobile.p);
  await shot(mobile.p, "monolith-continuous-mobile");
  await mobileInspector.scrollIntoViewIfNeeded();
  await clickEvidence(mobileInspector);
  await layout(mobile.p);
  await shot(mobile.p, "monolith-continuous-source-mobile");
  await mobileInspector
    .getByRole("button", { name: "Inspect twin", exact: true })
    .click();
  const smallGraph = mobile.p.getByRole("region", {
    name: "Historical graph",
    exact: true,
  });
  await box(smallGraph, "Graph revision").waitFor();
  await smallGraph.evaluate((el) =>
    el.scrollIntoView({ block: "start", behavior: "instant" }),
  );
  await layout(mobile.p);
  await shot(mobile.p, "monolith-twin-history-mobile");
  await mobile.ctx.close();
  const isolated = await newPage({ credential: other });
  await isolated.p.goto(web + "/#continuous-intelligence");
  await isolated.p
    .getByRole("heading", { name: "Awaiting an observation", exact: true })
    .waitFor();
  assert.equal(
    await isolated.p
      .getByRole("button", {
        name: "Inspect signal " + latency.title,
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await isolated.p
      .getByRole("button", {
        name: "Load synthetic change stream",
        exact: true,
      })
      .count(),
    0,
  );
  await isolated.ctx.close();
  // Exercise fresh browser-local state from public sources without a server, including reload.
  const offline = await newPage({ local: true }),
    requests = [];
  offline.p.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
  });
  await offline.p.goto(web + "/#continuous-intelligence");
  await offline.p
    .getByRole("button", { name: "Load synthetic change stream", exact: true })
    .click();
  const select = offline.p.getByRole("button", {
    name: "Inspect signal " + latency.title,
    exact: true,
  });
  await select.waitFor({ timeout: 90000 });
  await select.click();
  const active = offline.p.getByRole("region", { name: "Selected signal" });
  await active
    .getByRole("button", { name: "Open investigation", exact: true })
    .click();
  // A signal opens its own persistent specialist run inside Studio.
  await offline.p.waitForURL(/intelligence-studio/);
  const runStage = offline.p
    .getByRole("button", { name: /Inspect checkpoint Verification/ })
    .first();
  await runStage.waitFor();
  await runStage.click();
  await offline.p.goto(web + "/#continuous-intelligence");
  await offline.p
    .getByRole("button", {
      name: "Load synthetic recovery stream",
      exact: true,
    })
    .click();
  await offline.p
    .getByRole("button", {
      name: "Load synthetic recovery stream",
      exact: true,
    })
    .waitFor({ state: "hidden", timeout: 90000 });
  await memory(offline.p);
  await offline.p.reload();
  await memory(offline.p);
  assert.deepEqual(
    requests,
    [],
    "Standalone monitoring does not send source records to an API",
  );
  assert.deepEqual(errors, []);
  if (out) {
    const report = {
      source: "Opt-in synthetic Northstar change streams",
      seed_events: 1706,
      backlog_events: 485,
      recovery_events: 393,
      previous_median_hours: latency.metric.previous,
      backlog_median_hours: latency.metric.recent,
      recovered_median_hours: recheck.to_value,
      detected: backlog.signals.reduce(
        (counts, s) => ({ ...counts, [s.kind]: (counts[s.kind] || 0) + 1 }),
        {},
      ),
      stages: run.checkpoints.map((c) => c.stage),
      reassessment: recheck.status,
      api_process_restart: true,
      other_tenant_denied: true,
      browser_viewports: ["1470×980", "390×844"],
      standalone_api_requests: requests.length,
      live_provider_calls: 0,
    };
    await writeFile(
      path.join(out, "monolith-continuous-regression.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(
    "Production Chromium passed · archived signal and source evidence, revision/epoch-specific graph counts, checkpoint selection, reassessed memory, 390px layout, isolated tenant and IndexedDB recovery after reload.",
  );
}

async function ordinaryUpload() {
  // Same approved fixture bytes, newly attached by a user under another filename.
  const raw = await readFile(
    path.join(root, "apps/web/public/synthetic-change-stream.csv"),
  );
  const filename = "QA-renamed-training-stream.csv";
  async function upload() {
    const form = new FormData();
    form.append("file", new Blob([raw], { type: "text/csv" }), filename);
    const response = await fetch(api + "/api/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + other },
      body: form,
    });
    assert.equal(response.status, 200);
    return (await response.json()).added;
  }
  assert.equal(await upload(), 485);
  const view = await ready(1, "ordinary file upload", other);
  const source = (await get("workspace", { credential: other })).data;
  assert.equal(source.events.length, 485);
  assert.equal(source.sources.length, 1);
  assert.equal(source.sources[0].name, filename);
  assert.ok(
    source.sources[0].synthetic && source.events.every((e) => e.synthetic),
  );
  assert.equal(await upload(), 0);
  const again = await ready(
    view.snapshot.revision,
    "duplicate ordinary upload",
    other,
  );
  assert.deepEqual(again.history, view.history);
  const northstar = (await get("workspace")).data;
  assert.ok(!northstar.sources.some((s) => s.name === filename));
  console.log(
    "Ordinary CSV file upload passed · byte-matched synthetic origin after rename, automatic monitor revision, idempotence, independent tenant.",
  );
}
