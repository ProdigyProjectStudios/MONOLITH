import assert from "node:assert/strict";

// Sample the rendered pixels during real keyboard input. A class change or a
// correctly labelled control is insufficient evidence of a visual transition.
async function watchRelief(canvas) {
  await canvas.evaluate((surface) => {
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 56;
    const context = sample.getContext("2d", { willReadFrequently: true });
    const read = () => {
      context.clearRect(0, 0, sample.width, sample.height);
      context.drawImage(surface, 0, 0, sample.width, sample.height);
      const rgba = context.getImageData(0, 0, sample.width, sample.height).data;
      let hash = 2166136261;
      for (const channel of rgba) hash = Math.imul(hash ^ channel, 16777619);
      return hash >>> 0;
    };
    const start = read();
    const frames = [];
    let frameId;
    function capture() {
      frames.push({ pixels: read(), state: surface.dataset.paintState });
      frameId = requestAnimationFrame(capture);
    }
    surface.reliefQASample = {
      stop() {
        cancelAnimationFrame(frameId);
        delete surface.reliefQASample;
        return { start, end: read(), frames };
      },
    };
    frameId = requestAnimationFrame(capture);
  });
}

async function transition(page, canvas, action, reduced) {
  await watchRelief(canvas);
  await action();
  await page.waitForFunction(surface => surface.dataset.paintState === "settled", await canvas.elementHandle());
  await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { start, end, frames } = await canvas.evaluate(surface => surface.reliefQASample.stop());
  assert.notEqual(start, end, "Changing the observation must change the rendered relief");
  const intermediate = new Set(frames
    .filter(frame => frame.pixels !== start && frame.pixels !== end)
    .map(frame => frame.pixels));
  if (reduced) {
    assert.equal(intermediate.size, 0, "Reduced motion changes directly to the measured end geometry");
    assert.ok(frames.every(frame => frame.state !== "transitioning"));
  } else {
    assert.ok(intermediate.size > 0, "Motion must pass through distinct intermediate geometry");
  }
  return { intermediateFrames: intermediate.size, initialPixels: start, finalPixels: end };
}

export async function checkRelief(page, seed, reduced) {
  const region = page.getByRole("region", { name: "Operational map", exact: true });
  const field = region.locator("[data-operational-relief]");
  const canvas = field.locator("canvas[data-relief-surface]");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForFunction(surface => surface.dataset.paintState === "settled", await canvas.elementHandle());
  const systems = field.locator("[data-relief-system]");
  assert.deepEqual(
    (await systems.evaluateAll(nodes => nodes.map(node => node.dataset.reliefSystem))).sort(),
    seed.report.systems.map(system => system.name).sort(),
    "Every observed system has a labelled evidence control",
  );
  for (const {name, count} of seed.report.systems) {
    const opener = systems.and(field.getByRole("button", { name: new RegExp(name, "i") }));
    assert.ok((await opener.getAttribute("aria-label")).includes(count.toLocaleString("en-GB") + " observed events"),
      name + " reconciles to the report population");
    await opener.focus();
    await opener.press("Enter");
    const evidence = page.getByRole("dialog", { name: name + " evidence", exact: true });
    await evidence.waitFor();
    const text = await evidence.innerText();
    assert.ok(seed.data.events.some(row => row.system === name && text.includes(row.case)),
      name + " must expose a case recorded by that system");
    const witness = evidence.locator("details").first();
    await witness.locator("summary").click();
    const witnessText = await witness.innerText();
    const sourceRow = seed.data.events.find(row => witnessText.includes(row.id));
    assert.ok(sourceRow && witnessText.includes(sourceRow.case) && witnessText.includes("row " + sourceRow.row),
      name + " exposes its exact event ID, case and source line");
    const source = seed.data.sources.find(item => item.id === sourceRow.source);
    assert.ok(source && witnessText.includes(source.name), name + " resolves the source filename");
    await page.keyboard.press("Escape");
    await evidence.waitFor({ state: "hidden" });
    await page.waitForFunction(element => document.activeElement === element, await opener.elementHandle(), {timeout: 2000});
  }

  // Hit the rendered seam itself. The SVG leader does not receive pointer
  // events; the relief must resolve this point back to its measured system.
  const hotspot = field.locator('g[data-warm="true"] circle');
  const hotSystem = await systems.and(field.locator('[data-warm="true"]')).getAttribute("data-relief-system");
  await hotspot.scrollIntoViewIfNeeded();
  const mark = await hotspot.boundingBox();
  assert.ok(mark && mark.width > 0 && mark.height > 0);
  const x = mark.x + mark.width * 0.5, y = mark.y + mark.height * 0.5;
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await page.touchscreen.tap(x,y);
  else await page.mouse.click(x,y);
  const selection = page.getByRole("dialog", { name: hotSystem + " evidence", exact: true });
  await selection.waitFor();
  await page.keyboard.press("Escape");
  await selection.waitFor({state:"hidden"});

  const volume = region.getByRole("button", { name: "Volume", exact: true });
  await volume.focus();
  const mode = await transition(page, canvas, async () => {
    await volume.press("Enter");
    await page.waitForFunction(el => el.dataset.mode === "volume", await field.elementHandle());
  }, reduced);

  const slider = page.getByRole("slider", { name: "Operational field timeline", exact: true });
  await slider.focus();
  const storedEpoch = await field.getAttribute("data-epoch");
  const timeline = await transition(page, canvas, async () => {
    await slider.press("Home");
    await page.waitForFunction(({ element, prev }) => element.dataset.epoch !== prev,
      { element: await field.elementHandle(), prev: storedEpoch });
  }, reduced);
  const first = await slider.inputValue();
  await page.getByRole("button", { name: "Play field history", exact: true }).click();
  await page.waitForFunction(({ element, initial }) => element.value !== initial,
    { element: await slider.elementHandle(), initial: first });
  await page.getByRole("button", { name: "Pause field history", exact: true }).click();
  await page.getByRole("button", { name: "Full report", exact: true }).click();
  await page.waitForFunction(el => el.dataset.epoch === "report", await field.elementHandle());
  return { mode, timeline };
}
