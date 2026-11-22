import assert from "node:assert/strict";

async function checkRaster(page, systemCount) {
  const expected = systemCount + "/" + systemCount;
  await page.waitForFunction(count =>
    document.querySelector("canvas[data-field-surface]")?.dataset.fieldSprites === count, expected,
    {timeout:30000});
  return page.locator("canvas[data-field-surface]").first().evaluate(canvas => {
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 64;
    const context = sample.getContext("2d");
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const rgba = context.getImageData(0, 0, sample.width, sample.height).data;
    let litPixels = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (Math.max(rgba[i], rgba[i+1], rgba[i+2]) > 60) litPixels++;
    }
    return {renderer:canvas.dataset.fieldEngine, completedSprites:canvas.dataset.fieldSprites, litPixels};
  });
}

export async function checkField(browser, options, origin, report) {
  const context = await browser.newContext({ ...options, reducedMotion: "no-preference" });
  try {
    // Count actual paints without changing how any frame is scheduled or drawn.
    await context.addInitScript(() => {
      const frames = new WeakMap();
      window.fieldPaints = canvas => frames.get(canvas) || 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.hasAttribute("data-field-motion")) {
          frames.set(this.canvas, window.fieldPaints(this.canvas) + 1);
        }
        return clear.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(12000);
    async function openTopology(target) {
      await target.goto(origin + "/#business-map", {waitUntil:"domcontentloaded"});
      await target.getByRole("group", {name:"Map view"}).getByRole("button", {name:"System topology", exact:true}).click();
    }
    await openTopology(page);
    const field = page.locator("[data-topology-field]").first();
    const motion = field.locator("canvas[data-field-motion]");
    const root = await field.elementHandle();
    const canvas = await motion.elementHandle();
    const waitActive = () => page.waitForFunction(element =>
      element.dataset.running === "true" && window.fieldPaints(element) >= 3, canvas);
    await field.scrollIntoViewIfNeeded();
    await waitActive();
    const nativeRaster = await checkRaster(page, report.systems.length);
    assert.ok(["worker","cooperative"].includes(nativeRaster.renderer));
    assert.ok(nativeRaster.litPixels > 30, "native field failed to paint visible detail");
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await field.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const labels = [...element.querySelectorAll("[data-field-node]")].map(node => {
        const box = node.getBoundingClientRect();
        return {
          name: node.getAttribute("aria-label"), detail: node.getAttribute("aria-description"),
          x: box.x - rect.x, y: box.y - rect.y, w: box.width, h: box.height,
        };
      });
      return {
        viewport: {width: innerWidth, height: innerHeight},
        root: {width: rect.width, height: rect.height},
        documentWidth: document.documentElement.scrollWidth,
        labels,
        routes: [...element.querySelectorAll("[data-field-link]")].map(link => link.getAttribute("aria-label")),
      };
    });
    assert.equal(dimensions.labels.length, report.systems.length);
    assert.equal(dimensions.routes.length, report.links.length);
    assert.ok(dimensions.documentWidth <= dimensions.viewport.width + 1, "horizontal page overflow");
    for (const {name,count} of report.systems) {
      const box = dimensions.labels.find(item => item.name === name);
      assert.equal(box?.detail, count.toLocaleString("en-US") + " events", name + " source count");
      assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.w <= dimensions.root.width + 1
        && box.y + box.h <= dimensions.root.height + 1, name + " label exceeds field bounds");
      for (const other of dimensions.labels.filter(item => item !== box)) {
        assert.ok(box.x + box.w <= other.x + 1 || box.x >= other.x + other.w - 1
          || box.y + box.h <= other.y + 1 || box.y >= other.y + other.h - 1,
          name + " overlaps " + other.name);
      }
    }
    for (const {source,target,count} of report.links) {
      assert.ok(dimensions.routes.includes(source + " → " + target + " · "
        + count.toLocaleString("en-US") + " handoffs"), "missing sourced handoff " + source + " → " + target);
    }
    const paintCount = () => canvas.evaluate(element => window.fieldPaints(element));
    async function quiet() {
      await page.waitForTimeout(150);
      const before = await paintCount();
      await page.waitForTimeout(350);
      assert.equal(await paintCount(), before, "parked field continued drawing");
      return before;
    }
    async function waitResume(previous) {
      await page.waitForFunction(({element, count}) => element.dataset.running === "true"
        && window.fieldPaints(element) > count + 2, {element:canvas, count:previous});
    }
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.waitForFunction(element => element.dataset.running === "false", canvas);
    const reduced = await quiet();
    await page.emulateMedia({reducedMotion:"no-preference"});
    await waitResume(reduced);

    const initialViewport = page.viewportSize();
    const scrollEnd = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await scrollEnd();
    if (await root.evaluate(element => element.getBoundingClientRect().bottom > 0)) {
      // In the wide two-column explorer, the inspector may finish alongside the
      // field. Stack it below the plot to get a real offscreen scroll target.
      await page.setViewportSize({width:Math.min(initialViewport.width, 680), height:360});
      await scrollEnd();
    }
    await page.waitForFunction(element => element.getBoundingClientRect().bottom <= 0, root);
    await page.waitForFunction(element => element.dataset.running === "false", canvas);
    const parked = await quiet();
    const offscreenBottom = await root.evaluate(element => element.getBoundingClientRect().bottom);
    await page.setViewportSize(initialViewport);
    await field.scrollIntoViewIfNeeded();
    await waitResume(parked);
    const resumed = await paintCount();

    await field.getByRole("button", {name:"Zoom in", exact:true}).click();
    await page.waitForFunction(element => Number(element.dataset.zoom) >= 1.26, root);
    await field.getByRole("button", {name:"Recenter field", exact:true}).click();
    await page.waitForFunction(element => Number(element.dataset.zoom) === 1, root);
    const node = field.locator("[data-field-node]").first();
    const initialX = await node.evaluate(element => parseFloat(element.style.left));
    await field.press("ArrowRight");
    await page.waitForFunction(({element, x}) => Math.abs(parseFloat(element.style.left) - x) > 24,
      {element:await node.elementHandle(), x:initialX});
    await field.press("Home");
    await page.waitForFunction(({element, x}) => Math.abs(parseFloat(element.style.left) - x) < 1,
      {element:await node.elementHandle(), x:initialX});

    const system = "Finance";
    const finance = field.getByRole("button", {name:system,exact:true});
    if (options.hasTouch) await finance.tap();
    else await finance.click();
    await page.getByRole("complementary", {name:"System inspector"}).getByRole("heading", {name:system,exact:true}).waitFor();
    assert.ok(new URL(page.url()).hash === "#business-map");
    await page.getByRole("group", {name:"Map view"}).getByRole("button", {name:"Operational twin", exact:true}).click();
    assert.equal(await root.evaluate(element => element.isConnected), false);
    const detached = await quiet();

    await openTopology(page);
    const handoff = report.links[0];
    const edge = field.getByRole("button", {
      name:handoff.source + " → " + handoff.target + " · " + handoff.count.toLocaleString("en-US") + " handoffs",
      exact:true,
    });
    await edge.focus();
    await edge.press("Enter");
    await page.getByRole("heading", {name:handoff.source + " → " + handoff.target,exact:true}).waitFor();
    assert.equal(new URL(page.url()).hash, "#business-map");
    // A fresh page with no OffscreenCanvas exercises the shipped fallback.
    // All geometry and rasterization still run in the actual browser engine.
    const fallbackPage = await context.newPage();
    fallbackPage.on("pageerror", error => errors.push(error.message));
    await fallbackPage.addInitScript(() => {
      Object.defineProperty(window, "OffscreenCanvas", {value:undefined, configurable:true});
    });
    await openTopology(fallbackPage);
    await fallbackPage.locator("[data-topology-field]").first().scrollIntoViewIfNeeded();
    const fallbackRaster = await checkRaster(fallbackPage, report.systems.length);
    assert.equal(fallbackRaster.renderer, "cooperative");
    assert.ok(fallbackRaster.litPixels > 30, "cooperative field failed to paint visible detail");
    assert.deepEqual(errors, []);
    return {
      raster:{native:nativeRaster, withoutOffscreenCanvas:fallbackRaster},
      ...dimensions,
      lifecycle: {drawingWhileVisible:true, reducedMotionPaused:true, reducedMotionResumed:true,
        offscreenPaused:true, offscreenResumed:true, removedFieldStopped:true, parkedSampleMilliseconds:350,
        offscreenBottom, paintCounts:{reduced,parked,resumed,detached}},
      interactions: {zoom:true, recenter:true, keyboardPan:true, keyboardHome:true,
        systemSelection:system, systemActivation:options.hasTouch ? "touch" : "mouse",
        keyboardHandoff:[handoff.source,handoff.target]},
      pageErrors: errors,
    };
  } finally {
    await context.close();
  }
}
