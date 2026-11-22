/**
 * End-to-end check of a production export in Chromium. All HTTP requests are
 * fulfilled from dist; the browser still executes the shipped JS, WASM,
 * dedicated worker and IndexedDB. No API, provider or external network access.
 *
 * npm run build && node scripts/test-studio-browser.mjs
 * Set CHROMIUM_PATH as needed; set MONOLITH_QA_OUTPUT to retain screenshots.
 */
import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const project = fileURLToPath(new URL("../", import.meta.url));
const dist = path.resolve(project, "dist");
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

async function nav(page, title, mobile) {
  if (mobile)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside.sidebar")
    .getByRole("button", { name: title, exact: true })
    .click();
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
    await page.getByText("6/6", { exact: true }).waitFor();
    const saved = page.getByRole("combobox", { name: "Saved investigations" });
    const runId = await saved.inputValue();
    assert.ok(runId, "A completed run should have a persistent ID");
    await checkGuidedReplay(page, name, runId);
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
        .getByRole("heading", { name: "Investigation graph" })
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
    await nav(page, "Intelligence studio", mobile);
    await findings.getByText("Blueprint approved", { exact: true }).waitFor();
    assert.equal(await saved.inputValue(), runId);

    await nav(page, "Business map", mobile);
    const twin = page.getByRole("region", { name: "Business digital twin" });
    await twin.getByRole("heading", { name: "Operational twin" }).waitFor();
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
    assert.deepEqual(diagnostics, []);
    console.log(
      name +
        ": scenario, run, guided walkthrough, replay, verification, approval, exported blueprint, reload, twin and layout passed.",
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
