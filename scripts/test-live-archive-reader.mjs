/** Archive boundary tests. No provider calls and no fixture is written into the application. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  archiveIndexPath,
  loadLiveArchive,
  parseArchiveIndex,
} from "../apps/web/lib/liveArchive.ts";

const controller = new AbortController(),
  signal = controller.signal;
const empty = { schema: "monolith.replays.index.v1", captures: [] };
const json = (v) =>
  new Response(JSON.stringify(v), {
    headers: { "content-type": "application/json" },
  });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function reference(bytes) {
  const sha256 = hash(bytes);
  return {
    id: "northstar-refund-live",
    path: "/replays/northstar-refund-live-" + sha256 + ".json",
    sha256,
    bytes: bytes.length,
  };
}
function serve(index, body, visited = []) {
  return async (pathname, options) => {
    visited.push(pathname);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.mode, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    assert.equal(options.signal, signal);
    if (pathname === archiveIndexPath) return json(index);
    assert.equal(pathname, index.captures[0].path);
    return new Response(body, {
      headers: { "content-type": "application/json" },
    });
  };
}
const noRequests = [];
await assert.rejects(
  loadLiveArchive("another-workspace", signal, serve(empty, null, noRequests)),
  /belongs to the Northstar demo/,
);
assert.equal(noRequests.length, 0);
const checked = [];
assert.equal(
  await loadLiveArchive("northstar", signal, serve(empty, null, checked)),
  null,
);
assert.deepEqual(checked, [archiveIndexPath]);
assert.equal(
  await loadLiveArchive(
    "northstar",
    signal,
    async () => new Response("", { status: 404 }),
  ),
  null,
);
const valid = reference(Buffer.from("null"));
for (const field of [
  { path: "https://different-origin.invalid/file" },
  { path: "/replays/../another.json" },
  { bytes: 8 * 1024 * 1024 + 1 },
  { bytes: -1 },
  { sha256: "malformed" },
]) {
  assert.throws(
    () => parseArchiveIndex({ ...empty, captures: [{ ...valid, ...field }] }),
    /invalid capture reference/,
  );
}
await assert.rejects(
  loadLiveArchive(
    "northstar",
    signal,
    serve({ ...empty, captures: [valid] }, Buffer.from("true")),
  ),
  /integrity check/,
);
await assert.rejects(
  loadLiveArchive(
    "northstar",
    signal,
    serve({ ...empty, captures: [valid] }, Buffer.from("oversized")),
  ),
  /size limit/,
);
await assert.rejects(
  loadLiveArchive(
    "northstar",
    signal,
    async () =>
      new Response("<html>Missing</html>", {
        headers: { "content-type": "text/html" },
      }),
  ),
  /unexpected file type/,
);
await assert.rejects(
  loadLiveArchive(
    "northstar",
    signal,
    serve({ ...empty, captures: [valid] }, Buffer.from("null")),
  ),
  /schema is unsupported/,
);
console.log(
  "Archive loader passed atomic same-origin, zero-credential, tenant scope, empty catalog, size, schema and digest checks.",
);

if (process.argv[2]) {
  // The separate exporter QA fixture is supplied explicitly from a private temporary directory.
  const directory = path.resolve(process.argv[2]),
    index = JSON.parse(
      await readFile(path.join(directory, "index.json"), "utf8"),
    );
  const entry = parseArchiveIndex(index);
  assert.ok(entry);
  const body = await readFile(path.join(directory, path.basename(entry.path)));
  const result = await loadLiveArchive("northstar", signal, serve(index, body));
  assert.equal(result.snapshot.ai, false);
  assert.equal(result.snapshot.hubspot, false);
  assert.equal(result.snapshot.tenant, "northstar");
  assert.equal(result.run.mode, "live");
  assert.ok(result.run.approval);
  async function altered(change, err) {
    const value = JSON.parse(body);
    change(value);
    const b = Buffer.from(JSON.stringify(value));
    const ref = reference(b);
    await assert.rejects(
      loadLiveArchive(
        "northstar",
        signal,
        serve({ ...empty, captures: [ref] }, b),
      ),
      err,
    );
  }
  assert.ok(
    result.fixture,
    "The positive UI test must carry an explicit fixture designation.",
  );
  await altered((v) => {
    v.run.result.package.baseline.median += 1;
  }, /baseline disagrees/);
  await altered((v) => {
    v.provenance.tenant = "other";
  }, /public Northstar/);
  await altered((v) => {
    v.snapshot.data.events[0].system = "different";
  }, /published Northstar seed/);
  await altered((v) => {
    v.run.mode = "deterministic";
  }, /completed, verified/);
  await altered((v) => {
    delete v.run.approval;
  }, /completed, verified/);
  await altered((v) => {
    v.run.result.evidence[0] = "missing-evidence";
  }, /missing from its archived source/);
  await altered((v) => {
    v.run.events.find((e) => e.kind === "model_call").payload.provider =
      "test-fixture";
  }, /OpenAI Responses receipts/);
  await altered((v) => {
    v.acceptance.tokens.total_tokens += 1;
  }, /do not reconcile/);
  console.log(
    "Private release-shaped fixture accepted; tampered evidence, provenance, provider receipts and approval rejected. Fixture validation only.",
  );
}
