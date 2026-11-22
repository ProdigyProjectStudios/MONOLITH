/**
 * End-to-end check of a production export in Chromium. All HTTP requests are
 * fulfilled from dist; the browser still executes the shipped JS, WASM,
 * dedicated worker and IndexedDB. No API, provider or external network access.
 *
 * npm run build && node scripts/test-studio-browser.mjs
 * Set CHROMIUM_PATH as needed; set MONOLITH_QA_OUTPUT to retain screenshots.
 */
import assert from "node:assert/strict";
import { navigateWorkspace } from "./workspace-navigation.mjs";
import { access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const project = fileURLToPath(new URL("../", import.meta.url));
const dist = path.resolve(
  process.env.MONOLITH_DIST || path.join(project, "dist"),
);
const output =
  process.env.MONOLITH_QA_OUTPUT || path.join(tmpdir(), "monolith-browser-qa");
const origin = "https://monolith.test";
const mime = new Map(
  Object.entries({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".py": "text/plain",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
    ".zip": "application/zip",
  }),
);

async function serveExport(context, diagnostics) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      diagnostics.push(
        "Unexpected external request: " + url.origin + url.pathname,
      );
      await route.abort();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const filename = path.resolve(
      dist,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    assert.ok(filename.startsWith(dist + path.sep));
    try {
      const body = await readFile(filename);
      await route.fulfill({
        status: 200,
        contentType:
          mime.get(path.extname(filename)) || "application/octet-stream",
        body,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      diagnostics.push("Missing export asset: " + pathname);
      await route.fulfill({ status: 404, body: "Missing export asset" });
    }
  });
}

async function checkWidth(page, phase) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    sizes.document <= sizes.viewport + 1,
    phase + " exceeds viewport: " + JSON.stringify(sizes),
  );
}

async function assertStageGeometry(page) {
  const sequence = page.getByRole("region", { name: "Specialist stage sequence" });
  assert.equal(await sequence.getByRole("listitem").count(), 6);
  const verification = sequence.getByRole("button", { name: /Verification/ });
  await verification.focus();
  await verification.press("Enter");
  await page.getByRole("button", { name: "Handoff map", exact: true }).click();
  const graph = page
    .locator(".react-flow")
    .filter({ has: page.locator('.react-flow__node[data-id="discovery"]') });
  for (const stage of [
    "Discovery",
    "Process intelligence",
    "Automation strategy",
    "Solutions architect",
    "Simulation",
    "Verification",
  ]) {
    await graph
      .getByRole("button", { name: stage, exact: true })
      .waitFor({ state: "visible" });
  }
  const geometry = await graph.evaluate((el) => {
    const frame = el.getBoundingClientRect();
    return {
      nodes: [...el.querySelectorAll(".react-flow__node")].map((node) => {
        const b = node.getBoundingClientRect();
        return {
          id: node.getAttribute("data-id"),
          visible: getComputedStyle(node).visibility,
          inside:
            b.width > 0 &&
            b.height > 0 &&
            b.left >= frame.left - 1 &&
            b.right <= frame.right + 1 &&
            b.top >= frame.top - 1 &&
            b.bottom <= frame.bottom + 1,
        };
      }),
      edges: el.querySelectorAll(".react-flow__edge").length,
    };
  });
  assert.equal(geometry.nodes.length, 6);
  assert.equal(geometry.edges, 5);
  assert.ok(
    geometry.nodes.every((n) => n.visible === "visible" && n.inside),
    JSON.stringify(geometry),
  );
}

async function savedReplayState(page, runId) {
  return page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("monolith-investigations-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const all = await new Promise((resolve, reject) => {
        const req = db.transaction("runs").objectStore("runs").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const run = all.find((item) => item.id === id);
      return {
        runs: all.length,
        events: run.events.length,
        approval: run.approval ?? null,
        mode: run.mode,
      };
    } finally {
      db.close();
    }
  }, runId);
}

async function checkGuidedReplay(page, name, runId) {
  const before = await savedReplayState(page, runId);
  assert.equal(before.approval, null);
  assert.equal(before.mode, "deterministic");
  await page
    .getByRole("button", { name: "90-second walkthrough", exact: true })
    .click();
  const guide = page.getByRole("dialog", { name: "Guided investigation" });
  await guide.waitFor();
  await guide.getByText("Deterministic run replay", { exact: true }).waitFor();
  await guide.getByText("Synthetic events", { exact: true }).waitFor();
  const navigation = guide.getByRole("navigation", { name: "Replay chapters" });
  assert.equal(await navigation.getByRole("button").count(), 6);
  const scrub = guide.getByRole("slider", { name: "Replay position" });
  assert.equal(await scrub.getAttribute("max"), "90");
  // Reduced motion starts the tour paused. The transport resumes actual time.
  const play = guide.getByRole("button", { name: "Play", exact: true });
  const pause = guide.getByRole("button", { name: "Pause", exact: true });
  await play.waitFor();
  await play.click();
  await pause.waitFor();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('dialog input[aria-label="Replay position"]')
          .value,
      ) > 0,
  );
  await pause.click();
  await play.waitFor();
  const paused = await scrub.inputValue();
  assert.ok(Number(paused) > 0 && Number(paused) < 12);
  const evidence = guide.getByRole("region", { name: "Source evidence" });
  await evidence.getByText("31.15 h", { exact: true }).waitFor();
  const provenance = evidence.locator("details").filter({
    hasText: "Ingestion provenance",
  });
  await provenance.locator("summary").click();
  assert.match(await provenance.innerText(), /northstar-.*\.csv/i);
  await provenance.locator("summary").click();
  await evidence.locator("details.evidence summary").first().click();
  const source = evidence.locator("details.evidence[open]");
  await source.getByText(/\.csv · row \d+ · Synthetic/).waitFor();
  assert.match(await source.innerText(), /EV-[a-f0-9]+/);
  await checkWidth(page, name + " guided evidence");
  await page.screenshot({
    path: path.join(output, "monolith-guided-" + name + "-evidence.png"),
    animations: "disabled",
  });

  const next = guide.getByRole("button", { name: "Next chapter", exact: true });
  const prev = guide.getByRole("button", {
    name: "Previous chapter",
    exact: true,
  });
  await next.click();
  const roles = guide.getByRole("region", { name: "Specialist handoffs" });
  for (const title of [
    "Discovery",
    "Process intelligence",
    "Automation strategy",
    "Solutions architect",
    "Simulation",
    "Verification",
  ]) {
    const button = roles.getByRole("button", { name: title, exact: true });
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.ok(
      (await roles.locator("details:not(.evidence) summary").count()) > 0,
    );
    await roles.getByText("Recorded output", { exact: true }).waitFor();
  }
  await roles.locator("details:not(.evidence) summary").first().click();
  assert.match(
    await roles.locator("details[open] pre").first().innerText(),
    /evidence/,
  );
  await prev.click();
  await evidence.waitFor();
  assert.equal(await scrub.inputValue(), "0");
  await navigation.getByRole("button", { name: /Competing designs/ }).click();
  const designs = guide.getByRole("region", { name: "Competing designs" });
  assert.equal(await designs.getByRole("article").count(), 2);
  await next.click();
  const trials = guide.getByRole("region", { name: "Scenario trials" });
  assert.ok((await trials.getByRole("article").count()) >= 2);
  await trials
    .getByText(/routing failure/)
    .first()
    .waitFor();
  await checkWidth(page, name + " guided trials");
  await page.screenshot({
    path: path.join(output, "monolith-guided-" + name + "-trials.png"),
    animations: "disabled",
  });
  await next.click();
  await guide.getByText("Verification passed", { exact: true }).waitFor();
  await guide
    .getByText("40 checks passed · 0 failed · 2 for review", { exact: true })
    .waitFor();
  await next.click();
  const blueprint = guide.getByRole("region", {
    name: "Implementation blueprint",
  });
  await blueprint
    .getByText("Read-only design preview · awaiting human approval", {
      exact: true,
    })
    .waitFor();
  assert.ok((await blueprint.locator("details").count()) >= 8);
  await blueprint.locator("details summary").first().click();
  assert.ok(
    (await blueprint.locator("details[open] pre").innerText()).length > 20,
  );
  assert.equal(
    await guide.getByRole("button", { name: /approve/i }).count(),
    0,
  );
  await guide
    .getByRole("button", { name: "Exit guided investigation" })
    .click();
  await guide.waitFor({ state: "hidden" });
  assert.deepEqual(
    await savedReplayState(page, runId),
    before,
    "Read-only walkthrough modified the run",
  );
}

async function checkFreshWalkthrough(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const diagnostics = [];
  try {
    await serveExport(context, diagnostics);
    const page = await context.newPage();
    page.on("pageerror", (error) => diagnostics.push(error.message));
    await page.goto(origin + "/#intelligence-studio");
    await page
      .getByRole("button", { name: "90-second walkthrough", exact: true })
      .click();
    const guide = page.getByRole("dialog", { name: "Guided investigation" });
    await guide.waitFor({ timeout: 60_000 });
    await guide
      .getByText("Deterministic run replay", { exact: true })
      .waitFor();
    await guide
      .getByRole("button", { name: "Exit guided investigation" })
      .click();
    const id = await page
      .getByRole("combobox", { name: "Saved investigations" })
      .inputValue();
    const state = await savedReplayState(page, id);
    assert.equal(state.runs, 1);
    assert.equal(state.mode, "deterministic");
    assert.equal(state.approval, null);
    assert.ok(state.events >= 18);
    assert.deepEqual(diagnostics, []);
    console.log(
      "Fresh walkthrough starts one deterministic run with a saved trace and no approval.",
    );
  } finally {
    await context.close();
  }
}

async function checkArchitecture(page, name) {
  const views = page.getByRole("group", { name: "Studio views" });
  await views
    .getByRole("button", { name: "Architecture explorer", exact: true })
    .click();
  const explorer = page.getByRole("region", { name: "Architecture explorer" });
  const tabs = explorer.getByRole("tablist", { name: "Execution components" });
  assert.equal(await tabs.getByRole("tab").count(), 6);
  const first = tabs.getByRole("tab", { name: "Ingestion", exact: true });
  await first.focus();
  await first.press("ArrowRight");
  assert.equal(
    await tabs
      .getByRole("tab", { name: "Frozen scope", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await tabs
    .getByRole("tab", { name: "Frozen scope", exact: true })
    .press("End");
  await explorer
    .getByText("Awaiting human approval", { exact: true })
    .waitFor();
  await explorer
    .getByRole("combobox", { name: "Runtime design" })
    .selectOption("api");
  await tabs.getByRole("tab", { name: "Evaluation", exact: true }).click();
  await explorer
    .getByText("40 objective checks passed", { exact: true })
    .waitFor();
  await explorer
    .locator("summary", { hasText: "Implementation references" })
    .click();
  await explorer
    .getByText("evaluation.py · evaluate", { exact: true })
    .waitFor();
  await checkWidth(page, name + " architecture explorer");
  if (name === "desktop") {
    const previous = page.viewportSize();
    await page.setViewportSize({ width: 820, height: 1180 });
    await checkWidth(page, "tablet architecture explorer");
    await page.screenshot({
      path: path.join(output, "monolith-architecture-tablet.png"),
      animations: "disabled",
    });
    await page.setViewportSize(previous);
  }
  await page.screenshot({
    path: path.join(output, "monolith-architecture-" + name + ".png"),
    animations: "disabled",
  });
  await explorer
    .getByRole("button", { name: "Continuous monitoring", exact: true })
    .click();
  await tabs.getByRole("tab", { name: "Reassessment", exact: true }).click();
  await explorer
    .getByRole("heading", { name: "Later observation", exact: true })
    .waitFor();
  const article = await page.context().newPage();
  const href = await explorer
    .getByRole("link", { name: "Read the case study" })
    .getAttribute("href");
  await article.goto(new URL(href, origin).href);
  await article
    .getByRole("heading", {
      name: "Tracing a refund delay from source to decision.",
    })
    .waitFor();
  await article
    .getByRole("navigation", { name: "Case study sections" })
    .getByRole("link", { name: "Simulation" })
    .click();
  assert.match(await article.getByRole("table").innerText(), /22.34 h/);
  assert.match(await article.getByRole("table").innerText(), /£275.89/);
  await checkWidth(article, name + " engineering case study");
  await article.evaluate(() => window.scrollTo(0, 0));
  await article.screenshot({
    path: path.join(output, "monolith-case-study-" + name + ".png"),
    animations: "disabled",
  });
  await article
    .getByRole("link", { name: "Architecture explorer", exact: false })
    .first()
    .click();
  await article
    .getByRole("region", { name: "Architecture explorer", exact: true })
    .waitFor();
  await article.close();
  await explorer
    .getByRole("button", { name: "Refund investigation", exact: true })
    .click();
  await explorer
    .getByRole("button", { name: "Inspect in Observatory" })
    .click();
  await page
    .getByRole("region", { name: "AI Engineering Observatory" })
    .waitFor();
  await views
    .getByRole("button", { name: "Investigation", exact: true })
    .click();
}

async function checkDevice(browser, name, viewport) {
  const mobile = name === "mobile";
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    locale: "en-GB",
    timezoneId: "UTC",
  });
  const diagnostics = [];
  await serveExport(context, diagnostics);
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    diagnostics.push(error.stack || error.message),
  );
  page.setDefaultTimeout(15_000);
  try {
    await page.goto(origin + "/");
    await page.getByRole("button", { name: /Refund approval delays/i }).click();
    let detail = page.getByRole("dialog");
    await detail.getByRole("button", { name: "Scenario", exact: true }).click();
    const simulation = detail.getByRole("region", {
      name: "Refund routing scenario model",
    });
    const bars = simulation
      .locator("figure")
      .filter({ hasText: "Median authorisation interval" });
    await bars
      .getByText("22.34 h", { exact: true })
      .waitFor({ timeout: 45_000 });
    const coverage = simulation.getByRole("slider", {
      name: "Eligible cases routed",
    });
    await coverage.focus();
    await coverage.press("Home");
    await bars.getByText("31.15 h", { exact: true }).nth(1).waitFor();
    assert.equal(await coverage.inputValue(), "0");
    await checkWidth(page, name + " scenario");

    await detail.getByRole("button", { name: "Finding", exact: true }).click();
    await detail
      .getByRole("button", { name: /Investigate refund delays/i })
      .click();
    await page
      .getByRole("heading", { name: "Investigation outcome", exact: true })
      .waitFor({ timeout: 60_000 });
    await page.getByText("Verified", { exact: true }).waitFor();
    await page.getByText("6 of 6 stages complete", { exact: true }).waitFor();
    await assertStageGeometry(page);
    const saved = page.getByRole("combobox", { name: "Saved investigations" });
    const runId = await saved.inputValue();
    assert.ok(runId, "A completed run should have a persistent ID");
    await checkGuidedReplay(page, name, runId);
    await checkArchitecture(page, name);
    const replay = page.getByRole("slider", { name: "Investigation event" });
    const max = Number(await replay.getAttribute("max"));
    assert.ok(max >= 18, "Expected tool results and stage transitions");
    await page
      .getByRole("button", { name: "Play investigation replay" })
      .click();
    await page.getByRole("button", { name: "Pause replay" }).click();
    assert.ok(Number(await replay.inputValue()) < max);
    await page.getByRole("button", { name: "Jump to latest event" }).click();
    assert.equal(Number(await replay.inputValue()), max);
    await page.getByRole("button", { name: /^Findings \d+/ }).click();
    const findings = page
      .getByRole("heading", { name: "Investigation outcome" })
      .locator("xpath=ancestor::section[1]");
    await findings.locator("details.evidence summary").first().click();
    await findings
      .locator("details.evidence[open]")
      .getByText(/(CSV|PDF|Synthetic)/i)
      .first()
      .waitFor();
    await page.getByRole("button", { name: /^Approaches \d+/ }).click();
    await page.getByRole("button", { name: /Scheduled review digest/ }).click();
    await page.getByRole("button", { name: "Approve design" }).click();
    await findings.getByText("Blueprint approved", { exact: true }).waitFor();
    await checkWidth(page, name + " studio");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(output, "monolith-studio-" + name + ".png"),
      animations: "disabled",
    });
    if (mobile) {
      await page
        .getByRole("heading", { name: "Investigation stages" })
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({
        path: path.join(output, "monolith-studio-mobile-graph.png"),
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Open blueprint" }).click();
    const dossier = page.getByRole("article", {
      name: "Approved implementation blueprint",
    });
    await dossier
      .getByRole("heading", { name: "Scheduled review digest" })
      .waitFor();
    await dossier
      .getByRole("button", { name: "Download", exact: true })
      .waitFor();
    const download = page.waitForEvent("download");
    await dossier
      .getByRole("button", { name: "Download", exact: true })
      .click();
    const file = await download;
    assert.ok(file.suggestedFilename().endsWith(".md"));
    const text = await readFile(await file.path(), "utf8");
    assert.ok(
      text.includes("refund_digest_window") &&
        text.includes("PRIMARY KEY") &&
        text.includes("EV-"),
    );
    await checkWidth(page, name + " blueprint");
    await page.reload();
    await dossier
      .getByRole("heading", { name: "Scheduled review digest" })
      .waitFor();
    await navigateWorkspace(page, "Intelligence studio");
    await findings.getByText("Blueprint approved", { exact: true }).waitFor();
    assert.equal(await saved.inputValue(), runId);

    await navigateWorkspace(page, "Business map");
    const twin = page.getByRole("region", { name: "Business digital twin" });
    await twin.getByRole("heading", { name: "Systems and handoffs" }).waitFor();
    await twin
      .getByRole("combobox", { name: "Filter by system" })
      .selectOption({ label: "Finance" });
    await twin
      .getByRole("group", { name: "Graph layers" })
      .getByRole("button", { name: "Events", exact: true })
      .click();
    await twin.getByRole("combobox", { name: "Case timeline" }).waitFor();
    await twin
      .getByRole("combobox", { name: "Filter by system" })
      .selectOption("");
    const inspect = twin.getByRole("combobox", {
      name: "Inspect a graph entity or relationship",
    });
    const event = inspect.locator('optgroup[label="Entities"] option').first();
    await inspect.selectOption(await event.getAttribute("value"));
    await twin.getByRole("heading", { name: "Source evidence" }).waitFor();
    await twin.locator("details.evidence summary").first().click();
    await twin
      .locator("details.evidence[open]")
      .getByText(/Synthetic/i)
      .first()
      .waitFor();
    await checkWidth(page, name + " digital twin");
    await page.getByRole("button", { name: "System topology", exact: true }).click();
    const topology = page.getByRole("region", { name: "System topology explorer" });
    const routeSelect = topology.getByRole("combobox", { name: "Inspect a system or handoff" });
    const routeOption = routeSelect.locator('optgroup[label="Handoffs"] option').first();
    const routeValue = await routeOption.getAttribute("value");
    const [from, to] = JSON.parse(routeValue.slice("route:".length));
    await routeSelect.selectOption(routeValue);
    const routeInspector = topology.getByRole("complementary", { name: "System inspector" });
    await routeInspector.getByRole("heading", { name: from + " → " + to }).waitFor();
    const sourceRows = routeInspector.locator("details.evidence");
    assert.ok((await sourceRows.count()) >= 2);
    await sourceRows.first().locator("summary").click();
    await sourceRows.first().getByText(/\.csv · row \d+ · Synthetic/).waitFor();
    await routeInspector.getByRole("button", { name: "To " + to, exact: true }).click();
    await routeInspector.getByRole("heading", { name: to, exact: true }).waitFor();
    await checkWidth(page, name + " system handoff");
    assert.deepEqual(diagnostics, []);
    console.log(
      name +
        ": scenario, six-stage run, guided walkthrough, architecture explorer, case study, Observatory, replay, approval, exported blueprint, reload, twin and layout passed.",
    );
  } catch (error) {
    await page
      .screenshot({
        path: path.join(output, "monolith-" + name + "-failure.png"),
      })
      .catch(() => {});
    const applicationText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    console.error(
      name + " diagnostics:",
      diagnostics,
      "Visible UI:",
      applicationText.slice(0, 3200),
    );
    throw error;
  } finally {
    await context.close();
  }
}

await access(path.join(dist, "index.html"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
try {
  await checkFreshWalkthrough(browser);
  await checkDevice(browser, "desktop", { width: 1512, height: 982 });
  await checkDevice(browser, "mobile", { width: 390, height: 844 });
  console.log("Screenshots:", output);
} finally {
  await browser.close();
}
