let runtime;
async function boot() {
  const { loadPyodide } = await import("/runtime/pyodide.mjs");
  const py = await loadPyodide({
    indexURL: new URL("/runtime/", self.location.href).href,
  });
  const response = await fetch("/runtime/core.py");
  if (!response.ok) throw Error("Could not load the analysis engine");
  py.runPython(await response.text());
  return py;
}
self.onmessage = async ({ data: { id, task, data, days, file } }) => {
  try {
    const py = await (runtime ??= boot().catch((e) => {
      runtime = null;
      throw e;
    }));
    py.globals.set("raw_input_json", JSON.stringify({ data, days, file }));
    const output = py.runPython(`
request=json.loads(raw_input_json)
current=request["data"]
before=len(current["events"])+len(current["docs"])
if request.get("file"):
    f=request["file"]
    src,rows=parse_csv(f["text"],f["name"]) if "text" in f else document(f["pages"],f["name"])
    merge(current,src,rows)
json.dumps({"data":current,"report":analyse(current,request["days"]),"added":len(current["events"])+len(current["docs"])-before})
`);
    self.postMessage({ id, value: JSON.parse(output) });
  } catch (e) {
    self.postMessage({
      id,
      error: String(e.message || e)
        .split("\n")
        .filter(Boolean)
        .slice(-1)[0],
    });
  }
};
