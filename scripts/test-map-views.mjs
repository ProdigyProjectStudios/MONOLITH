// Run against the production export after npm run build.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import axe from "axe-core";
import { chromium } from "playwright-core";
import { serveExport } from "./serve-test-export.mjs";

const dist = path.resolve("dist");
const { report, data } = JSON.parse(await readFile(path.join(dist, "demo.json"), "utf8"));
const server = await serveExport(dist);
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const busiest = [...report.links].sort((a, b) => b.count - a.count)[0];
const system = report.systems.find(s => s.name === busiest.target);
const records = new Map(data.events.map(event => [event.id, event]));

async function checkLayout(page, region, width, view) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), view + " overflows");
  await page.addScriptTag({ content: axe.source });
  const violations = await region.evaluate(async el =>
    (await window.axe.run(el, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    })).violations.map(v => [v.id, v.nodes.map(n => n.target)]),
  );
  assert.deepEqual(violations, [], view + " accessibility");
  if (process.env.MAP_VIEW_QA_OUTPUT) {
    await mkdir(process.env.MAP_VIEW_QA_OUTPUT, { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(process.env.MAP_VIEW_QA_OUTPUT, view + "-" + width + ".jpg") });
  }
}

try {
  for (const [width, motion] of [[1440, "no-preference"], [390, "reduce"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: motion });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?map=topology#business-map");
    const views = page.getByRole("group", { name: "Map view" });
    const topology = page.getByRole("region", { name: "System topology", exact: true });
    const inspector = topology.getByRole("complementary", { name: "System inspector" });
    await inspector.getByLabel("Inspect system").selectOption(system.name);
    await inspector.getByRole("heading", { name: system.name, exact: true }).waitFor();
    assert.equal(await views.getByRole("button", { name: "System topology" }).getAttribute("aria-pressed"), "true");
    const traffic = (await inspector.innerText()).replace(/\s+/g, " ");
    assert(traffic.includes(system.count + " observed events"));
    for (const [label, key] of [["Incoming", "target"], ["Outgoing", "source"]]) {
      const count = report.links.filter(link => link[key] === system.name).reduce((sum, link) => sum + link.count, 0);
      assert(traffic.includes(label + " " + count.toLocaleString("en-GB")), label + " handoff total");
    }
    await checkLayout(page, topology, width, "topology");

    const route = inspector.getByRole("button", { name: new RegExp(busiest.source + ".*" + busiest.target + ".*" + busiest.count) });
    await route.click();
    const evidence = topology.getByRole("region", { name: "Topology evidence" });
    await evidence.getByText("Handoff evidence", { exact: true }).waitFor();
    await topology.getByRole("button", { name: "Inspect evidence" }).click();
    assert(await evidence.evaluate(el => el === document.activeElement));
    const pair = [];
    for (const i of [0, 1]) {
      const detail = evidence.locator("details").nth(i);
      await detail.locator("summary").click();
      const citation = detail.locator(":scope > div code");
      await citation.waitFor({ state: "visible" });
      const id = (await citation.textContent()).trim();
      assert(records.has(id), "Evidence ID resolves to a source event");
      pair.push(records.get(id));
    }
    assert.deepEqual(pair.map(row => row.system), [busiest.source, busiest.target]);
    assert.equal(pair[0].case, pair[1].case);
    const history = data.events
      .filter(row => row.case === pair[0].case)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    const fromIndex = history.findIndex(row => row.id === pair[0].id);
    assert.equal(history[fromIndex + 1]?.id, pair[1].id, "Evidence is consecutive in the original case");

    await views.getByRole("button", { name: "Operational twin" }).click();
    const twin = page.getByRole("region", { name: "Business digital twin" });
    await twin.waitFor();
    assert.equal(new URL(page.url()).searchParams.get("map"), "twin");
    await page.reload();
    await twin.waitFor();
    await page.goBack();
    await topology.waitFor();
    await page.goForward();
    await twin.waitFor();
    await checkLayout(page, twin, width, "twin");

    const layers = twin.getByRole("group", { name: "Graph layers" });
    const filter = twin.getByLabel("Filter by system");
    await filter.selectOption(system.name);
    const field = twin.getByRole("group", { name: "Operational twin · Systems" });
    const node = field.getByRole("button", { name: system.name, exact: true });
    await node.focus();
    await node.press("Enter");
    const entity = twin.getByRole("complementary", { name: "Entity inspector" });
    await entity.getByRole("heading", { name: system.name, exact: true }).waitFor();
    await twin.getByRole("region", { name: "Relationship index" }).getByRole("button").first().press("Enter");
    assert(await entity.evaluate(el => el === document.activeElement));
    await layers.getByRole("button", { name: "Events", exact: true }).click();
    assert((await twin.getByLabel("Case timeline").inputValue()).length);
    const query = twin.getByLabel("Search map entities");
    await query.fill("absent-test-entity");
    await twin.getByText("No entities match this search.").waitFor();
    await query.fill("");
    await twin.getByRole("group", { name: "Operational twin · Events" }).waitFor();

    assert.deepEqual(errors, []);
    await page.close();
    console.log("Map view navigation, keyboard, measured traffic, source records and accessibility passed at", width, motion);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
