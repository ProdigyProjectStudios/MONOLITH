import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { serveExport } from "./serve-test-export.mjs";
const root = path.resolve("dist");
const seed = JSON.parse(await readFile(path.join(root, "demo.json")));
const allowed = new Set(seed.report.case_ids);
const days = new Map();
const latest = new Map();
for (const e of seed.data.events.filter((e) => allowed.has(e.case))) {
  const day = new Date(e.timestamp).toISOString().slice(0, 10);
  days.set(day, (days.get(day) ?? 0) + 1);
  if (
    !latest.has(day) ||
    Date.parse(e.timestamp) > Date.parse(latest.get(day).timestamp)
  )
    latest.set(day, e);
}
const recent = [...days.keys()].sort().slice(-6);
const server = await serveExport(root);
const url = "http://127.0.0.1:" + server.address().port + "/";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
try {
  for (const [width, motion] of [
    [1440, "no-preference"],
    [390, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 940 },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const capture = async (target, name) => {
      if (process.env.INSTRUMENT_QA) {
        await mkdir(process.env.INSTRUMENT_QA, { recursive: true });
        await target.screenshot({
          path: path.join(
            process.env.INSTRUMENT_QA,
            name + "-" + width + ".png",
          ),
        });
      }
    };
    await page.goto(url + "?v=qa&studio=observatory#intelligence-studio");
    const signal = page.getByRole("region", { name: "Activity signal" });
    const field = signal.getByRole("group", { name: "Activity by interval" });
    await signal
      .getByRole("heading", { name: "Source activity", exact: true })
      .waitFor();
    assert.equal(await field.getByRole("button").count(), recent.length);
    await field.getByRole("button").first().click();
    await signal
      .getByText(days.get(recent[0]) + " source events", { exact: true })
      .waitFor();
    await signal.locator("details.evidence summary").click();
    assert(
      (await signal.locator("details[open]").innerText()).includes(
        latest.get(recent[0]).id,
      ),
    );
    await signal.locator("details.evidence summary").click();
    await signal.getByRole("button", { name: "Pause signal motion" }).click();
    const canvas = field.locator("canvas");
    const before = await canvas.evaluate((c) => c.toDataURL());
    await page.waitForTimeout(180);
    assert.equal(await canvas.evaluate((c) => c.toDataURL()), before);
    await capture(signal, "observatory");
    const studio = page.getByRole("group", { name: "Studio views" });
    await studio.getByRole("button", { name: "Architecture explorer" }).click();
    assert.equal(
      new URL(page.url()).searchParams.get("studio"),
      "architecture",
    );
    await page.reload();
    const architecture = page.getByRole("region", {
      name: "Architecture explorer",
      exact: true,
    });
    const transfer = architecture.getByRole("group", {
      name: "Component transfer",
    });
    await transfer.getByRole("heading", { name: "Source register" }).waitFor();
    const tabs = architecture.getByRole("tablist", {
      name: "Execution components",
    });
    await tabs.getByRole("tab", { name: "Ingestion" }).press("ArrowRight");
    await transfer
      .getByRole("heading", { name: "Investigation snapshot" })
      .waitFor();
    await architecture
      .getByRole("combobox", { name: "Runtime design" })
      .selectOption("api");
    await transfer
      .getByRole("button", { name: "Inspect implementation" })
      .click();
    const drawer = architecture.getByRole("tabpanel");
    assert(await drawer.evaluate((e) => e === document.activeElement));
    await drawer.getByRole("heading", { name: "API implementation" }).waitFor();
    await transfer
      .getByRole("button", { name: "Pause contract motion" })
      .click();
    await capture(transfer, "architecture");
    await architecture
      .getByRole("button", { name: "Continuous monitoring" })
      .click();
    await tabs.getByRole("tab").first().press("End");
    await transfer
      .getByRole("heading", { name: "Later observation" })
      .waitFor();
    await page.goBack();
    await signal.getByRole("heading", { name: "Source activity" }).waitFor();
    await page.goForward();
    await transfer.getByRole("heading", { name: "Source register" }).waitFor();
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
    });
    await transfer.evaluate((e) => e.scrollIntoView({ block: "center" }));
    const issues = await page.evaluate(async () =>
      (
        await window.axe.run(
          document.querySelector('[aria-label="Component transfer"]'),
          {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          },
        )
      ).violations.map((v) => [v.id, v.nodes.map((n) => n.target)]),
    );
    assert.deepEqual(issues, []);
    await studio
      .getByRole("button", { name: "Investigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run deterministic investigation" })
      .click();
    await page
      .getByRole("heading", { name: "Investigation outcome" })
      .waitFor({ timeout: 60000 });
    await studio
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await signal
      .getByRole("heading", { name: "Specialist activity" })
      .waitFor();
    await field.getByRole("button", { name: /Verification/ }).click();
    await signal.getByRole("button", { name: "Inspect stage trace" }).click();
    assert.equal(
      await page.getByRole("combobox", { name: "Trace stage" }).inputValue(),
      "verification",
    );
    await page
      .getByRole("button", { name: "Compare runs", exact: true })
      .click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      "Passed source counts and evidence, run trace, architecture paths and runtime, keyboard, deep links and history",
      width,
      motion,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
