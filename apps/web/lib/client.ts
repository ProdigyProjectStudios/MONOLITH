import { type Audit, type Data, type Report, type State } from "./types";
export const server = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
async function request(path: string, opts: RequestInit = {}) {
  const token = sessionStorage.getItem("monolith-token");
  const res = await fetch(server + "/api/" + path, {
    ...opts,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw Error(
      typeof msg.detail === "string"
        ? msg.detail
        : "Request failed (" + res.status + ")",
    );
  }
  return res.json();
}
const post = (path: string, obj: unknown) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
function cache(
  mode: IDBTransactionMode,
  value?: State,
): Promise<State | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("monolith-workspace-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("state");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("state", mode);
      const table = tx.objectStore("state");
      const op = value ? table.put(value, "current") : table.get("current");
      tx.oncomplete = () => {
        db.close();
        resolve(value || op.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
let worker: Worker | undefined;
let counter = 0;
async function compute(
  data: Data,
  days: number,
  file?: { name: string; text?: string; pages?: string[] },
): Promise<{ data: Data; report: Report; added: number }> {
  worker ??= new Worker("/runtime-worker.js", { type: "module" });
  const id = ++counter;
  const w = worker;
  return new Promise((resolve, reject) => {
    const clean = () => {
      w.removeEventListener("message", handler);
      w.removeEventListener("error", fail);
    };
    const fail = () => {
      clean();
      worker = undefined;
      reject(Error("Analysis engine failed to load. Retry the operation."));
    };
    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        clean();
        if (e.data.error) reject(Error(e.data.error));
        else resolve(e.data.value);
      }
    };
    w.addEventListener("message", handler);
    w.addEventListener("error", fail);
    w.postMessage({ id, data, days, file });
  });
}
async function apiReport(days: number, ai = false): Promise<Report> {
  let v = await post("analysis", { days, use_ai: ai });
  if (v.job) {
    const id = v.job;
    for (let n = 0; n < 420; n++) {
      await new Promise((r) => setTimeout(r, 1000));
      v = await request("jobs/" + id);
      if (v.report) break;
    }
  }
  if (!v.report)
    throw Error("The analysis timed out. Check Agent activity and retry.");
  return v.report;
}
export async function load(): Promise<State> {
  if (server) {
    const ws = await request("workspace");
    return { ...ws, report: await apiReport(30) };
  }
  const previous = await cache("readonly");
  if (previous) return previous;
  const res = await fetch("/demo.json");
  if (!res.ok) throw Error("Unable to load the synthetic workspace.");
  return {
    ...(await res.json()),
    ai: false,
    hubspot: false,
    tenant: "northstar",
    audit: [],
  };
}
function log(action: string, detail: string): Audit {
  return { action, detail, at: new Date().toISOString() };
}
async function persist(s: State) {
  await cache("readwrite", s);
  return s;
}
export async function run(s: State, days: number, ai = false) {
  if (server) {
    const report = await apiReport(days, ai);
    return { ...s, ...(await request("workspace")), report };
  }
  const result = await compute(s.data, days);
  return persist({
    ...s,
    ...result,
    audit: [
      log(
        "Analysis completed",
        result.report.events + " events · " + days + " days",
      ),
      ...s.audit,
    ].slice(0, 100),
  });
}
export async function ingest(s: State, file: File) {
  if (file.size > 6 * 1024 * 1024) throw Error("Maximum file size is 6 MB.");
  if (server) {
    const form = new FormData();
    form.set("file", file);
    await request("upload", { method: "POST", body: form });
    return run(s, s.report.days);
  }
  let payload: { name: string; text?: string; pages?: string[] } = {
    name: file.name,
  };
  if (/\.csv$/i.test(file.name)) payload.text = await file.text();
  else if (/\.pdf$/i.test(file.name)) {
    const pdf = await import(
      /* webpackIgnore: true */ "/runtime/pdf.mjs" as string
    );
    pdf.GlobalWorkerOptions.workerSrc = "/runtime/pdf.worker.mjs";
    const doc = await pdf.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    try {
      if (doc.numPages > 100) throw Error("Maximum PDF length is 100 pages.");
      payload.pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        payload.pages.push(
          content.items.map((x: { str?: string }) => x.str || "").join(" "),
        );
      }
    } finally {
      await doc.destroy();
    }
  } else throw Error("Choose a CSV event log or PDF document.");
  const result = await compute(s.data, s.report.days, payload);
  return persist({
    ...s,
    ...result,
    audit: [
      log("Source ingested", file.name + " · " + result.added + " new records"),
      ...s.audit,
    ].slice(0, 100),
  });
}
export async function review(s: State, id: string, decision: string) {
  if (server)
    return { ...s, ...(await post("review", { opportunity: id, decision })) };
  return persist({
    ...s,
    audit: [log(decision, id), ...s.audit].slice(0, 100),
  });
}
export async function syncHubSpot(s: State) {
  await request("connectors/hubspot/sync", { method: "POST" });
  return run(s, s.report.days);
}
