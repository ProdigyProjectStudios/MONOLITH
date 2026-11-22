/** Exercise the production demo using Chromium, keyboard controls and axe-core. No external traffic. */
import assert from "node:assert/strict";
import { navigateWorkspace } from "./workspace-navigation.mjs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import axe from "axe-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.resolve(process.env.MONOLITH_QA_DIST || path.join(root, "dist"));
const output =
  process.env.MONOLITH_QA_OUTPUT ||
  path.join(tmpdir(), "monolith-workspace-accessibility");
await mkdir(output, { recursive: true });
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
};
const server = createServer(async (req, res) => {
  try {
    const filename = path.resolve(
      dist,
      "." +
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ).replace(/\/$/, "/index.html"),
    );
    if (!filename.startsWith(dist + path.sep)) throw Error("Outside export");
    const body = await readFile(filename);
    res
      .writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] || "application/octet-stream",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
  ],
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
const sizes = [
  ["desktop", 1440, 960],
  ["tablet", 820, 1180],
  ["mobile", 390, 844],
];
const auditOnly = process.env.AUDIT_ONLY === "1";
const issues = [],
  audits = [],
  checks = [];
async function run([name, width, height]) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    errors.push(
      "Unexpected external request: " + new URL(route.request().url()).origin,
    );
    return route.abort();
  });
  const test = (value, detail) => {
    checks.push({ viewport: name, detail, pass: !!value });
    if (!value) issues.push({ viewport: name, detail });
  };
  const audit = async (label) => {
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
      const violations = result.violations.map((rule) => ({
        id: rule.id,
        impact: rule.impact,
        nodes: rule.nodes.map((node) => ({
          target: node.target,
          reason: node.failureSummary,
        })),
      }));
      return {
        violations,
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    audits.push({ viewport: name, page: label, ...result });
    test(
      result.scrollWidth <= result.width + 1,
      label + " stays inside the viewport",
    );
    if (result.violations.length)
      console.log(
        name +
          " / " +
          label +
          ": " +
          result.violations
            .map((v) => v.id + " (" + v.nodes.length + ")")
            .join(", "),
      );
  };
  const nav = async (label) => {
    await navigateWorkspace(page, label);
    await page.locator("main h1").first().waitFor();
  };
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "Operational metrics" }).waitFor();
    await page.addScriptTag({ content: axe.source });
    if (!auditOnly) {
      await page.keyboard.press("Tab");
      test(
        await page
          .getByRole("link", { name: "Skip to workspace" })
          .evaluate((el) => el === document.activeElement),
        "First Tab exposes the skip link",
      );
      await page.keyboard.press("Enter");
      test(
        await page
          .getByRole("heading", { level: 1 })
          .first()
          .evaluate((el) => el === document.activeElement),
        "Skip link moves focus to the workspace heading",
      );
      if (name === "mobile") {
        const toggle = page.getByRole("button", {
          name: "Open navigation",
          exact: true,
        });
        test(
          (await page
            .getByRole("dialog", { name: "Workspace navigation" })
            .count()) === 0,
          "Closed mobile navigation is absent from the accessibility tree",
        );
        await toggle.focus();
        await page.keyboard.press("Enter");
        const menu = page.getByRole("dialog", { name: "Workspace navigation" });
        test(
          await menu
            .locator('[aria-current="page"]')
            .evaluate((el) => el === document.activeElement),
          "Opening the mobile menu focuses the current page",
        );
        await menu.getByRole("button", { name: "Close navigation" }).focus();
        await page.keyboard.press("Shift+Tab");
        test(
          await menu.evaluate((el) => el.contains(document.activeElement)),
          "Mobile navigation contains reverse keyboard traversal",
        );
        await audit("Mobile navigation");
        await page.screenshot({
          path: path.join(output, "monolith-keyboard-navigation-mobile.png"),
        });
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        test(
          await toggle.evaluate((el) => el === document.activeElement),
          "Escape restores focus to the menu opener",
        );
      }
    }
    for (const label of routes) {
      if (label !== "Overview") await nav(label);
      if (label === "Continuous intelligence")
        await page.getByRole("heading", { name: "Change monitor" }).waitFor();
      await audit(label);
      if (label === "Data sources")
        await page.screenshot({
          path: path.join(output, "monolith-accessibility-" + name + ".png"),
          animations: "disabled",
        });
      if (!auditOnly) await exercise(page, label, test, audit, name);
    }
    if (!auditOnly && name === "desktop") {
      const renamed = await readFile(
        path.join(dist, "synthetic-change-stream.csv"),
      );
      await page.locator("input[type=file]").setInputFiles({
        name: "renamed-training-week.csv",
        mimeType: "text/csv",
        buffer: renamed,
      });
      await page
        .locator(".source-row")
        .filter({ hasText: "renamed-training-week.csv" })
        .waitFor();
      await nav("Continuous intelligence");
      await page
        .getByRole("button", { name: "Load synthetic recovery stream" })
        .waitFor();
      test(
        true,
        "A valid renamed training stream imports after malformed input and unlocks the recovery week",
      );
      await emptyAndRecovery(page, test);
    }
    test(
      !errors.length,
      "No browser exceptions or external calls: " + errors.join(", "),
    );
  } finally {
    await context.close();
  }
}
async function exercise(page, label, test, audit, name) {
  if (label === "Overview") {
    test(
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.className = "spin";
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const finite =
          style.animationIterationCount === "1" &&
          parseFloat(style.animationDuration) < 0.001;
        probe.remove();
        return (
          window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
          finite
        );
      }),
      "Reduced-motion preferences suppress repeating CSS animation",
    );
    const opener = page.getByRole("button", {
      name: "Search workspace",
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search workspace" });
    const input = dialog.getByRole("textbox");
    test(
      await input.evaluate((el) => el === document.activeElement),
      "Opening search moves focus into the dialog",
    );
    await page.keyboard.press("Shift+Tab");
    test(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      "Reverse Tab remains in workspace search",
    );
    await input.fill("x-empty-result");
    await dialog.getByText("No matching views or opportunities.").waitFor();
    test(
      await input.evaluate((el) => el === document.activeElement),
      "Workspace search focuses its input and reports an empty result",
    );
    await input.fill("Process");
    await dialog.getByRole("button", { name: /Process explorer/ }).waitFor();
    await audit("Workspace search");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    test(
      await opener.evaluate((el) => el === document.activeElement),
      "Escape returns to the search opener",
    );
  } else if (label === "Business map") {
    await page
      .getByRole("button", { name: "Graph history", exact: true })
      .click();
    await page.getByRole("slider", { name: "Graph epoch" }).waitFor();
    await page.getByRole("slider", { name: "Graph epoch" }).focus();
    await page.keyboard.press("Home");
    if (name === "tablet")
      await page.screenshot({
        path: path.join(output, "monolith-keyboard-graph-tablet.png"),
      });
    test(
      await page.getByRole("button", { name: "Previous epoch" }).isDisabled(),
      "Timeline keyboard traversal reaches the earliest epoch",
    );
  } else if (label === "Process explorer") {
    const options = page.getByRole("combobox", { name: "Process variant" });
    await options.selectOption({ index: 1 });
    test(
      (await page
        .getByRole("group", { name: "Observed process sequence" })
        .getByRole("listitem")
        .count()) > 0,
      "The selected process has an ordered text equivalent for the graph",
    );
    test(
      (await page.getByRole("combobox", { name: "Select case" }).count()) === 1,
      "Choosing a process variant exposes its case inspector",
    );
  } else if (label === "Opportunities") {
    const opener = page.getByRole("button", { name: /^Inspect / }).first();
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await audit("Opportunity detail");
    await page.keyboard.press("Escape");
    test(
      await opener.evaluate((el) => el === document.activeElement),
      "Closing opportunity details returns focus to the initiating row",
    );
  } else if (label === "Technical blueprint") {
    const opportunity = page.getByRole("combobox", {
      name: "Blueprint opportunity",
    });
    await opportunity.selectOption({ index: 1 });
    test(
      (await page
        .getByRole("group", { name: "Proposed architecture flow" })
        .getByRole("listitem")
        .count()) > 0,
      "The blueprint graph exposes ordered steps to assistive technology",
    );
    test(
      (await opportunity.inputValue()) !== "",
      "Blueprint opportunity selection changes",
    );
  } else if (label === "Intelligence studio") {
    await page
      .getByRole("button", { name: "Observatory", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "No investigation selected" })
      .waitFor();
    await audit("Observatory empty history");
    const open = page.getByRole("button", {
      name: "Live run archive",
      exact: true,
    });
    await open.click();
    const archive = page.getByRole("dialog", { name: "Live run archive" });
    await archive
      .getByRole("heading", { name: "No verified recording is available" })
      .waitFor();
    await audit("Live capture unavailable");
    await page.keyboard.press("Control+k");
    test(
      (await page.getByRole("dialog").count()) === 1,
      "Global search cannot open beneath a native modal",
    );
    await page.keyboard.press("Escape");
    await archive.waitFor({ state: "hidden" });
  } else if (label === "Agent activity") {
    const trace = page.locator("section").filter({ has: page.getByRole("heading", { name: "Specialist execution" }) }).locator("details").first();
    await trace.locator("summary").focus();
    await page.keyboard.press("Enter");
    test(
      (await trace.getAttribute("open")) !== null,
      "Keyboard expansion exposes the recorded specialist tool",
    );
  } else if (label === "Continuous intelligence") {
    await page.getByRole("button", { name: "Periods", exact: true }).click();
    await page.getByRole("heading", { name: "Period comparison" }).waitFor();
    test(
      await page
        .getByRole("combobox", { name: "Observation revision" })
        .isEnabled(),
      "Saved observation revision can be inspected",
    );
  } else if (label === "Data sources") {
    const file = page.locator("input[type=file]");
    await file.setInputFiles({
      name: "malformed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("activity\nIncomplete"),
    });
    const error = page
      .getByRole("alert")
      .filter({ hasText: /CSV|column|header|case_id/i })
      .first();
    await error.waitFor();
    const dismiss = error.getByRole("button").last();
    await dismiss.click();
    const registry = page.locator(".source-row").first();
    await registry.click();
    test(
      (await registry.getAttribute("aria-expanded")) === "true",
      "Source selection announces its expanded state",
    );
    test(
      await page.locator(".detail-section code").first().isVisible(),
      "Source registry remains usable after invalid upload and dismissal",
    );
  }
}
async function emptyAndRecovery(page, test) {
  // Fresh origin storage, with an empty canonical Python report served for this test only.
  const report = execFileSync(
    path.join(root, "apps/api/.venv/bin/python"),
    [
      "-c",
      'import json; from monolith.core import analyse; data={"events":[],"docs":[],"sources":[]}; print(json.dumps({"data":data,"report":analyse(data)}))',
    ],
    { cwd: path.join(root, "apps/api"), encoding: "utf8" },
  );
  const fresh = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 1280, height: 880 },
      reducedMotion: "reduce",
    });
  try {
    const blank = await fresh.newPage();
    let allow = false;
    await fresh.route("**/*", (r) => {
      const url = new URL(r.request().url());
      if (url.origin !== origin) return r.abort();
      if (url.pathname === "/demo.json")
        return r.fulfill({
          contentType: "application/json",
          status: allow ? 200 : 503,
          body: allow ? report : "{}",
        });
      return r.continue();
    });
    await blank.goto(origin);
    const error = blank
      .getByRole("alert")
      .filter({ hasText: "Unable to load" });
    await error.waitFor();
    test(
      (await error.innerText()).includes("Unable to load"),
      "A failed initial load reports an actionable error",
    );
    allow = true;
    await error.getByRole("button", { name: /retry/i }).click();
    await blank.getByRole("region", { name: "Operational metrics" }).waitFor();
    await blank
      .getByText(
        "No evidence-supported opportunities in this reporting window.",
      )
      .waitFor();
    for (const [view, expected] of [
      [
        "Technical blueprint",
        "A supported opportunity is needed to generate a blueprint.",
      ],
      ["Data sources", "Import an event log or document to begin."],
      [
        "Continuous intelligence",
        "A timestamped event stream is required to compare operations.",
      ],
    ]) {
      await navigateWorkspace(blank, view);
      await blank.getByText(expected, { exact: true }).waitFor();
    }
    await blank.getByRole("button", { name: "Periods", exact: true }).click();
    await blank
      .getByText(
        "Comparison windows appear after timestamped events are available.",
      )
      .waitFor();
    test(
      true,
      "Empty workspaces recover after retry and render honest blueprint, source and monitoring states",
    );
  } finally {
    await fresh.close();
  }
}
try {
  const profiles = sizes.filter(
    ([label]) => !process.env.QA_VIEWPORT || label === process.env.QA_VIEWPORT,
  );
  const results = await Promise.allSettled(profiles.map(run));
  results.forEach((result, i) => {
    if (result.status === "rejected")
      issues.push({ viewport: profiles[i][0], detail: String(result.reason) });
  });
  const violations = audits.flatMap((a) =>
    a.violations.map((v) => a.viewport + " / " + a.page + ": " + v.id),
  );
  const report = {
    axe: axe.version,
    mode: "Static synthetic demo, reduced motion",
    audits,
    checks,
    issues,
  };
  await writeFile(
    path.join(output, "monolith-workspace-accessibility.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    audits.length +
      " states scanned, " +
      violations.length +
      " rule groups, " +
      issues.length +
      " failed interactions/layouts.",
  );
  if (!auditOnly) {
    assert.deepEqual(issues, []);
    assert.deepEqual(violations, []);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
