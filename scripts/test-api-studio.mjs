/**
 * Browser integration test for a separately compiled API-mode build and an
 * isolated API, SQLite database and Redis instance. Leave their RQ queue
 * without workers: this test starts burst workers after observing actual
 * requests so the browser subscribes to SSE before the investigation starts.
 *
 * Supply QA_WEB_ORIGIN, QA_API_ORIGIN, QA_WORKSPACE_TOKEN, QA_OTHER_TOKEN,
 * REDIS_URL and DATABASE_URL. Set QA_CONNECT_RUNTIME=1 to test the standalone
 * export through its Data sources connection form. Otherwise build with
 * NEXT_PUBLIC_API_URL set to QA_API_ORIGIN. CHROMIUM_PATH defaults to /usr/bin/chromium.
 */
import assert from "node:assert/strict";
import { navigateWorkspace } from "./workspace-navigation.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(repo, "apps/api");
const {
  QA_WEB_ORIGIN: web,
  QA_API_ORIGIN: api,
  QA_WORKSPACE_TOKEN: token,
  QA_OTHER_TOKEN: other,
  REDIS_URL: redis,
  DATABASE_URL: db,
} = process.env;
assert.ok(
  web && api && token && other && redis && db,
  "Configure isolated QA origins, credentials, database and queue.",
);
assert.ok(
  [web, api, redis].every((value) =>
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
  ) && db.startsWith("sqlite:///"),
  "Dedicated loopback fixtures required.",
);
const workers = new Set();
function burst() {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const child = spawn(
    path.join(dir, ".venv/bin/rq"),
    ["worker", "--burst", "--url", redis, "monolith"],
    { cwd: dir, env, stdio: "ignore" },
  );
  workers.add(child);
  return once(child, "exit").then(([code]) => {
    workers.delete(child);
    assert.equal(code, 0, "RQ worker exit");
  });
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--disable-dev-shm-usage", "--no-proxy-server"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1470, height: 920 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  // Chromium may evict an SSE body from its DevTools network cache before the
  // test reads it. Capture the actual browser subscription as fetch resolves.
  await context.addInitScript(() => {
    const originalFetch = window.fetch;
    window.qaStreamBodies = new Map();
    window.fetch = async (...args) => {
      const response = await originalFetch.apply(window, args);
      if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
        window.qaStreamBodies.set(response.url, response.clone().text());
      }
      return response;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const responseFor = (suffix, method = "GET") =>
    page.waitForResponse(
      (r) =>
        r.url() === api + "/api/" + suffix && r.request().method() === method,
    );
  const loadReport = async (action) => {
    const req = responseFor("report?days=30");
    await action();
    const { report } = await (await req).json();
    assert.ok(report.events > 0, "Authenticated read-only report restored");
  };
  const attach = process.env.QA_CONNECT_RUNTIME === "1";
  const nav = (name) => navigateWorkspace(page, name);
  const gate = responseFor("workspace");
  await page.goto(web + "/");
  if (attach) {
    await nav("Data sources");
    await page.getByText("Browser · deterministic", { exact: true }).waitFor();
    const health = responseFor("health");
    await page.getByLabel("MONOLITH API URL").fill(api);
    await page
      .getByRole("button", { name: "Connect API", exact: true })
      .click();
    const probe = await health;
    assert.equal(probe.status(), 200);
    assert.equal(await probe.request().headerValue("authorization"), null);
  }
  assert.equal((await gate).status(), 401);
  await page.getByLabel("Workspace access token").fill(token);
  await loadReport(() =>
    page.getByRole("button", { name: "Connect", exact: true }).click(),
  );
  if (attach) {
    await page.getByText("API · deterministic", { exact: true }).waitFor();
    await nav("Overview");
  }
  await page.getByRole("button", { name: /Refund approval delays/i }).click();
  const detail = page.getByRole("dialog");
  await detail.getByRole("button", { name: "Scenario", exact: true }).click();
  const model = detail.getByRole("region", {
    name: "Refund routing scenario model",
  });
  await model.getByText("22.34 h", { exact: true }).first().waitFor();
  await detail.getByRole("button", { name: "Finding", exact: true }).click();

  const sent = responseFor("investigations", "POST");
  const subscribed = page.waitForRequest(
    (r) =>
      r.url().startsWith(api + "/api/investigations/") &&
      r.url().includes("/events?after="),
  );
  const streamed = page.waitForResponse(
    (r) =>
      r.url().startsWith(api + "/api/investigations/") &&
      r.url().includes("/events?after="),
  );
  await detail
    .getByRole("button", { name: /Investigate refund delays/i })
    .click();
  const queued = await (await sent).json();
  assert.equal(queued.status, "queued");
  assert.equal(queued.mode, "deterministic");
  const request = await subscribed;
  assert.ok(
    await request.headerValue("authorization"),
    "SSE request has the workspace credential.",
  );
  const now = await (
    await context.request.get(api + "/api/investigations/" + queued.id, {
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  assert.equal(
    now.status,
    "queued",
    "The real browser subscribed before worker execution",
  );
  const completed = burst();
  const response = await streamed;
  assert.equal(response.status(), 200);
  assert.match(
    await response.headerValue("content-type"),
    /^text\/event-stream/,
  );
  await page.waitForFunction(url => window.qaStreamBodies.has(url), response.url());
  const streamBody = await page.evaluate(url => window.qaStreamBodies.get(url), response.url());
  const frames = streamBody
    .split(/\r?\n/)
    .filter((v) => v.startsWith("data: "))
    .map((v) => JSON.parse(v.slice(6)));
  assert.deepEqual(
    frames.filter((f) => f.kind === "stage_completed").map((f) => f.stage),
    [
      "discovery",
      "process",
      "strategy",
      "architect",
      "simulation",
      "verification",
    ],
  );
  assert.ok(frames.filter((f) => f.kind === "tool_result").length >= 6);
  assert.equal(frames.at(-1).kind, "run_completed");
  await completed;
  await page.getByText("6 of 6 stages complete", { exact: true }).waitFor();
  await page.getByText("Verified", { exact: true }).waitFor();
  const saved = page.getByRole("combobox", { name: "Saved investigations" });
  assert.equal(await saved.inputValue(), queued.id);
  await page.getByRole("button", { name: /^Findings \d+/ }).click();
  const finding = page
    .getByRole("heading", { name: "Investigation outcome" })
    .locator("xpath=ancestor::section[1]");
  await finding.locator("details.evidence summary").first().click();
  await finding
    .locator("details.evidence[open]")
    .getByText(/Synthetic/i)
    .first()
    .waitFor();
  await page.getByRole("button", { name: /^Approaches \d+/ }).click();
  await page.getByRole("button", { name: /Scheduled review digest/ }).click();
  const approve = responseFor(
    "investigations/" + queued.id + "/approve",
    "POST",
  );
  await page.getByRole("button", { name: "Approve design" }).click();
  assert.equal((await (await approve).json()).approval.approach, "batch");
  await page.getByRole("button", { name: "Open blueprint" }).click();
  const dossier = page.getByRole("article", {
    name: "Approved implementation blueprint",
  });
  await dossier
    .getByRole("heading", { name: "Scheduled review digest" })
    .waitFor();
  const download = page.waitForEvent("download");
  await dossier.getByRole("button", { name: "Download", exact: true }).click();
  const artifact = await readFile(await (await download).path(), "utf8");
  assert.ok(
    artifact.includes("refund_digest_window") &&
      artifact.includes("PRIMARY KEY") &&
      artifact.includes("EV-"),
  );
  await loadReport(() => page.reload());
  await dossier
    .getByRole("heading", { name: "Scheduled review digest" })
    .waitFor();
  await nav("Intelligence studio");
  await finding.getByText("Blueprint approved", { exact: true }).waitFor();
  assert.equal(await saved.inputValue(), queued.id);
  await nav("Data sources");
  await page.getByRole("button", { name: /northstar-controls\.pdf/ }).click();
  await page.locator("details.evidence summary").first().click();
  await page
    .locator("details.evidence[open]")
    .getByText(/human reviewer/i)
    .first()
    .waitFor();
  const privateRun = api + "/api/investigations/" + queued.id;
  for (const suffix of ["", "/events", "/snapshot"]) {
    const res = await context.request.get(privateRun + suffix, {
      headers: { Authorization: "Bearer " + other },
    });
    assert.equal(res.status(), 404);
  }
  assert.deepEqual(errors, []);
  console.log(
    `Browser authenticated, received ${frames.length} ordered SSE frames with six completed stages, approved batch, exported blueprint, restored the run on refresh, inspected the policy PDF and verified tenant isolation.`,
  );
} finally {
  for (const child of workers) child.kill("SIGTERM");
  await browser.close();
}
