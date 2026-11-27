// Run after npm run build. Captures are optional and belong outside the repository.
import {createRequire} from "node:module";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve("dist");
const seed = JSON.parse(await readFile(path.join(root,"demo.json")));
const types = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".woff2":"font/woff2",".wasm":"application/wasm"};
const server = createServer(async (req,res) => {
  const name = new URL(req.url,"http://localhost").pathname;
  const file = path.resolve(root,"."+(name === "/" ? "/index.html" : name));
  try {
    assert(file.startsWith(root+path.sep));
    res.setHeader("Content-Type",types[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || "/usr/bin/chromium",args:["--no-sandbox","--enable-unsafe-swiftshader"]});
const origin = "http://127.0.0.1:"+server.address().port;
try {
  for (const [width, motion, fallback] of [[1440,"no-preference",false],[390,"reduce",false],[390,"reduce",true]]) {
    const page = await browser.newPage({viewport:{width,height:900},reducedMotion:motion});
    const errors = [];
    page.on("pageerror",e => errors.push(e.message));
    if (fallback) await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type,...args) {
        return type.includes("webgl") ? null : get.call(this,type,...args);
      };
    });
    await page.goto(origin+"/#business-map");
    const atlas = page.getByRole("region",{name:"Handoff atlas",exact:true});
    const routes = atlas.getByRole("complementary",{name:"Directed handoffs"});
    const first = [...seed.report.links].sort((a,b)=>b.count-a.count)[0];
    await atlas.getByRole("heading",{name:first.source+" to "+first.target}).waitFor();
    assert.equal(await routes.locator("button[aria-pressed]").count(),seed.report.links.length+2);
    assert.equal(await atlas.locator("dl dd").first().innerText(),String(first.count));
    await atlas.locator('[data-renderer="'+(fallback?"static":"webgl")+'"]').waitFor();
    if (!fallback) {
      const canvas = atlas.locator("canvas");
      const before = await canvas.screenshot();
      const next = await canvas.screenshot();
      if (motion === "reduce") assert.deepEqual(next,before,"reduced motion stays still");
      else {
        assert(!next.equals(before),"active route should morph between frames");
        await atlas.getByRole("button",{name:"Pause map motion"}).click();
        const paused = await canvas.screenshot();
        assert.deepEqual(await canvas.screenshot(),paused,"pausing freezes the route");
        await atlas.getByRole("button",{name:"Play map motion"}).click();
      }
    }
    if (process.env.ATLAS_QA_OUTPUT && !fallback) {
      await mkdir(process.env.ATLAS_QA_OUTPUT,{recursive:true});
      await page.screenshot({path:path.join(process.env.ATLAS_QA_OUTPUT,"atlas-"+width+".png"),fullPage:true});
    }
    await routes.getByRole("button",{name:"By interval"}).click();
    const other = routes.locator("button[aria-pressed=false]").filter({has:page.locator("b")}).first();
    const targetHeading = await other.locator("span").innerText();
    await other.click();
    assert.equal((await atlas.locator("h2").first().innerText()).replace(/\s+/g," ").trim(),targetHeading.replace(/\s+/g," ").trim());
    assert.notEqual(await atlas.locator("h2").first().innerText(),first.source+" "+first.target);
    const sample = atlas.locator("details").first();
    await sample.locator("time").first().waitFor();
    assert.equal(await sample.locator("time").count(),2);
    await sample.locator("summary").click();
    assert.equal(await sample.getAttribute("open"),null);
    await atlas.getByRole("button",{name:"Pause map motion"}).click();
    await atlas.getByRole("button",{name:"Play map motion"}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.addScriptTag({path:createRequire(import.meta.url).resolve("axe-core/axe.min.js")});
    const issues = await page.evaluate(async () => (await window.axe.run(
      document.querySelector('[aria-label="Handoff atlas"]'),
      {runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}}
    )).violations.map(v => [v.id,v.nodes.map(n => n.target)]));
    assert.deepEqual(issues,[], "Atlas accessibility violations");
    await atlas.getByRole("button",{name:/^Inspect /}).first().click();
    const views=page.getByRole("group",{name:"Map view"});
    assert.equal(await views.getByRole("button",{name:"System topology"}).getAttribute("aria-pressed"),"true");
    await views.getByRole("button",{name:"Operational twin"}).click();
    await page.getByRole("button",{name:"Graph history"}).waitFor();
    assert.deepEqual(errors,[]);
    await page.close();
    console.log("Passed handoff inspection at",width,motion,fallback?"fallback":"WebGL");
  }
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
