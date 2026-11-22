/**
 * Exercise a built export with real Chromium keyboard/pointer input. All traffic is loopback.
 * FIELD_QA_PHASE=baseline captures the previous product; candidate also exercises its field.
 * Set FIELD_QA_DIST, FIELD_QA_OUTPUT, and FIELD_QA_BASELINE (baseline output directory).
 * The per-route 650ms rAF sample measures foreground presentation cadence, while CDP task time
 * includes main-thread work in that interval. Neither is a hardware-independent frame benchmark.
 */
import assert from "node:assert/strict";
import { checkRelief } from "./relief-browser-checks.mjs";
import { navigateWorkspace } from "./workspace-navigation.mjs";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.resolve(process.env.FIELD_QA_DIST || path.join(root, "dist"));
const phase = process.env.FIELD_QA_PHASE || "candidate";
const preview = process.env.FIELD_QA_PREVIEW === "1";
const out = path.resolve(
  process.env.FIELD_QA_OUTPUT || path.join("/tmp", "monolith-living-" + phase),
);
await mkdir(out, { recursive: true });
const seed = JSON.parse(await readFile(path.join(dist, "demo.json"), "utf8"));
const pages = [
  ["Overview", phase === "baseline" ? "Intelligence overview" : "Operational field"],
  ["Business map", "Business map"],
  ["Process explorer", "Process explorer"],
  ["Opportunities", "Automation opportunities"],
  ["Technical blueprint", "Technical blueprint"],
  ["Intelligence studio", "Agent Intelligence Studio"],
  ["Continuous intelligence", "Continuous intelligence"],
  ["Agent activity", "Agent activity"],
  ["Data sources", "Data sources"],
];
const slug = (s) => s.toLowerCase().replaceAll(" ", "-");
const types = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
};
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(
      dist,
      "." + (p.endsWith("/") ? p + "index.html" : p),
    );
    if (!file.startsWith(dist + path.sep)) throw Error("outside export");
    const body = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      })
      .end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
  ],
});
const report = {
  phase,
  build: createHash("sha256")
    .update(await readFile(path.join(dist, "index.html")))
    .digest("hex"),
  chromium: browser.version(),
  profiles: [],
  errors: [],
};
const round = (n) => Math.round(n * 10) / 10;
async function contactSheets() {
  for (const [device, tile] of [
    ["desktop", 550],
    ["mobile", 240],
  ]) {
    const width = tile * 3 + 40;
    const chart = await browser.newPage({
      viewport: { width, height: 800 },
      deviceScaleFactor: 1,
    });
    try {
      const shots = await Promise.all(
        pages.map(async ([label]) => {
          const img = await readFile(
            path.join(out, device + "-motion-" + slug(label) + ".png"),
          );
          return {
            label,
            img: "data:image/png;base64," + img.toString("base64"),
          };
        }),
      );
      await chart.setContent(
        "<style>*{box-sizing:border-box}html,body{margin:0;background:#101416;color:#e5e9e3;font:14px Arial, sans-serif}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:10px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{height:28px;line-height:24px}</style><main></main>",
      );
      await chart.evaluate(async (items) => {
        for (const { label, img } of items) {
          const figure = document.createElement("figure"),
            caption = document.createElement("figcaption"),
            shot = new Image();
          caption.textContent = label;
          shot.src = img;
          figure.append(caption, shot);
          document.querySelector("main").append(figure);
          await shot.decode();
        }
      }, shots);
      await chart.locator("main").screenshot({
        path: path.join(out, "contact-sheet-" + device + ".png"),
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      await chart.close();
    }
  }
}
async function settled(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function benchPage(page, cdp) {
  const get = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const before = await get();
  const sample = await page.evaluate(async () => {
    const start = performance.now(),
      motionBefore = window.fieldQA.motionPaints,
      ticks = [];
    await new Promise((resolve) => {
      function tick(t) {
        ticks.push(t);
        if (t - start >= 650) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const intervals = ticks
      .slice(1)
      .map((t, i) => t - ticks[i])
      .sort((a, b) => a - b);
    const fields = [...document.querySelectorAll("[data-topology-field]")].map(
      (field) => {
        const rect = field.getBoundingClientRect(),
          motion = field.querySelector("canvas[data-field-motion]");
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          aboveFold: rect.top < innerHeight && rect.bottom > 0,
          nodes: field.querySelectorAll("[data-field-node]").length,
          links: field.querySelectorAll("[data-field-link]").length,
          running: motion?.dataset.running || null,
          spriteState:
            field.querySelector("canvas[data-field-surface]")?.dataset
              .fieldSprites || null,
          renderer:
            field.querySelector("canvas[data-field-surface]")?.dataset
              .fieldEngine || null,
        };
      },
    );
    return {
      fields,
      motionPaints: window.fieldQA.motionPaints - motionBefore,
      frames: intervals.length,
      p50: intervals[Math.floor(intervals.length * 0.5)] ?? null,
      p95: intervals[Math.floor(intervals.length * 0.95)] ?? null,
      seconds: (performance.now() - start) / 1000,
      visibleCanvases: [...document.querySelectorAll("canvas")].filter(
        (e) => e.getBoundingClientRect().height && e.checkVisibility(),
      ).length,
      longTasks: window.fieldQA.tasks.filter((t) => t.startTime >= start)
        .length,
    };
  });
  const after = await get();
  return {
    ...sample,
    p50: sample.p50 === null ? null : round(sample.p50),
    p95: sample.p95 === null ? null : round(sample.p95),
    mainThreadMsPerSecond: round(
      ((after.TaskDuration - before.TaskDuration) * 1000) / sample.seconds,
    ),
    jsHeapMiB: round(after.JSHeapUsedSize / 1048576),
  };
}
async function nav(page, label) {
  await page.evaluate(() => { window.fieldQA.lastClick = 0; });
  await navigateWorkspace(page, label);
  await settled(page);
  return page.evaluate(() =>
    Math.round(performance.now() - window.fieldQA.lastClick),
  );
}
async function waitForRaster(page) {
  await page.waitForFunction(() => {
    const surfaces = [
      ...document.querySelectorAll("canvas[data-field-surface]"),
    ];
    return surfaces.every((canvas) => {
      const b = canvas.getBoundingClientRect();
      if (
        b.bottom <= 0 ||
        b.top >= innerHeight ||
        b.width <= 0 ||
        b.height <= 0
      )
        return true;
      const [ready, total] = (canvas.dataset.fieldSprites || "")
        .split("/")
        .map(Number);
      return total > 0 && ready === total;
    });
  });
}
async function waitForSeedMapScreenshot(page) {
  // Northstar's monitor may already be current. Observe the rendered legend
  // and rasters so a fast, completed investigation is also a valid outcome.
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const deadline = performance.now() + 30000;
        let since = 0;
        let previous;
        function sample() {
          const now = performance.now();
          const canvas = document.querySelector("canvas[data-field-surface]");
          const signature = [
            canvas?.dataset.fieldSprites,
            document.body.innerText.includes("Active investigation"),
            [...document.querySelectorAll("[data-field-node]")]
              .map((node) => node.getAttribute("style"))
              .join("|"),
          ].join("/");
          if (
            canvas?.dataset.fieldSprites !== "4/4" ||
            signature !== previous
          ) {
            since = now;
          }
          previous = signature;
          if (now - since >= 900) resolve(signature);
          else if (now >= deadline)
            reject(Error("System membrane rasters did not settle"));
          else setTimeout(sample, 80);
        }
        sample();
      }),
  );
}
async function profile(device, motion) {
  const viewport =
    device === "desktop"
      ? { width: 1440, height: 960 }
      : { width: 390, height: 844 };
  const context = await browser.newContext({
    viewport,
    reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const record = {
    device,
    motion,
    viewport,
    surfaces: [],
    interactions: [],
    actionMs: {},
  };
  report.profiles.push(record);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === base
      ? r.continue()
      : (report.errors.push("Unexpected external request"), r.abort()),
  );
  await page.addInitScript(() => {
    window.fieldQA = { tasks: [], lastClick: 0, motionPaints: 0 };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.hasAttribute("data-field-motion"))
        window.fieldQA.motionPaints++;
      return clear.apply(this, args);
    };
    document.addEventListener(
      "click",
      () => {
        window.fieldQA.lastClick = performance.now();
      },
      true,
    );
    new PerformanceObserver((list) =>
      window.fieldQA.tasks.push(
        ...list
          .getEntries()
          .map(({ startTime, duration }) => ({ startTime, duration })),
      ),
    ).observe({ type: "longtask", buffered: true });
  });
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const initialField = phase === "baseline"
      ? "[data-topology-field] canvas[data-field-surface]"
      : "[data-operational-relief] canvas[data-relief-surface]";
    await page.locator(initialField).first().waitFor();
    for (const [label, expectedTitle] of pages) {
      const navigationMs = label === "Overview" ? null : await nav(page, label);
      if (label === "Continuous intelligence")
        await page.getByRole("heading", { name: "Change monitor" }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await settled(page);
      const screen = await page.evaluate(() => ({
        title: document.querySelector("main h1")?.textContent || "",
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      }));
      if (!screen.title || screen.overflow)
        report.errors.push(
          device + " " + motion + " " + label + " heading/viewport",
        );
      if (screen.title.toLowerCase() !== expectedTitle.toLowerCase())
        report.errors.push("Unexpected workspace heading: " + screen.title);
      if (phase !== "baseline") await waitForRaster(page);
      const fieldReadyMs =
        phase === "baseline"
          ? null
          : await page.evaluate(() => {
              const field = [
                ...document.querySelectorAll("canvas[data-field-surface]"),
              ].find(
                (c) =>
                  c.dataset.fieldSprites &&
                  c.getBoundingClientRect().top < innerHeight,
              );
              return field
                ? Math.round(
                    performance.now() - (window.fieldQA.lastClick || 0),
                  )
                : null;
            });
      const timing = await benchPage(page, cdp);
      if (phase !== "baseline" && label === "Business map")
        await waitForSeedMapScreenshot(page);
      await page.screenshot({
        path: path.join(out, [device, motion, slug(label)].join("-") + ".png"),
      });
      record.surfaces.push({
        page: label,
        ...screen,
        navigationMs,
        fieldReadyMs,
        ...timing,
      });
    }
    if (!preview) {
      await interactions(page, record);
      if (phase !== "baseline") await candidateInteractions(page, cdp, record);
    }
  } finally {
    await context.close();
  }
}
async function interactions(page, record) {
  await nav(page, "Business map");
  await page
    .getByRole("button", { name: "Graph history", exact: true })
    .click();
  const range = page.getByRole("slider", { name: "Graph epoch" });
  await range.focus();
  await range.press("Home");
  assert(
    await page.getByRole("button", { name: "Previous epoch" }).isDisabled(),
  );
  record.interactions.push("Graph history keyboard epoch selection");
  await nav(page, "Overview");
  const search = page.getByRole("button", {
    name: "Search workspace",
    exact: true,
  });
  await search.click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  await dialog.getByRole("textbox").fill("refund");
  assert((await dialog.getByRole("button", { name: /refund/i }).count()) > 0);
  await page.keyboard.press("Escape");
  assert(await search.evaluate((e) => e === document.activeElement));
  record.interactions.push("Search results and focus restoration");
}
function check(record, pass, description) {
  assert.ok(pass, record.device + " / " + record.motion + ": " + description);
  record.interactions.push(description);
}
async function activeField(page, scope) {
  const field = scope.locator("[data-topology-field]").first();
  await field.scrollIntoViewIfNeeded();
  await field.locator("canvas[data-field-surface]").waitFor();
  await settled(page);
  await waitForRaster(page);
  return field;
}
async function fieldSnapshot(field) {
  return field.evaluate((root) => {
    const canvas = root.querySelector("canvas[data-field-surface]");
    const offscreen = document.createElement("canvas");
    offscreen.width = 80;
    offscreen.height = 60;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(canvas, 0, 0, 80, 60);
    const rgba = ctx.getImageData(0, 0, 80, 60).data;
    const colours = new Set();
    for (let i = 0; i < rgba.length; i += 4)
      colours.add(
        ((rgba[i] << 16) + (rgba[i + 1] << 8) + rgba[i + 2]) * 256 +
          rgba[i + 3],
      );
    return {
      colours: colours.size,
      running:
        root.querySelector("canvas[data-field-motion]")?.dataset.running ||
        null,
    };
  });
}
async function waitScale(page, field, value, operator) {
  await page.waitForFunction(
    ({ root, target, op }) => {
      const zoom = Number(root.getAttribute("data-zoom"));
      return op === "above" ? zoom > target : Math.abs(zoom - target) < 0.002;
    },
    { root: await field.elementHandle(), target: value, op: operator },
  );
}
async function sourceFlows(page, record) {
  await nav(page, "Process explorer");
  const variants = page.getByRole("combobox", { name: "Process variant" });
  await variants.selectOption({ index: 1 });
  const process = page.getByRole("group", {
    name: "Observed process sequence",
  });
  const labels = await process.getByRole("listitem").allTextContents();
  check(
    record,
    labels.length > 1,
    "Selected process variant supplies an ordered, accessible route",
  );
  const witness = page.getByRole("region", { name: "Selected interval evidence" });
  const last = process.getByRole("button").last();
  await last.click();
  check(record, (await last.getAttribute("aria-pressed")) === "true"
    && (await witness.getByRole("heading", { name: "Case events" }).isVisible())
    && Boolean(await witness.getByRole("combobox", { name: "Select case" }).inputValue()),
    "Choosing an observed transition opens the cases that explain its interval");
  if (record.device === "mobile") {
    const height = await process
      .getByRole("button")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    check(
      record,
      height >= 44,
      "Each process step is an individually tappable mobile target",
    );
  }
  await nav(page, "Technical blueprint");
  const designs = page.getByRole("combobox", { name: "Blueprint opportunity" });
  await designs.selectOption({ index: 1 });
  const architecture = page.getByRole("group", {
    name: "Proposed architecture flow",
  });
  check(
    record,
    (await architecture.getByRole("listitem").count()) > 1,
    "Selected blueprint renders an accessible proposed sequence",
  );
  await nav(page, "Opportunities");
  const entry = page.getByRole("button", { name: /^Inspect / }).first();
  await entry.click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Scenario", exact: true }).click();
  await drawer
    .getByRole("region", { name: "Refund routing scenario model" })
    .waitFor();
  await page.keyboard.press("Escape");
  check(
    record,
    await entry.evaluate((el) => document.activeElement === el),
    "Scenario drill-down returns focus to its opportunity",
  );
  await nav(page, "Agent activity");
  const log = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Specialist execution",
        exact: true,
      }),
    })
    .locator("details")
    .first();
  await log.locator("summary").click();
  check(
    record,
    (await log.getAttribute("open")) !== null &&
      (await log.innerText()).includes(seed.report.events.toLocaleString("en-GB") + " events resolved to " + seed.report.cases.toLocaleString("en-GB") + " linked cases."),
    "Agent activity discloses the recorded discovery tool and its source population",
  );
  await nav(page, "Data sources");
  const find = page.getByRole("searchbox", { name: "Find a source" });
  await find.fill("northstar-finance.csv");
  const rows = page.locator(".source-row");
  check(record, (await rows.count()) === 1 && (await rows.innerText()).includes("northstar-finance.csv"),
    "The source register can find a specific observed file");
  const source = rows.first();
  await source.click();
  const details = page.locator(".detail-section").filter({ has: page.getByRole("button", { name: "Next", exact: true }) });
  const firstPage = await details.locator("details.evidence summary").allTextContents();
  await details.getByRole("button", { name: "Next", exact: true }).click();
  const nextPage = await details.locator("details.evidence summary").allTextContents();
  check(record, nextPage.length > 0 && firstPage.length > 0 && JSON.stringify(nextPage) !== JSON.stringify(firstPage),
    "Paging the source register reveals another group of records");
  check(
    record,
    (await source.getAttribute("aria-expanded")) === "true",
    "Source registry opens the selected source provenance",
  );
}
async function candidateInteractions(page, cdp, record) {
  if (record.device === "desktop") {
    const masthead = page.locator("#workspace-masthead");
    const normalHeight = (await masthead.boundingBox()).height;
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("button", { name: "Expand workspace", exact: true }).click();
    await settled(page);
    check(record, (await masthead.boundingBox()).height < normalHeight,
      "Expanding the workspace gives the operational field more vertical space");
    await page.getByRole("button", { name: "Restore navigation", exact: true }).click();
    check(record, (await masthead.boundingBox()).height >= normalHeight - 1,
      "Restoring navigation restores the full workspace masthead");
  }
  record.relief = await checkRelief(page, seed, record.motion === "reduced");
  record.interactions.push("Four system callouts open source cases and restore keyboard focus",
    "Flow and volume produce distinct geometry",
    "History scrubs and plays actual observation windows",
    record.motion === "reduced" ? "Requested geometry snaps directly under reduced motion"
      : "Requested geometry morphs through measured intermediate frames");
  await nav(page, "Business map");
  const twin = page.getByRole("region", { name: "Business digital twin" });
  const field = await activeField(page, twin);
  const count = await field.locator("[data-field-node]").count();
  check(
    record,
    count === 4,
    "The operational twin retains the four canonical Northstar systems",
  );
  const still = await fieldSnapshot(field);
  check(record, still.colours > 20, "Canvas contains rendered field geometry");
  const motion = field.locator("canvas[data-field-motion]");
  await page.waitForFunction(
    ({ field, reduced }) =>
      document.querySelector(field)?.dataset.running ===
      (reduced ? "false" : "true"),
    {
      field: "[data-topology-field] canvas[data-field-motion]",
      reduced: record.motion === "reduced",
    },
  );
  const first = await motion.evaluate((e) => e.toDataURL());
  await page.waitForTimeout(150);
  const next = await motion.evaluate((e) => e.toDataURL());
  check(
    record,
    record.motion === "reduced" ? first === next : first !== next,
    record.motion === "reduced"
      ? "Reduced-motion field stays static while visible"
      : "Visible active traffic changes its canvas",
  );
  record.visibleField = await benchPage(page, cdp);
  check(
    record,
    record.motion === "reduced"
      ? record.visibleField.motionPaints === 0
      : record.visibleField.motionPaints > 0,
    record.motion === "reduced"
      ? "Visible reduced-motion field schedules no traffic paints"
      : "Visible traffic paints are observable",
  );
  const scrollAway = async () => {
    await page.evaluate(() =>
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      }),
    );
    await settled(page);
  };
  await scrollAway();
  const outside = () =>
    field.evaluate((el) => el.getBoundingClientRect().bottom <= 0);
  const resize = !(await outside());
  if (resize) {
    await page.setViewportSize({ ...record.viewport, height: 360 });
    await scrollAway();
  }
  check(
    record,
    await outside(),
    "Real viewport scroll moves the operational twin offscreen",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("[data-topology-field] canvas[data-field-motion]")
        ?.dataset.running === "false",
  );
  const frozen = await motion.evaluate((e) => e.toDataURL());
  record.offscreenField = await benchPage(page, cdp);
  check(
    record,
    record.offscreenField.motionPaints === 0 &&
      frozen === (await motion.evaluate((e) => e.toDataURL())),
    "Offscreen motion canvas stops redrawing",
  );
  if (resize) await page.setViewportSize(record.viewport);
  await field.scrollIntoViewIfNeeded();
  const fieldKey = field.getByRole("button", {
    name: "Field key",
    exact: true,
  });
  await fieldKey.click();
  const encoding = twin.getByRole("region", { name: "Field key", exact: true });
  await encoding.waitFor();
  check(
    record,
    (await encoding.innerText()).trim().length > 10 &&
      (await fieldKey.getAttribute("aria-expanded")) === "true",
    "Field key explains the encodings and announces its state",
  );
  await fieldKey.click();
  await encoding.waitFor({ state: "hidden" });
  const original = Number(await field.getAttribute("data-zoom"));
  const focusSystem = field.locator("[data-field-node]").nth(1);
  await focusSystem.focus();
  await page.keyboard.press("Enter");
  await settled(page);
  record.actionMs.selectSystem = await page.evaluate(() =>
    Math.round(performance.now() - window.fieldQA.lastClick),
  );
  check(
    record,
    (await focusSystem.getAttribute("aria-pressed")) === "true",
    "Keyboard node activation updates the selected system",
  );
  await field.getByRole("button", { name: "Zoom in", exact: true }).click();
  await waitScale(page, field, original, "above");
  check(
    record,
    Number(await field.getAttribute("data-zoom")) > original,
    "Zoom control changes field scale",
  );
  await field
    .getByRole("button", { name: "Recenter field", exact: true })
    .click();
  await waitScale(page, field, original, "near");
  check(
    record,
    Math.abs(Number(await field.getAttribute("data-zoom")) - original) < 0.002,
    "Recenter restores field scale",
  );
  await field
    .getByRole("button", { name: "Focus selection", exact: true })
    .click();
  await waitScale(page, field, original + 0.15, "above");
  record.interactions.push("Focus selection zooms to the chosen system");
  await field
    .getByRole("button", { name: "Recenter field", exact: true })
    .click();
  await waitScale(page, field, original, "near");
  const active = field.locator("[data-field-node]").first();
  const prior = await active.boundingBox();
  await field.focus();
  await page.keyboard.press("ArrowRight");
  await settled(page);
  const after = await active.boundingBox();
  check(
    record,
    Math.abs(after.x - prior.x) > 1,
    "Keyboard panning changes the field view",
  );
  await page.keyboard.press("Home");
  await page.waitForTimeout(240);
  const surface = await field
    .locator("canvas[data-field-surface]")
    .boundingBox();
  const start = await active.boundingBox();
  const x = surface.x + surface.width * 0.08,
    y = surface.y + surface.height * 0.1;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y + 16, { steps: 5 });
  await page.mouse.up();
  await settled(page);
  const moved = await active.boundingBox();
  check(record, Math.abs(moved.x - start.x) > 4, "Pointer drag pans the view");
  await field
    .getByRole("button", { name: "Recenter field", exact: true })
    .click();
  const edge = field.locator("[data-field-link]").first();
  await edge.focus();
  await page.keyboard.press("Enter");
  check(
    record,
    (await edge.getAttribute("aria-pressed")) === "true",
    "Relationship selection updates the systems inspector",
  );
  if (record.motion === "motion")
    await field.screenshot({
      path: path.join(out, record.device + "-field-selection.png"),
    });
  await nav(page, "Continuous intelligence");
  const observed = page.getByRole("region", { name: "Observed system field" });
  await activeField(page, observed);
  let linked = false;
  const visibleNodes = await observed.locator("[data-field-node]").evaluateAll(
    (nodes) =>
      nodes.filter((node) => {
        const rect = node.getBoundingClientRect(),
          parent = node
            .closest("[data-topology-field]")
            .parentElement.getBoundingClientRect();
        return rect.top >= parent.top - 2 && rect.bottom <= parent.bottom + 2;
      }).length,
  );
  check(
    record,
    visibleNodes === (await observed.locator("[data-field-node]").count()),
    "All compact field labels fit within the visible diagram",
  );
  const inspect = observed.getByRole("combobox", {
    name: "Inspect field system",
  });
  for (let i = 0; i < (await inspect.locator("option").count()); i++) {
    await inspect.selectOption({ index: i });
    const target = observed.getByRole("button", {
      name: "Inspect related signal",
    });
    if (await target.isVisible()) {
      await target.click();
      linked = true;
      break;
    }
  }
  check(
    record,
    linked,
    "Selected system opens an evidence-linked Continuous signal",
  );
  await nav(page, "Intelligence studio");
  await page
    .getByRole("button", {
      name: "Run deterministic investigation",
      exact: true,
    })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Investigation outcome", exact: true })
    .waitFor({ timeout: 90000 });
  const sequence = page.getByRole("region", { name: "Specialist stage sequence" });
  check(record, (await sequence.getByRole("listitem").count()) === 6,
    "The completed investigation exposes six inspectable stages in order");
  await page.getByRole("button", { name: "Handoff map", exact: true }).click();
  const nuclei = page
    .locator(".react-flow")
    .filter({ has: page.locator(".react-flow__node") })
    .first();
  await nuclei.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    (frame) => {
      const rect = frame.getBoundingClientRect(),
        nodes = [...frame.querySelectorAll(".react-flow__node")];
      return (
        nodes.length === 6 &&
        nodes.every((n) => {
          const b = n.getBoundingClientRect();
          return (
            b.width > 4 &&
            b.height > 4 &&
            b.x + b.width / 2 >= rect.x &&
            b.x + b.width / 2 <= rect.right &&
            b.y + b.height / 2 >= rect.y &&
            b.y + b.height / 2 <= rect.bottom
          );
        }) &&
        frame.querySelectorAll(".react-flow__edge").length >= 5
      );
    },
    await nuclei.elementHandle(),
  );
  record.interactions.push(
    "All six recorded stage nuclei and five dependencies are inside the graph viewport",
  );
  if (record.motion === "motion")
    await nuclei.screenshot({
      path: path.join(out, record.device + "-recorded-stage-graph.png"),
    });
  const replay = page.getByRole("slider", { name: "Investigation event" });
  await replay.focus();
  await replay.press("Home");
  const initial = Number(await replay.inputValue());
  await replay.press("ArrowRight");
  check(
    record,
    Number(await replay.inputValue()) > initial,
    "Recorded investigation replay advances to the next receipt",
  );
  await page.getByRole("button", { name: "Observatory", exact: true }).click();
  const observatory = page.getByRole("region", {
    name: "AI Engineering Observatory",
    exact: true,
  });
  await observatory
    .getByRole("button", { name: "Inspect execution trace", exact: true })
    .click();
  const trace = page.getByRole("region", { name: "Recorded execution trace" });
  const cursor = trace.getByRole("slider", { name: "Inspect trace event" });
  await cursor.focus();
  await cursor.press("Home");
  await trace.getByRole("button", { name: "Next trace event" }).click();
  check(
    record,
    Number(await cursor.inputValue()) === 1,
    "Observatory inspects the next saved trace event",
  );
  await sourceFlows(page, record);
}
async function fallbackCheck() {
  const context = await browser.newContext({
    viewport: { width: 780, height: 700 },
  });
  try {
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...params) {
        return type === "2d" ? null : getContext.call(this, type, ...params);
      };
    });
    const page = await context.newPage();
    await page.goto(base + "/#overview", { waitUntil: "domcontentloaded" });
    const relief = page.locator("[data-operational-relief]");
    await relief.locator("svg").first().waitFor({state:"visible"});
    const finance = relief.locator('[data-relief-system="Finance"]');
    await finance.press("Enter");
    const evidence = page.getByRole("dialog", { name: "Finance evidence" });
    await evidence.waitFor();
    const evidenceText = await evidence.innerText();
    assert.ok(seed.data.events.some(row => row.system === "Finance" && evidenceText.includes(row.case)),
      "Accessible relief fallback opens a finance source witness");
    await page.keyboard.press("Escape");
    await evidence.waitFor({ state: "hidden" });
    await navigateWorkspace(page, "Business map");
    const field = page.locator("[data-topology-field]").first();
    await field.locator("svg path").first().waitFor({ state: "attached" });
    const node = field.getByRole("button", { name: "CRM", exact: true });
    await node.press("Enter");
    assert.equal(await node.getAttribute("aria-pressed"), "true");
    await page.getByRole("complementary", { name: "Entity inspector" }).getByRole("heading", { name: "CRM", exact: true }).waitFor();
    report.fallback = "No Canvas 2D context: SVG geometry and keyboard system inspection verified";
  } finally {
    await context.close();
  }
}
try {
  for (const motion of preview ? ["motion"] : ["motion", "reduced"]) {
    if (process.env.FIELD_QA_MOTION && motion !== process.env.FIELD_QA_MOTION)
      continue;
    for (const device of ["desktop", "mobile"]) {
      if (process.env.FIELD_QA_DEVICE && device !== process.env.FIELD_QA_DEVICE)
        continue;
      try {
        await profile(device, motion);
        console.log(phase, device, motion, "complete");
      } catch (e) {
        report.errors.push(device + " " + motion + ": " + e.message);
        console.error(report.errors.at(-1));
      }
      await writeFile(
        path.join(out, "measurements.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    }
    await contactSheets();
  }
  if (phase !== "baseline" && !preview) {
    try {
      await fallbackCheck();
    } catch (error) {
      report.errors.push("Canvas fallback: " + error.message);
    }
    await writeFile(
      path.join(out, "measurements.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  if (process.env.FIELD_QA_BASELINE) {
    const old = JSON.parse(
      await readFile(
        path.join(process.env.FIELD_QA_BASELINE, "measurements.json"),
        "utf8",
      ),
    );
    const comparisons = [];
    for (const current of report.profiles) {
      const prev = old.profiles.find(
        (p) => p.device === current.device && p.motion === current.motion,
      );
      if (!prev) continue;
      for (const run of current.surfaces) {
        const original = prev.surfaces.find((p) => p.page === run.page);
        if (!original) continue;
        comparisons.push({
          device: current.device,
          motion: current.motion,
          page: run.page,
          navMs: [original.navigationMs, run.navigationMs],
          frameP95Ms: [original.p95, run.p95],
          mainThreadMsPerSecond: [
            original.mainThreadMsPerSecond,
            run.mainThreadMsPerSecond,
          ],
          longTasks: [original.longTasks, run.longTasks],
        });
      }
    }
    await writeFile(
      path.join(out, "comparison.json"),
      JSON.stringify(comparisons, null, 2) + "\n",
    );
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
