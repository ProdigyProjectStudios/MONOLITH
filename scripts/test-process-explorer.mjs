import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright-core";
import { ribbonSection } from "../apps/web/lib/processRibbon.ts";
import { serveExport } from "./serve-test-export.mjs";

const root = path.resolve("dist");
const seed = JSON.parse(await readFile(path.join(root, "demo.json")));
const server = await serveExport(root);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const url = "http://127.0.0.1:" + server.address().port + "/#process-explorer";
const hours = (a, b) =>
  (Date.parse(b.timestamp) - Date.parse(a.timestamp)) / 3600000;
const formatted = (n) => Number(n.toFixed(2)).toLocaleString("en-US") + " h";
const cases = Map.groupBy(
  seed.data.events.filter((e) => seed.report.case_ids.includes(e.case)),
  (e) => e.case,
);
const path0 = seed.report.paths[0];
const matching = [...cases.values()]
  .map((rows) =>
    rows.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    ),
  )
  .filter(
    (rows) =>
      JSON.stringify(rows.map((e) => e.activity)) ===
      JSON.stringify(path0.steps),
  );
const medians = path0.steps.map((_, i) => {
  if (!i) return 0;
  const values = matching
    .map((rows) => hours(rows[i - 1], rows[i]))
    .sort((a, b) => a - b);
  return (
    (values[Math.ceil(values.length / 2) - 1] +
      values[Math.floor(values.length / 2)]) /
    2
  );
});
const peak = medians.indexOf(Math.max(...medians));
assert.equal(path0.count, matching.length);
try {
  for (const [width, motion] of [
    [1440, "no-preference"],
    [390, "no-preference"],
    [390, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: motion,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    const timing = page.getByRole("region", { name: "Variant timing" });
    const evidence = page.getByRole("region", { name: "Case evidence" });
    const ledger = page.getByRole("group", {
      name: "Observed process sequence",
    });
    const field = page.getByRole("group", { name: "Process timing field" });
    await timing
      .getByRole("heading", { name: path0.steps[peak], exact: true })
      .waitFor();
    await timing.getByText(formatted(medians[peak]), { exact: true }).waitFor();
    assert.equal(await ledger.getByRole("button").count(), path0.steps.length);
    assert.equal(
      await evidence.getByRole("combobox").locator("option").count(),
      matching.length,
    );
    const canvas = field.locator("canvas");
    await canvas.scrollIntoViewIfNeeded();
    const dimensions = await canvas.boundingBox();
    const marker = await field.getByRole("button").first().boundingBox();
    assert(dimensions.y + dimensions.height <= marker.y + 1, "canvas clears the number row");
    // The section and its extrema are affine in both inputs. Checking these
    // corners bounds every phase, including both extremes of the fibre fold.
    for (const pressure of [0, 1]) {
      for (const wave of [-1, 1]) {
        const { middle, spread } = ribbonSection(dimensions.height, pressure, wave);
        assert(middle - spread - 2 >= dimensions.height * 0.10, "headroom at the crest");
        assert(middle + spread + 2 < dimensions.height, "clearance under the trough");
      }
    }
    const frames = async () => {
      const before = await canvas.evaluate((c) => c.toDataURL());
      await page.waitForTimeout(250);
      return before === (await canvas.evaluate((c) => c.toDataURL()));
    };
    assert.equal(await frames(), motion === "reduce");
    await timing.getByRole("button", { name: "Pause process motion" }).click();
    await timing.getByRole("button", { name: "Play process motion" }).waitFor();
    assert(await frames(), "paused scene stays still");
    if (process.env.PROCESS_QA_OUTPUT) {
      await mkdir(process.env.PROCESS_QA_OUTPUT, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(
          process.env.PROCESS_QA_OUTPUT,
          "process-" + width + ".png",
        ),
        fullPage: true,
      });
    }
    const other = matching.at(-1);
    await evidence.getByRole("combobox").selectOption(other[0].case);
    const recordDetails = evidence.locator(".evidence:visible");
    assert.equal(await recordDetails.count(), 2);
    for (const [i, row] of [other[peak - 1], other[peak]].entries()) {
      await recordDetails.nth(i).locator("summary").click();
      assert(
        (await recordDetails.nth(i).innerText()).includes(row.id.slice(0, 11)),
      );
      assert((await recordDetails.nth(i).innerText()).includes(row.case));
    }
    await evidence
      .getByText(formatted(hours(other[peak - 1], other[peak])), {
        exact: true,
      })
      .waitFor();
    await evidence.getByText("Full case timeline").click();
    assert.equal(await recordDetails.count(), other.length + 2);
    await canvas.click({ position: { x: 4, y: 10 } });
    await timing.getByText("Starting activity").waitFor();
    const second = field.getByRole("button").nth(1);
    await second.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await ledger.getByRole("button").nth(1).getAttribute("aria-pressed"),
      "true",
    );
    await ledger.getByRole("button").last().click();
    await timing
      .getByRole("heading", { name: path0.steps.at(-1), exact: true })
      .waitFor();
    await timing.getByRole("combobox").selectOption("1");
    assert.equal(
      await ledger.getByRole("button").count(),
      seed.report.paths[1].steps.length,
    );
    assert.equal(
      await evidence.getByRole("combobox").locator("option").count(),
      seed.report.paths[1].count,
    );
    const bottlenecks = page.getByRole("region", {
      name: "Workspace bottlenecks",
    });
    await bottlenecks.locator("summary").first().click();
    assert(await bottlenecks.locator(".evidence").first().isVisible());
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
    });
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(
          document.querySelector('[aria-label="Variant timing"]').parentElement,
          {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          },
        )
      ).violations.map((v) => [v.id, v.nodes.map((n) => n.target)]),
    );
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      "Passed Process Explorer",
      width,
      motion,
      path0.count,
      "cases, peak",
      formatted(medians[peak]),
    );
  }
  // A repeated activity on opposite sides of a chart window must open
  // the two source rows for its own occurrence, even when timestamps tie.
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const extended = structuredClone(seed);
  const labels = [
    "Received",
    "Assigned",
    "Reviewed",
    "Assigned",
    "Reviewed",
    "Split",
    "Joined",
    "Reviewed",
    "Completed",
  ];
  const rows = labels.map((activity, i) => ({
    ...seed.data.events[0],
    case: "QA-9",
    id: "QA-E0" + i,
    activity,
    timestamp: new Date(Date.UTC(2026, 10, 18, Math.min(i, 7))).toISOString(),
  }));
  extended.data.events = [...rows].reverse();
  Object.assign(extended.report, {
    case_ids: ["QA-9"],
    cases: 1,
    paths: [{ steps: labels, count: 1 }],
    bottlenecks: [],
  });
  await page.route("**/demo.json", (r) => r.fulfill({ json: extended }));
  await page.goto(url);
  await page.getByRole("button", { name: "Next steps" }).click();
  const evidence = page.getByRole("region", { name: "Case evidence" });
  await evidence.getByText("QA-E07", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Inspect step 9, Completed" }).click();
  await evidence.getByText("0 h", { exact: true }).waitFor();
  assert.equal(
    await evidence
      .locator(".evidence:visible > summary code")
      .allTextContents()
      .then((v) => v.join(",")),
    "QA-E07,QA-E08",
  );
  await page.getByRole("button", { name: "Previous steps" }).click();
  await page.getByRole("button", { name: "Inspect step 7, Joined" }).waitFor();
  extended.report.paths = [];
  await page.reload();
  await page
    .getByText("Import an event log to discover a process path.")
    .waitFor();
  await page.close();
  console.log(
    "Passed repeated activities, tied timestamps, long sequence and empty state",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
