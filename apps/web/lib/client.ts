import { runtimeTask } from "./runtime";
import { type Audit, type Data, type Report, type State } from "./types";
const defaultServer = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const preference = "monolith-api-origin";
export const server =
  typeof window === "undefined"
    ? defaultServer
    : (sessionStorage.getItem(preference) ?? defaultServer);
const credentialKey = "monolith-bearer/" + server;
export function setAccessToken(value: string) {
  sessionStorage.setItem(credentialKey, value);
}
export function useBrowserRuntime() {
  sessionStorage.setItem(preference, "");
  location.reload();
}
export async function attachRuntime(raw: string) {
  const destination = new URL(raw.trim());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    destination.hostname,
  );
  if (
    (destination.protocol !== "https:" &&
      !(loopback && destination.protocol === "http:")) ||
    destination.username ||
    destination.password ||
    destination.search ||
    destination.hash
  ) {
    throw Error(
      "Enter an HTTPS API URL, or HTTP on localhost, without credentials or query parameters.",
    );
  }
  const base = destination.href.replace(/\/$/, "");
  const health = await fetch(base + "/api/health", {
    signal: AbortSignal.timeout(8000),
    credentials: "omit",
    redirect: "error",
  });
  if (!health.ok || (await health.json()).status !== "ok")
    throw Error("This endpoint did not return a healthy MONOLITH API.");
  sessionStorage.setItem(preference, base);
  location.reload();
}
export async function response(path: string, opts: RequestInit = {}) {
  const token =
    sessionStorage.getItem(credentialKey) ||
    (server &&
      server === defaultServer &&
      sessionStorage.getItem("monolith-token"));
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
  return res;
}
export async function request(path: string, opts: RequestInit = {}) {
  return (await response(path, opts)).json();
}
export const post = (path: string, obj: unknown) =>
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
async function compute(
  data: Data,
  days: number,
  file?: { name: string; text?: string; pages?: string[]; synthetic?: boolean },
) {
  return runtimeTask<{ data: Data; report: Report; added: number }>("analyse", {
    data,
    days,
    file,
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
export async function readSavedWorkspace(tenant: string) {
  const saved = await cache("readonly");
  return saved?.tenant === tenant ? saved : undefined;
}
function changeWorkspace(s: State, update: (current: State) => Promise<State>) {
  return navigator.locks.request(
    "monolith/source-writes/" + s.tenant,
    async () => {
      const current = (await readSavedWorkspace(s.tenant)) ?? s;
      const next = await update(current);
      const bus = new BroadcastChannel("monolith/sources/" + s.tenant);
      bus.postMessage("saved");
      bus.close();
      return next;
    },
  );
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
  return changeWorkspace(s, async (s) => {
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
  return changeWorkspace(s, async (s) => {
    const result = await compute(s.data, s.report.days, payload);
    return persist({
      ...s,
      ...result,
      audit: [
        log(
          "Source ingested",
          file.name + " · " + result.added + " new records",
        ),
        ...s.audit,
      ].slice(0, 100),
    });
  });
}
export async function review(s: State, id: string, decision: string) {
  if (server)
    return { ...s, ...(await post("review", { opportunity: id, decision })) };
  return changeWorkspace(s, async (s) =>
    persist({
      ...s,
      audit: [log(decision, id), ...s.audit].slice(0, 100),
    }),
  );
}
export async function syncHubSpot(s: State) {
  await request("connectors/hubspot/sync", { method: "POST" });
  return run(s, s.report.days);
}

export async function appendSyntheticStream(
  s: State,
  wave: "backlog" | "recovery",
) {
  if (s.tenant !== "northstar")
    throw Error("Example streams belong to Northstar Commerce.");
  if (server) {
    await post("continuous/fixtures/" + wave, {});
    return run(s, s.report.days);
  }
  const name =
    wave === "backlog"
      ? "synthetic-change-stream.csv"
      : "synthetic-recovery-stream.csv";
  const source = await fetch("/" + name);
  if (!source.ok) throw Error("The example stream could not be loaded.");
  return changeWorkspace(s, async (s) => {
    const result = await compute(s.data, s.report.days, {
      name,
      text: await source.text(),
      synthetic: true,
    });
    return persist({
      ...s,
      ...result,
      audit: [
        log(
          "Synthetic stream ingested",
          name + " · " + result.added + " new events",
        ),
        ...s.audit,
      ].slice(0, 100),
    });
  });
}
