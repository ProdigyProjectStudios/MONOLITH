/** Check the replay schedule and evidence/approval boundaries using a genuine saved deterministic result. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPyodide } from "pyodide";
import {
  blueprintChoice,
  chapters,
  guideDuration,
  playbackPosition,
  receiptIds,
  roles,
  roleReceipts,
  roleTime,
} from "../apps/web/components/guidedPlayback.ts";

const py = await loadPyodide();
const folder = "/tour/monolith";
py.FS.mkdirTree(folder);
py.FS.writeFile(folder + "/__init__.py", "");
for (const name of [
  "core",
  "flagship",
  "portable_investigation",
  "correlations",
  "architecture_review",
]) {
  const filename = new URL(
    "../apps/api/monolith/" + name + ".py",
    import.meta.url,
  );
  try {
    py.FS.writeFile(
      folder + "/" + name + ".py",
      await readFile(filename, "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
py.globals.set(
  "fixture",
  await readFile(
    new URL("../apps/web/public/demo.json", import.meta.url),
    "utf8",
  ),
);
const recorded = JSON.parse(
  py.runPython(`
import json,sys
sys.path.insert(0,"/tour")
from monolith.portable_investigation import investigate_deterministic
ws=json.loads(fixture)
events=[]
def record(kind,stage,payload):
    events.append(dict(seq=len(events)+1,kind=kind,stage=stage,payload=payload))
result=investigate_deterministic(ws["data"],ws["report"],record)
json.dumps({"id":"qa","status":"completed","mode":"deterministic","events":events,"result":result})
`),
);
assert.equal(guideDuration, 90);
assert.equal(playbackPosition(-1).index, 0);
assert.equal(playbackPosition(90).ended, true);
assert.equal(playbackPosition(950).time, 90);
chapters.forEach((chapter, i) => {
  assert.equal(playbackPosition(chapter.start).index, i);
  if (i)
    assert.equal(
      chapters[i - 1].start + chapters[i - 1].duration,
      chapter.start,
    );
});
roles.forEach((r, i) => {
  assert.equal(playbackPosition(roleTime(i)).role, i);
  const receipts = roleReceipts(recorded, r.id);
  assert.ok(receipts.complete && receipts.tools.length);
  assert.ok(receiptIds(receipts.complete).length);
  if (i < roles.length - 1)
    assert.equal(receipts.handoff.payload.to, roles[i + 1].id);
});
assert.equal(recorded.result.package.baseline.median, 31.15);
assert.ok(Object.keys(recorded.result.trials).length >= 2);
const preview = blueprintChoice(recorded);
assert.ok(preview && !preview.approved && preview.approach.artifacts.length);
const alternative = recorded.result.package.approaches.find(
  (a) => a.id !== preview.approach.id,
);
const approved = blueprintChoice({
  ...recorded,
  approval: { approach: alternative.id, at: new Date(0).toISOString() },
});
assert.equal(approved.approved, true);
assert.equal(approved.approach.id, alternative.id);
assert.equal(
  blueprintChoice({
    ...recorded,
    result: { ...recorded.result, verified: false },
  }),
  null,
);
assert.equal(
  blueprintChoice({ ...recorded, approval: { approach: "unavailable" } }),
  null,
);
assert.equal(recorded.approval, undefined);
console.log(
  "Guided replay passed its 90-second timeline, six saved receipts, evidence, simulation trials and read-only blueprint checks.",
);
