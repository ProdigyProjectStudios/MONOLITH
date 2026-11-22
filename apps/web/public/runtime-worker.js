let runtime;
async function boot() {
  const { loadPyodide } = await import("/runtime/pyodide.mjs");
  const py = await loadPyodide({
    indexURL: new URL("/runtime/", self.location.href).href,
  });
  py.FS.mkdir("/home/pyodide/monolith");
  py.FS.writeFile("/home/pyodide/monolith/__init__.py", "");
  await Promise.all(
    ["core", "flagship", "evaluation", "portable_investigation"].map(async (name) => {
      const res = await fetch("/runtime/" + name + ".py");
      if (!res.ok) throw Error("Unable to load " + name + " analysis module.");
      py.FS.writeFile(
        "/home/pyodide/monolith/" + name + ".py",
        await res.text(),
      );
    }),
  );
  py.runPython(`
import json
from monolith.core import analyse,parse_csv,document,merge
from monolith.flagship import build_package,simulate_scenario
from monolith.evaluation import evaluate
from monolith.portable_investigation import investigate_deterministic

def dispatch(task,request,notify):
    data=request["data"]
    if task=="analyse":
        before=len(data["events"])+len(data["docs"])
        f=request.get("file")
        if f:
            part=parse_csv(f["text"],f["name"]) if "text" in f else document(f["pages"],f["name"])
            merge(data,*part)
        return {"data":data,"report":analyse(data,request["days"]),"added":len(data["events"])+len(data["docs"])-before}
    if task=="package": return build_package(data,request["report"])
    if task=="simulate": return simulate_scenario(data,request["report"],request["assumptions"])
    if task=="evaluate": return evaluate(data,request["report"],request["result"])
    if task=="investigate":
        return investigate_deterministic(data,request["report"],lambda kind,stage,payload: notify(kind,stage,json.dumps(payload)))
    raise ValueError("Unknown analysis operation")
`);
  return py;
}
self.onmessage = async ({ data: { id, task, ...args } }) => {
  try {
    const py = await (runtime ??= boot().catch((err) => {
      runtime = undefined;
      throw err;
    }));
    py.globals.set("operation", task);
    py.globals.set("raw_request", JSON.stringify(args));
    py.globals.set("notify_js", (kind, stage, payload) =>
      self.postMessage({
        id,
        event: { kind, stage, payload: JSON.parse(payload) },
      }),
    );
    const json = py.runPython(
      "json.dumps(dispatch(operation,json.loads(raw_request),notify_js),allow_nan=False)",
    );
    self.postMessage({ id, value: JSON.parse(json) });
  } catch (e) {
    self.postMessage({
      id,
      error: String(e.message || e)
        .trim()
        .split("\n")
        .at(-1),
    });
  }
};
