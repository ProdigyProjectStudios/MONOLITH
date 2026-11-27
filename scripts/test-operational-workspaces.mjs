import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { serveExport } from "./serve-test-export.mjs";

const seed = JSON.parse(await readFile("dist/demo.json", "utf8"));
const web = await serveExport(path.resolve("dist"));
const origin = "http://127.0.0.1:" + web.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
try {
  for (const [width, motion] of [
    [1440, "no-preference"],
    [390, "reduce"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: motion,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", (r) =>
      new URL(r.request().url()).origin === origin
        ? r.continue()
        : (errors.push("Unexpected external origin"), r.abort()),
    );
    const go = async (route) => {
      await page.goto(origin + "/#" + route);
      await page.locator("[data-field-skin] h1").waitFor();
    };
    const check = async (name) => {
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        name + " horizontal overflow",
      );
      if (process.env.OPERATIONAL_QA) {
        await mkdir(process.env.OPERATIONAL_QA, { recursive: true });
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.screenshot({
          path: path.join(
            process.env.OPERATIONAL_QA,
            name + "-" + width + ".jpg",
          ),
          type: "jpeg",
          quality: 72,
        });
      }
    };
    await go("opportunities");
    const finding = seed.report.recommendations.at(-1);
    await page.getByLabel("Inspect finding").selectOption(finding.id);
    const focus = page
      .locator("aside")
      .filter({ has: page.getByRole("button", { name: "Open finding" }) });
    assert((await focus.innerText()).includes(finding.title));
    assert((await focus.innerText()).includes(finding.score + "/100"));
    await focus.getByRole("button", { name: "Open finding" }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await check("opportunities");
    await go("technical-blueprint");
    await page.getByLabel("Blueprint opportunity").selectOption("refund");
    const nodes = seed.report.blueprints.refund.nodes;
    const pathGroup = page.getByRole("group", {
      name: "Proposed architecture flow",
    });
    assert.equal(await pathGroup.getByRole("listitem").count(), nodes.length);
    const transfer = pathGroup.getByRole("button", {
      name: "Inspect transfer from " + nodes[1] + " to " + nodes[2],
    });
    await transfer.click();
    assert.equal(await transfer.getAttribute("aria-pressed"), "true");
    await pathGroup
      .getByRole("button", { name: "Pause transfer motion" })
      .click();
    await pathGroup
      .getByRole("button", { name: "Resume transfer motion" })
      .waitFor();
    await check("technical-blueprint");
    await go("continuous-intelligence");
    const slider = page.getByRole("slider", { name: "Scrub observed periods" });
    await slider.waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "cases", exact: true }).click();
    await slider.focus();
    await slider.press("Home");
    const selected = await slider.getAttribute("aria-valuetext");
    assert.match(selected, /cases$/);
    await check("continuous-intelligence");
    await page
      .getByRole("button", { name: "Inspect observed periods" })
      .click();
    const epoch = page.getByRole("combobox", { name: "Observed period" });
    assert(
      (await epoch.locator("option:checked").innerText()).startsWith(
        selected.split(",")[0],
      ),
    );
    await go("agent-activity");
    const region = page.getByRole("region", { name: "Recorded stage timing" });
    const timing = region.getByRole("group", {
      name: "Recorded stage durations",
    });
    await timing.getByRole("button").first().click();
    const task = seed.report.traces[0];
    assert((await region.innerText()).includes(task.tool));
    assert((await region.innerText()).includes(task.ms.toFixed(2)));
    await check("agent-activity");
    await region.getByRole("button", { name: "Inspect execution" }).click();
    assert(await page.locator("details[open] summary:focus").count());
    await go("data-sources");
    const coverage = page.getByRole("region", { name: "Source coverage" });
    const source = seed.data.sources.find((s) => s.kind === "PDF");
    await coverage.getByLabel("Inspect source").selectOption(source.id);
    const doc = seed.data.docs.find((d) => d.source === source.id);
    await coverage.getByLabel("Source evidence").selectOption(doc.id);
    await coverage.locator("summary").click();
    assert(
      (await coverage.locator("details[open]").innerText()).includes(doc.id),
    );
    const csv = seed.data.sources.find((s) => s.kind === "CSV");
    await coverage.getByLabel("Inspect source").selectOption(csv.id);
    assert(
      (await coverage.innerText()).includes(
        seed.data.events
          .filter((e) => e.source === csv.id)
          .length.toLocaleString("en-GB"),
      ),
    );
    await check("data-sources");
    assert.deepEqual(errors, []);
    console.log("Five workspaces passed at", width, motion);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => web.close(resolve));
}
