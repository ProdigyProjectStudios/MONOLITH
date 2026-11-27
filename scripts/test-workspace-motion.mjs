import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";
import { serveExport } from "./serve-test-export.mjs";

const server = await serveExport(path.resolve("dist")),
  origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const routes = [
  "Overview",
  "Business map",
  "Process explorer",
  "Opportunities",
  "Technical blueprint",
  "Intelligence studio",
  "Continuous intelligence",
  "Agent activity",
  "Data sources",
];
try {
  for (const [width, mode] of [
    [1360, "no-preference"],
    [390, "no-preference"],
    [390, "reduce"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 650 },
      reducedMotion: mode,
    });
    await context.addInitScript(() => {
      window.motionLog = [];
      window.exits = [];
      new MutationObserver((records) => {
        for (const { target } of records) {
          if (
            target instanceof HTMLElement &&
            target.dataset.motionPhase === "exit"
          )
            window.exits.push({
              kind: target.dataset.motionSurface,
              inert: target.inert,
              route: document.querySelector(".shell")?.dataset.workspace,
            });
        }
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-motion-phase"],
      });
      function record(name) {
        if (name?.startsWith("workspace-"))
          window.motionLog.push({
            name,
            route: document.querySelector(".shell")?.dataset.workspace,
            y: window.scrollY,
          });
      }
      document.addEventListener(
        "animationstart",
        (event) => record(event.animationName),
        true,
      );
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        record(animation.id);
        return animation;
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", (r) =>
      new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
    );
    const moving = mode === "no-preference";
    for (const label of routes) {
      console.log("Checking", width, mode, label);
      const hash = label.toLowerCase().replaceAll(" ", "-");
      await page.goto(origin + "/?motion-check=" + hash + "#" + hash);
      const shell = page.locator('.shell[data-workspace="' + label + '"]');
      await shell
        .locator(".page-content section")
        .first()
        .waitFor({ timeout: 60000 });
      if (label === "Continuous intelligence")
        await page
          .getByRole("heading", { name: "Change monitor" })
          .waitFor({ timeout: 60000 });
      if (moving) {
        await page.waitForFunction(
          (l) =>
            window.motionLog.some(
              (x) => x.route === l && x.name === "workspace-page-in",
            ),
          label,
        );
        const distance = await page.evaluate(
          () => document.documentElement.scrollHeight - innerHeight,
        );
        for (let pos = 360; pos < distance + 360; pos += 360) {
          await page.evaluate(
            (v) => window.scrollTo({ top: v, behavior: "instant" }),
            pos,
          );
          await page.waitForTimeout(90);
          if (
            await page.evaluate(
              (l) =>
                window.motionLog.some(
                  (x) =>
                    x.route === l &&
                    x.name === "workspace-scroll-reveal" &&
                    x.y > 0,
                ),
              label,
            )
          )
            break;
        }
        await page.waitForFunction(
          (l) =>
            window.motionLog.some(
              (x) =>
                x.route === l &&
                x.name === "workspace-scroll-reveal" &&
                x.y > 0,
            ),
          label,
          { timeout: 5000 },
        );
      }
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      const opener = page.getByRole("button", {
        name: "Search workspace",
        exact: true,
      });
      await opener.click();
      const search = page.getByRole("dialog", { name: "Search workspace" });
      await search.getByRole("textbox").waitFor();
      await page.keyboard.press("Escape");
      await page
        .locator('[data-motion-surface="search"]')
        .waitFor({ state: "detached" });
      assert(
        await opener.evaluate((e) => e === document.activeElement),
        label + " search focus return",
      );
      await opener.click();
      await search.getByRole("textbox").fill("Refund routing");
      await search.getByRole("button", { name: /Refund routing/ }).click();
      const drawer = page.getByRole("dialog", {
        name: "Refund routing",
        exact: true,
      });
      await drawer.waitFor();
      await drawer.getByRole("button", { name: "Close detail" }).click();
      if (moving) {
        assert(
          await page.evaluate(
            (l) =>
              window.exits.some(
                (x) => x.kind === "drawer" && x.route === l && x.inert,
              ),
            label,
          ),
          label + " exit cannot receive input",
        );
      }
      await page
        .locator('[data-motion-surface="drawer"]')
        .waitFor({ state: "detached" });
      if (moving) {
        const names = await page.evaluate(
          (l) =>
            window.motionLog.filter((x) => x.route === l).map((x) => x.name),
          label,
        );
        for (const name of [
          "workspace-drawer-in",
          "workspace-drawer-out",
          "workspace-surface-in",
          "workspace-surface-out",
        ])
          assert(names.includes(name), label + " " + name);
      }
    }
    // Reopening during exit must cancel the pending removal.
    await page.keyboard.press("Control+k");
    await page
      .getByRole("textbox", { name: "Search views and opportunities" })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(320);
    assert.equal(
      await page.getByRole("dialog", { name: "Search workspace" }).count(),
      1,
    );
    await page.keyboard.press("Escape");
    await page.goto(origin + "/#intelligence-studio");
    await page
      .getByRole("button", { name: "Live run archive", exact: true })
      .click();
    const archive = page.getByRole("dialog", { name: "Live run archive" });
    await archive.waitFor();
    await page.keyboard.press("Escape");
    await page
      .locator('dialog[data-motion-surface="dialog"]')
      .waitFor({ state: "detached" });
    await page.goto(origin + "/#data-sources");
    const source = page.locator(".source-row").first();
    await source.click();
    await page.locator(".detail-section[data-motion-surface=side]").waitFor();
    await source.click();
    await page
      .locator(".detail-section[data-motion-surface=side]")
      .waitFor({ state: "detached" });
    if (!moving)
      assert.deepEqual(await page.evaluate(() => window.motionLog), []);
    assert.deepEqual(errors, []);
    console.log(
      "Verified nine workspaces, focus, interrupted exit, native dialog and side inspector",
      width,
      mode,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
