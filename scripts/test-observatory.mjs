/**
 * End-to-end release regression. Run npm run build, then node scripts/test-observatory.mjs.
 * Requires Docker for an isolated Redis queue, Chromium, and the API's Python environment.
 * QA_SCREENSHOT_DIR optionally retains desktop and mobile screenshots. No provider credentials are inherited.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";
import { startRuntime } from "./observatory-test-runtime.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const stages = [
  "discovery",
  "process",
  "strategy",
  "architect",
  "simulation",
  "verification",
];
const stack = await startRuntime();
const { api, web, token, other } = stack;
const captureDir = process.env.QA_SCREENSHOT_DIR;
if (captureDir) await mkdir(captureDir, { recursive: true });
let browser;
const failures = [];
const endpoint = (route, method = "GET", body, auth = token, headers = {}) =>
  fetch(api + "/api/" + route, {
    method,
    headers: {
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
async function json(route, method, body) {
  const res = await endpoint(route, method, body);
  assert.ok(res.ok, route + " returned " + res.status);
  return res.json();
}
function frames(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}
async function finish(id) {
  for (let i = 0; i < 180; i++) {
    const run = await json("investigations/" + id);
    if (run.status === "completed") return run;
    assert.ok(
      ["queued", "running"].includes(run.status),
      JSON.stringify({ id, status: run.status, error: run.error }),
    );
    await pause(400);
  }
  throw Error("Worker did not complete in the test interval.");
}
function audit(run) {
  const evaluation = run.result?.evaluation;
  assert.ok(
    evaluation,
    "A completed deterministic run has a persisted evaluation",
  );
  assert.match(evaluation.snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    evaluation.stages.map((s) => s.id),
    stages,
  );
  assert.ok(
    evaluation.coverage.findings > 0 &&
      evaluation.coverage.covered <= evaluation.coverage.findings,
  );
  for (const stage of evaluation.stages) {
    assert.ok(stage.checks.length > 0);
    assert.ok(stage.coverage.findings >= stage.coverage.covered);
    for (const c of stage.checks) {
      assert.ok(["pass", "review", "fail"].includes(c.status));
      assert.ok(Object.hasOwn(c, "actual") && Object.hasOwn(c, "expected"));
    }
  }
  assert.equal(
    run.events.filter((e) => e.kind === "model_call").length,
    0,
    "Deterministic runs have no provider receipts",
  );
  return evaluation;
}
async function screenshot(page, name) {
  if (captureDir)
    await page.screenshot({
      path: path.join(captureDir, name + ".png"),
      animations: "disabled",
    });
}
async function launchPage({
  mobile = false,
  local = false,
  credential = token,
} = {}) {
  const context = await browser.newContext({
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
    await context.addInitScript(
      ({ api, token }) => {
        sessionStorage.setItem("monolith-api-origin", api);
        sessionStorage.setItem("monolith-bearer/" + api, token);
      },
      { api, token: credential },
    );
  const page = await context.newPage();
  page.on("pageerror", (e) => failures.push(e.message));
  page.setDefaultTimeout(20000);
  return { context, page };
}
async function heading(page, name) {
  return page.getByRole("heading", { name, exact: true }).waitFor();
}
async function mobileFits(page) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    full: document.documentElement.scrollWidth,
  }));
  assert.ok(
    geometry.full <= geometry.viewport + 1,
    `Horizontal overflow ${geometry.full}px on ${geometry.viewport}px viewport`,
  );
}
async function workflow() {
  assert.equal(
    (await endpoint("investigations", "GET", null, null)).status,
    401,
  );
  assert.equal(
    (await endpoint("investigations", "POST", { mode: "live", days: 30 }))
      .status,
    409,
  );
  const baseReq = { mode: "deterministic", days: 30, request_id: randomUUID() };
  const queued = await json("investigations", "POST", baseReq);
  assert.equal(queued.status, "queued");
  assert.equal((await json("investigations", "POST", baseReq)).id, queued.id);
  const route = "investigations/" + queued.id;
  const sub = await endpoint(route + "/events?after=0");
  assert.equal(sub.status, 200);
  assert.match(sub.headers.get("content-type"), /^text\/event-stream/);
  const reader = sub.body.getReader(),
    decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n\n")) {
    const chunk = await reader.read();
    assert.ok(!chunk.done);
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.equal(frames(text)[0].kind, "run_queued");
  assert.equal(
    (await json(route)).status,
    "queued",
    "SSE subscribed before worker startup",
  );
  stack.startWorker();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  const events = frames(text),
    first = await finish(queued.id);
  assert.deepEqual(events, first.events);
  assert.deepEqual(
    events.map((e) => e.seq),
    Array.from({ length: events.length }, (_, i) => i + 1),
  );
  assert.equal(events.at(-1).kind, "run_completed");
  assert.deepEqual(
    events.filter((e) => e.kind === "stage_completed").map((e) => e.stage),
    stages,
  );
  const resumed = await endpoint(
    route + "/events?after=1",
    "GET",
    null,
    token,
    { "last-event-id": "4" },
  );
  assert.deepEqual(
    frames(await resumed.text()),
    events.slice(4),
    "SSE resumes strictly past the last acknowledged frame",
  );
  for (const path of [
    route,
    route + "/snapshot",
    route + "/evaluation",
    route + "/events",
  ]) {
    assert.equal((await endpoint(path, "GET", null, other)).status, 404);
  }
  assert.equal(
    (
      await endpoint(
        route + "/repeat",
        "POST",
        { request_id: randomUUID() },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (await endpoint(route + "/approve", "POST", { approach: "batch" }, other))
      .status,
    404,
  );
  assert.equal((await endpoint(route + "/events?after=-1")).status, 422);
  assert.equal(
    (
      await endpoint(route + "/events", "GET", null, token, {
        "last-event-id": "bad",
      })
    ).status,
    422,
  );
  const a = audit(first);
  assert.deepEqual(await json(route + "/evaluation"), a);
  const frozen = await json(route + "/snapshot");
  const sourceIds = new Set(
    [...frozen.data.docs, ...frozen.data.events].map((s) => s.id),
  );
  for (const stage of a.stages)
    for (const c of stage.checks)
      assert.ok(
        c.evidence.every((id) => sourceIds.has(id)),
        "Every evaluated source reference resolves in the frozen snapshot.",
      );
  assert.equal(
    (await endpoint("runtime/readiness", "GET", null, null)).status,
    401,
  );
  const readiness = await json("runtime/readiness");
  assert.equal(readiness.queue.status, "reachable");
  assert.equal(readiness.worker.status, "online");
  assert.equal(readiness.worker.reported, 1);
  assert.equal(readiness.worker.provider_configured, 0);
  assert.equal(readiness.provider.configured, false);
  assert.equal(readiness.provider.verification, "unverified");
  assert.equal(readiness.provider.last_response, null);
  const repeatRequest = { request_id: randomUUID() };
  const repeated = await json(route + "/repeat", "POST", repeatRequest);
  assert.notEqual(repeated.id, first.id);
  assert.equal(repeated.repeat_of, first.id);
  assert.equal(
    (await json(route + "/repeat", "POST", repeatRequest)).id,
    repeated.id,
  );
  const repeat = await finish(repeated.id),
    b = audit(repeat);
  assert.deepEqual(
    b,
    a,
    "Same immutable snapshot and deterministic outputs reproduce all checks",
  );
  assert.deepEqual(
    await json("investigations/" + repeat.id + "/snapshot"),
    await json(route + "/snapshot"),
  );
  const changed = await finish(
      (
        await json("investigations", "POST", {
          mode: "deterministic",
          days: 7,
          request_id: randomUUID(),
        })
      ).id,
    ),
    c = audit(changed);
  assert.notEqual(c.snapshot_sha256, a.snapshot_sha256);
  const prior = await json(route + "/snapshot"),
    narrow = await json("investigations/" + changed.id + "/snapshot");
  assert.ok(narrow.report.cases < prior.report.cases);
  console.log(
    `RQ + authenticated SSE passed · ${events.length} ordered frames, immutable repeat, 7-day variation vs 30-day baseline, cross-tenant denials`,
  );
  return { first, repeat, changed };
}

async function archiveEmpty(page) {
  await page
    .getByRole("button", { name: "Live run archive", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Live run archive" });
  await dialog
    .getByText("No verified recording is available", { exact: false })
    .waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Play archived walkthrough" })
      .count(),
    0,
  );
  return dialog;
}

async function offlineComparison() {
  const { page, context } = await launchPage({ local: true });
  const apiRequests = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      apiRequests.push(r.url());
  });
  try {
    await page.goto(web + "/#intelligence-studio");
    await page
      .getByRole("button", {
        name: "Run deterministic investigation",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Evaluation stage", exact: true })
      .waitFor({ timeout: 60000 });
    const pick = page.getByRole("combobox", {
      name: "Inspect saved run",
      exact: true,
    });
    const first = await pick.inputValue();
    await page
      .getByRole("button", { name: "Repeat on frozen inputs", exact: true })
      .click();
    await page.waitForFunction((id) => {
      const pick = document.querySelector(
        "select[aria-label='Inspect saved run']",
      );
      return pick && pick.value !== id;
    }, first);
    await page
      .getByRole("combobox", { name: "Evaluation stage", exact: true })
      .waitFor();
    const second = await pick.inputValue();
    assert.notEqual(first, second);
    await page
      .getByRole("button", { name: "Compare runs", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Comparison run", exact: true })
      .selectOption(first);
    await page.getByText("Identical frozen inputs", { exact: true }).waitFor();
    await page.reload();
    await page
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    const options = await page
      .getByRole("combobox", { name: "Inspect saved run", exact: true })
      .locator("option")
      .evaluateAll((nodes) => nodes.map((n) => n.value));
    assert.ok(
      options.includes(first) && options.includes(second),
      "Both repeat runs survived an offline browser reload",
    );
    assert.deepEqual(apiRequests, []);
    console.log(
      "Standalone export passed · fresh Pyodide run, IndexedDB repeat and reload, identical-input comparison, no API calls",
    );
  } finally {
    await context.close();
  }
}

// The fitter supplies a protocol-only test document in memory. It is never installed in dist.
async function replayRegression(page) {
  const apiDir = fileURLToPath(new URL("../apps/api/", import.meta.url));
  const sample = await promisify(execFile)(
    path.join(apiDir, ".venv/bin/python"),
    [
      "-c",
      "import json,sys; sys.path.insert(0,'tests'); from replay_sample import build_ui_fixture; print(json.dumps(build_ui_fixture(),separators=(',',':')))",
    ],
    {
      cwd: apiDir,
      maxBuffer: 12 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
  const fixture = JSON.parse(sample.stdout);
  assert.equal(
    fixture.test_only,
    true,
    "Only a marked ephemeral protocol fixture may be intercepted.",
  );
  const context = page.context();
  await context.addCookies([
    { name: "qa-private", value: "isolated", url: web },
  ]);
  const id = "northstar-refund-live";
  let payload = Buffer.from(JSON.stringify(fixture));
  const fingerprint = (bytes) =>
    createHash("sha256").update(bytes).digest("hex");
  const makeIndex = (bytes) => ({
    schema: "monolith.replays.index.v1",
    captures: [
      {
        id,
        sha256: fingerprint(bytes),
        bytes: bytes.length,
        path: "/replays/" + id + "-" + fingerprint(bytes) + ".json",
      },
    ],
  });
  let index = makeIndex(payload);
  const archiveRequests = [];
  const onRoute = async (route) => {
    const req = route.request();
    assert.equal(req.method(), "GET");
    const headers = await req.allHeaders();
    for (const field of ["authorization", "cookie", "referer"])
      assert.ok(!headers[field], "Archive GET discloses no " + field);
    const pathname = new URL(req.url()).pathname;
    archiveRequests.push(pathname);
    await route.fulfill({
      contentType: "application/json",
      body: pathname.endsWith("/index.json") ? JSON.stringify(index) : payload,
    });
  };
  await page.route(web + "/replays/**", onRoute);
  const writes = [];
  const recordWrite = (req) => {
    if (req.method() !== "GET" && req.method() !== "OPTIONS")
      writes.push(req.method() + " " + new URL(req.url()).pathname);
  };
  page.on("request", recordWrite);
  const open = async () => {
    await page
      .getByRole("button", { name: "Live run archive", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Live run archive", exact: true });
  };
  const close = async (d) =>
    d.getByRole("button", { name: "Close live run archive" }).click();
  try {
    const unrelated = {
      ...index.captures[0],
      path: "/unexpected-archive-path",
    };
    index = { ...index, captures: [unrelated] };
    let dlg = await open();
    await dlg
      .getByRole("alert")
      .getByText(/invalid capture reference/i)
      .waitFor();
    assert.deepEqual(archiveRequests, ["/replays/index.json"]);
    await close(dlg);
    index = makeIndex(payload);
    const corrupt = Buffer.from(payload);
    corrupt[corrupt.length - 1] = 32;
    payload = corrupt;
    dlg = await open();
    await dlg
      .getByRole("alert")
      .getByText(/integrity check/i)
      .waitFor();
    await close(dlg);
    const wrong = structuredClone(fixture);
    wrong.snapshot.data.events[0].synthetic = false;
    payload = Buffer.from(JSON.stringify(wrong));
    index = makeIndex(payload);
    dlg = await open();
    await dlg
      .getByRole("alert")
      .getByText(/synthetic Northstar seed/i)
      .waitFor();
    await close(dlg);
    payload = Buffer.from(JSON.stringify(fixture));
    index = makeIndex(payload);
    dlg = await open();
    await dlg
      .getByRole("heading", { name: "Replay contract fixture" })
      .waitFor();
    await dlg
      .getByText("Test fixture · no live provider calls", { exact: true })
      .first()
      .waitFor();
    await screenshot(page, "monolith-replay-protocol-fixture");
    const slider = dlg.getByRole("slider", { name: "Replay event" }),
      before = Number(await slider.inputValue());
    await dlg.getByRole("button", { name: "Next event", exact: true }).click();
    assert.equal(Number(await slider.inputValue()), before + 1);
    await dlg
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    assert.equal(Number(await slider.inputValue()), before);
    await dlg.getByLabel("Jump to recorded stage").selectOption("verification");
    assert.ok(Number(await slider.inputValue()) > before);
    await dlg
      .getByRole("button", { name: "Approved blueprint", exact: true })
      .click();
    assert.equal(
      await dlg
        .getByRole("button", { name: "Approved blueprint", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const dossier = dlg.getByRole("article", {
      name: "Approved implementation blueprint",
    });
    const approved = fixture.run.result.package.approaches.find(
      (a) => a.id === fixture.run.approval.approach,
    );
    await dossier
      .getByRole("heading", { name: approved.name, exact: true })
      .waitFor();
    await dossier
      .getByText(/fixture/i)
      .first()
      .waitFor();
    await dlg
      .getByRole("button", { name: "Play archived walkthrough" })
      .click();
    const guide = page.getByRole("dialog", {
      name: "Guided investigation",
      exact: true,
    });
    await guide.waitFor();
    await guide
      .getByText(/fixture/i)
      .first()
      .waitFor();
    await guide
      .getByRole("button", { name: "Exit guided investigation" })
      .click();
    await close(dlg);
    assert.deepEqual(
      writes,
      [],
      "Playback never mutates workspace state or invokes a provider.",
    );
  } finally {
    page.off("request", recordWrite);
    await page.unroute(web + "/replays/**", onRoute);
  }
  console.log(
    "Replay viewer passed with an intercepted protocol fixture only: exact seed, integrity, same-origin reads, no bearer/cookies/referrer, stage scrubbing, blueprint and guided playback; no writes.",
  );
}

try {
  const runs = await workflow();
  if (!process.argv.includes("--api-only")) {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--disable-dev-shm-usage", "--no-proxy-server"],
    });
    const { page } = await launchPage();
    await page.goto(web + "/#intelligence-studio");
    await page
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await heading(page, "AI Engineering Observatory");
    await page
      .getByRole("combobox", { name: "Inspect saved run", exact: true })
      .selectOption(runs.first.id);
    await page
      .getByRole("combobox", { name: "Evaluation stage", exact: true })
      .waitFor();
    const evalData = runs.first.result.evaluation;
    await page
      .getByText(
        evalData.coverage.covered +
          "/" +
          evalData.coverage.findings +
          " findings covered",
        { exact: true },
      )
      .waitFor();
    await screenshot(page, "monolith-observatory-desktop");
    const checkStage = evalData.stages.find((st) => st.id === "process");
    await page
      .getByRole("combobox", { name: "Evaluation stage", exact: true })
      .selectOption(checkStage.id);
    const check = checkStage.checks.find((c) => c.evidence.length > 0);
    const details = page
      .locator("details")
      .filter({ has: page.locator("summary strong", { hasText: check.label }) })
      .first();
    await details.locator(":scope > summary").click();
    await details
      .getByRole("heading", { name: "Expected", exact: true })
      .waitFor();
    await details
      .getByRole("heading", { name: "Recorded", exact: true })
      .waitFor();
    await screenshot(page, "monolith-observatory-check");
    const claims = page
      .locator("details")
      .filter({
        has: page.locator("summary strong", { hasText: "Finding citations" }),
      })
      .first();
    await claims.locator(":scope > summary").click();
    for (const finding of checkStage.finding_audits) {
      await claims.getByText(finding.text, { exact: true }).waitFor();
      assert.ok(finding.evidence.length > 0 && !finding.unresolved.length);
    }
    const sourceRecord = claims.locator("details.evidence").first();
    await sourceRecord.locator("summary").click();
    assert.ok(
      /Synthetic/i.test(await sourceRecord.innerText()),
      "Claim inspection reaches a source row from the frozen synthetic snapshot",
    );
    await page
      .getByRole("button", { name: "Compare runs", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Comparison run", exact: true })
      .selectOption(runs.repeat.id);
    const table = page.getByRole("table", { name: "Saved run comparison" });
    await table.waitFor();
    await page.getByText("Identical frozen inputs", { exact: true }).waitFor();
    assert.match(
      await table
        .getByRole("row", { name: /Median refund interval/i })
        .innerText(),
      /No change/i,
    );
    assert.match(
      await table.getByRole("row", { name: /Reported tokens/i }).innerText(),
      /Unavailable/i,
    );
    await page
      .getByRole("combobox", { name: "Comparison run", exact: true })
      .selectOption(runs.changed.id);
    await page.getByText("Different frozen inputs", { exact: true }).waitFor();
    const changedRow = await table
      .getByRole("row", { name: /Source events in window/i })
      .innerText();
    assert.doesNotMatch(changedRow, /No change/i);
    await screenshot(page, "monolith-observatory-comparison");
    await page.getByRole("button", { name: "Trace", exact: true }).click();
    await page
      .getByRole("heading", { name: "Tools, models and handoffs", exact: true })
      .waitFor();
    await page
      .getByLabel("Trace stage", { exact: true })
      .selectOption("simulation");
    await page
      .getByText("This investigation used the deterministic engine.", {
        exact: true,
      })
      .waitFor();
    await screenshot(page, "monolith-observatory-trace");
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/investigations/" + runs.first.id + "/repeat") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Repeat on frozen inputs", exact: true })
      .click();
    const fromUi = await (await response).json();
    assert.equal(fromUi.repeat_of, runs.first.id);
    const uiRepeat = await finish(fromUi.id);
    assert.deepEqual(uiRepeat.result.evaluation, evalData);
    await page.goto(web + "/#data-sources");
    const diagnostics = page.getByRole("region", { name: "Runtime readiness" });
    await diagnostics.getByText("Redis online", { exact: true }).waitFor();
    await diagnostics.getByText("1 online", { exact: true }).waitFor();
    const probe = page.waitForResponse((r) =>
      r.url().endsWith("/runtime/readiness"),
    );
    await diagnostics
      .getByRole("button", { name: "Check runtime", exact: true })
      .click();
    assert.equal(
      (await (await probe).json()).provider.verification,
      "unverified",
    );
    await page.goto(web + "/#intelligence-studio");
    await page
      .getByRole("button", { name: "Investigation", exact: true })
      .click();
    const catalogue = await (await fetch(web + "/replays/index.json")).json();
    if (!catalogue.captures.length) {
      const dialog = await archiveEmpty(page);
      await screenshot(page, "monolith-archive-availability");
      await dialog
        .getByRole("button", { name: "Close live run archive" })
        .click();
    }
    const { page: mobile } = await launchPage({ mobile: true });
    await mobile.goto(web + "/#intelligence-studio");
    await mobile
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await heading(mobile, "AI Engineering Observatory");
    await mobile
      .getByRole("combobox", { name: "Evaluation stage", exact: true })
      .waitFor();
    await mobileFits(mobile);
    await screenshot(mobile, "monolith-observatory-mobile");
    const mobileStage = mobile.getByRole("region", {
      name: "Evaluation stage details",
    });
    await mobileStage.scrollIntoViewIfNeeded();
    await mobile
      .getByRole("combobox", { name: "Evaluation stage", exact: true })
      .selectOption("verification");
    await mobileFits(mobile);
    await screenshot(mobile, "monolith-observatory-mobile-stage");
    const claimsMobile = mobileStage
      .locator("details")
      .filter({
        has: mobile.locator("summary strong", { hasText: "Finding citations" }),
      })
      .first();
    await claimsMobile.locator(":scope > summary").click();
    await claimsMobile
      .getByText("Citations resolved", { exact: true })
      .first()
      .waitFor();
    const rowMobile = claimsMobile.locator("details.evidence").first();
    await rowMobile.locator("summary").click();
    assert.match(await rowMobile.innerText(), /Synthetic/i);
    await claimsMobile.evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await mobileFits(mobile);
    await screenshot(mobile, "monolith-observatory-mobile-citations");
    if (!catalogue.captures.length) {
      const modal = await archiveEmpty(mobile);
      const width = await modal.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        content: el.scrollWidth,
        client: el.clientWidth,
      }));
      assert.ok(
        width.width <= 390 && width.content <= width.client + 1,
        "The archive dialog fits the mobile viewport",
      );
      await mobileFits(mobile);
      await screenshot(mobile, "monolith-archive-mobile");
      await modal
        .getByRole("button", { name: "Close live run archive" })
        .click();
    }
    const isolated = await launchPage({ credential: other });
    await isolated.page.goto(web + "/#intelligence-studio");
    await isolated.page
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await heading(isolated.page, "No investigation selected");
    assert.equal(
      await isolated.page
        .getByRole("button", { name: "Live run archive", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await isolated.page
        .getByRole("combobox", { name: "Inspect saved run", exact: true })
        .count(),
      0,
    );
    await isolated.context.close();
    await offlineComparison();
    await replayRegression(page);
    assert.deepEqual(failures, []);
    if (captureDir) {
      const summary = {
        dataset: "Northstar Commerce · synthetic",
        storage: "Disposable SQLite and Redis/RQ test deployment",
        modes: [
          "Deterministic API worker",
          "Deterministic browser WebAssembly",
        ],
        tested_viewports: [
          { width: 1470, height: 980 },
          { width: 390, height: 844 },
        ],
        official_provider_calls: 0,
        archive:
          "Integrity checks and read-only playback tested with an intercepted, explicitly marked protocol fixture",
        runs: [runs.first, runs.repeat, runs.changed].map((r) => ({
          id: r.id,
          mode: r.mode,
          repeat_of: r.repeat_of || null,
          days: r.days,
          sse_events: r.events.length,
          snapshot_sha256: r.result.evaluation.snapshot_sha256,
          check_status: r.result.evaluation.status,
          checks: r.result.evaluation.support,
          evidence: r.result.evaluation.coverage,
          human_control: r.result.evaluation.human_control.status,
        })),
      };
      await writeFile(
        path.join(captureDir, "monolith-observatory-regression.json"),
        JSON.stringify(summary, null, 2) + "\n",
      );
    }
    console.log(
      "Production Chromium passed · desktop and mobile Observatory, comparison, trace, archive availability",
    );
  }
} finally {
  await browser?.close();
  await stack.stop();
}
