import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { serveExport } from "./serve-test-export.mjs";

const server = await serveExport(path.resolve("dist"));
const origin = "http://127.0.0.1:" + server.address().port + "/";
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
      viewport: { width, height: 950 },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "#overview");
    const sparks = page.locator(".spark-sweep");
    await sparks.first().waitFor({ state: "attached" });
    assert.equal(await sparks.count(), 4);
    assert(
      await sparks.evaluateAll((paths) =>
        paths.every(
          (p) =>
            p.getAttribute("d") === p.previousElementSibling.getAttribute("d"),
        ),
      ),
    );
    if (motion === "reduce")
      assert.equal(
        await sparks.first().evaluate((p) => p.getAnimations().length),
        0,
      );
    else {
      await sparks.first().scrollIntoViewIfNeeded();
      const offset = () =>
        sparks.first().evaluate((p) => getComputedStyle(p).strokeDashoffset);
      const before = await offset();
      await page.waitForTimeout(350);
      assert.notEqual(await offset(), before);
      await page.getByRole("button", { name: "Field options" }).click();
      await page.getByRole("menuitem", { name: "Pause motion" }).click();
      assert.equal(
        await sparks.first().evaluate((p) => p.getAnimations().length),
        0,
      );
    }
    await page.goto(origin + "#intelligence-studio");
    const focus = page.getByRole("group", { name: "Specialist focus" });
    await focus
      .getByRole("button", { name: "Inspect Discovery", exact: true })
      .waitFor();
    const signature = focus.locator("svg[data-role]");
    const shape = await signature.locator("path").first().getAttribute("d");
    await focus.getByRole("button", { name: "Next specialist" }).click();
    await focus
      .getByRole("button", {
        name: "Inspect Process intelligence",
        exact: true,
      })
      .click();
    const inspector = page.getByRole("complementary", {
      name: "Specialist inspector",
    });
    assert(await inspector.evaluate((el) => el === document.activeElement));
    assert.notEqual(
      await signature.locator("path").first().getAttribute("d"),
      shape,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Process intelligence", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await focus.getByRole("button", { name: "Pause studio motion" }).click();
    await focus.getByRole("button", { name: "Resume studio motion" }).waitFor();
    await focus.getByRole("button", { name: "Previous specialist" }).click();
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
    });
    const issues = await page.evaluate(async () =>
      (
        await window.axe.run(
          document.querySelector('[aria-label="Investigation brief"]'),
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
    const interval = page.locator("figure").filter({
      has: page.getByRole("slider", {
        name: "Inspect refund interval bucket",
      }),
    });
    await interval.getByText("Inspect source events").click();
    const pair = interval.locator("details[open]>details").first();
    await pair.locator("summary").first().click();
    assert.equal(await pair.locator(".evidence").count(), 2);
    await pair.getByText("Invoice rekeyed", { exact: false }).first().waitFor();
    await pair
      .getByText("Refund authorised", { exact: false })
      .first()
      .waitFor();
    if (process.env.STUDIO_FOCUS_QA) {
      await mkdir(process.env.STUDIO_FOCUS_QA, { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: path.join(
          process.env.STUDIO_FOCUS_QA,
          "studio-" + width + ".png",
        ),
      });
      await page
        .getByRole("region", { name: "Investigation work surface" })
        .screenshot({
          path: path.join(
            process.env.STUDIO_FOCUS_QA,
            "work-" + width + ".png",
          ),
        });
    }
    await page
      .getByRole("button", {
        name: "Run deterministic investigation",
        exact: true,
      })
      .click();
    await page
      .getByRole("heading", { name: "Investigation outcome" })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Review decision", exact: true })
      .click();
    assert(
      await page.evaluate(
        () =>
          document.activeElement.getAttribute("aria-label") ===
          "Review investigation decision",
      ),
    );
    await page
      .getByRole("button", { name: "Play investigation replay" })
      .click();
    await page.getByRole("button", { name: "Pause replay" }).click();
    await page.getByRole("button", { name: "Jump to latest event" }).click();
    await page.getByRole("button", { name: "Discovery", exact: true }).click();
    await focus.getByRole("button", { name: "Inspect Discovery" }).waitFor();
    await inspector.getByRole("button", { name: /^Evidence/ }).click();
    assert((await inspector.locator(".evidence").count()) > 0);
    await page.getByRole("button", { name: "Follow event selection" }).click();
    await page
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await page
      .getByRole("heading", { name: /AI Engineering Observatory/i })
      .waitFor();
    await page
      .getByRole("button", { name: "Architecture explorer", exact: true })
      .click();
    await page
      .getByRole("heading", { name: /Architecture explorer/i })
      .first()
      .waitFor();
    await page
      .getByRole("button", { name: "Investigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve design", exact: true })
      .click();
    await page
      .getByLabel("Review investigation decision")
      .getByText("Blueprint approved", { exact: true })
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page
      .getByRole("button", { name: "Open blueprint", exact: true })
      .click();
    const filePromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const file = await filePromise;
    assert((await readFile(await file.path(), "utf8")).includes("EV-"));
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      "Passed Overview indicators, Studio focus, evidence, replay, specialist views, approval and export",
      width,
      motion,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
