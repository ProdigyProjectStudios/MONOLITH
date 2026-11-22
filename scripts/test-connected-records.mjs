/**
 * Exercise the built export, real FastAPI handlers, and an isolated database.
 * CRM observations belong to a named test tenant and come entirely from fixtures.
 * Run after npm run build with node scripts/test-connected-records.mjs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiDir = path.join(root, "apps/api");
const python = path.join(apiDir, ".venv/bin/python");
const tmp = await mkdtemp(path.join(tmpdir(), "monolith-records-"));
const token = randomBytes(24).toString("hex"),
  emptyToken = randomBytes(24).toString("hex");
const children = new Set();
let browser;
async function service(code, args, env) {
  const child = spawn(python, ["-u", "-c", code, ...args], {
    cwd: apiDir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PYTHONUNBUFFERED: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let error = "";
  child.stderr.on("data", (chunk) => {
    error = (error + String(chunk)).slice(-2200);
  });
  const lines = createInterface({ input: child.stdout });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("QA service did not start. " + error)),
      20000,
    );
    child.once("exit", (code) => {
      children.delete(child);
      clearTimeout(timer);
      reject(Error("QA service exited " + code + ". " + error));
    });
    lines.on("line", (line) => {
      if (/^PORT [0-9]+$/.test(line)) {
        clearTimeout(timer);
        resolve("http://127.0.0.1:" + line.slice(5));
      }
    });
  });
}
try {
  const web = await service(
    `
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys
server=ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler,directory=sys.argv[1]))
print("PORT",server.server_address[1]);server.serve_forever()
`,
    [path.join(root, "dist")],
    {},
  );
  const api = await service(
    `
from monolith import store
from monolith.main import app
from pathlib import Path
import runpy, socket, uvicorn
fixture=runpy.run_path(str(Path("tests/test_correlations.py")))
store.init()
crm, csv=fixture["crm"],fixture["operational"]
store.save_batch("fixture",[
  crm("770","412",1,"old-42","fixture-review"),
  crm("770","412",2,"case-41","fixture-approved"),
  csv([("CASE-41","Fixture verification","",""),("CASE-42","Fixture fulfilment","770","412"),("CASE-42","Fixture dispatch","",""),("OLD-42","Fixture old reference","","")])
],"QA fixture import")
sock=socket.socket();sock.bind(("127.0.0.1",0));sock.listen(20)
print("PORT",sock.getsockname()[1])
uvicorn.Server(uvicorn.Config(app,access_log=False,log_level="warning")).run(sockets=[sock])
`,
    [],
    {
      DATABASE_URL: "sqlite:///" + path.join(tmp, "fixture.db"),
      WEB_ORIGINS: web,
      TENANT_TOKENS: JSON.stringify({ fixture: token, empty: emptyToken }),
      MONOLITH_ENV: "production",
    },
  );
  let healthy = false;
  for (let n = 0; n < 100 && !healthy; n++) {
    try {
      healthy = (await fetch(api + "/api/health")).ok;
    } catch {}
    if (!healthy) await new Promise((r) => setTimeout(r, 80));
  }
  assert.ok(healthy, "API became healthy");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const errors = [];
  async function open(access) {
    const ctx = await browser.newContext({
      viewport: { width: 1450, height: 980 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    await ctx.addInitScript(
      ({ api, access }) => {
        sessionStorage.setItem("monolith-api-origin", api);
        sessionStorage.setItem("monolith-bearer/" + api, access);
      },
      { api, access },
    );
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(web + "/#business-map");
    await page
      .getByRole("button", { name: "Connected records", exact: true })
      .click()
      .catch(async (e) => {
        throw Error(
          e.message +
            "\nRendered page: " +
            (await page.locator("body").innerText()).slice(0, 2400) +
            "\nRuntime errors: " +
            errors.join(" | "),
        );
      });
    return page;
  }
  const page = await open(token);
  await page.getByRole("heading", { name: "Deal 412", exact: true }).waitFor();
  await page.getByText("HS-770-412", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Source record" })
      .getAttribute("href"),
    "https://app.hubspot.com/contacts/770/record/0-3/412",
  );
  await page
    .getByRole("heading", { name: "Exact source-key matches 2" })
    .waitFor();
  await page.getByRole("heading", { name: "Hypotheses to verify 2" }).waitFor();
  const direct = page.locator("details").filter({
    has: page.locator("summary em", { hasText: "Scoped object ID" }),
  });
  await direct.locator(":scope > summary").click();
  await direct
    .getByText(/CSV hubspot_portal_id=770 and hubspot_deal_id=412/)
    .waitFor();
  assert.equal(await direct.locator("details.evidence").count(), 2);
  await direct.locator("details.evidence").last().locator("summary").click();
  await direct.getByText(/fixture.csv · row/).waitFor();
  const indirect = page.locator("details").filter({
    has: page.locator("summary em", { hasText: "Case participation" }),
  });
  await indirect.locator(":scope > summary").click();
  assert.equal(await indirect.locator("details.evidence").count(), 3);
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await page
    .getByRole("heading", { name: "Observed snapshot history 2" })
    .waitFor();
  await page.getByText("fixture-review", { exact: true }).waitFor();
  await page.getByText("order_reference = old-42", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Process cases", exact: true })
    .click();
  await page.locator("summary").filter({ hasText: "CASE-42" }).click();
  await page
    .getByRole("button", { name: "Open process variant", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Process explorer", exact: true })
    .waitFor();
  const empty = await open(emptyToken);
  await empty
    .getByRole("heading", { name: "No synced HubSpot deals" })
    .waitFor();
  assert.equal(await empty.getByText("Deal 412", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Chromium passed: authenticated record, two exact matches, two hypotheses, row provenance, both observed snapshots, process drill-through, empty tenant, no page errors.",
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  await rm(tmp, { recursive: true, force: true });
}
