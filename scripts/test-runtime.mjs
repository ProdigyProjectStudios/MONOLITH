import assert from "node:assert/strict";
import fs from "node:fs";
import { loadPyodide } from "pyodide";
const py = await loadPyodide();
py.runPython(fs.readFileSync("apps/api/monolith/core.py", "utf8"));
const fixture = JSON.parse(
  fs.readFileSync("apps/web/public/demo.json", "utf8"),
);
py.globals.set("fixture", JSON.stringify(fixture.data));
py.globals.set(
  "csv_content",
  fs.readFileSync("apps/web/public/sample-events.csv", "utf8"),
);
const result = JSON.parse(
  py.runPython(`
data=json.loads(fixture)
before=analyse(data)
part=parse_csv(csv_content,"sample-events.csv")
merge(data,*part)
merge(data,*part)
after=analyse(data)
json.dumps([before["events"],after["events"],analyse(data,7)["events"],after["cases"]])
`),
);
assert.equal(result[0], fixture.report.events);
assert.equal(result[1], fixture.report.events + 3);
assert.ok(result[2] < result[1]);
assert.equal(result[3], fixture.report.cases + 1);
console.log(
  "WebAssembly engine parity, CSV ingestion, deduplication and range filtering passed.",
);
