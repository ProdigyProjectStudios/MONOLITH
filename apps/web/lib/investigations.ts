import { post, request, response, server } from "./client";
import { runtimeTask } from "./runtime";
import type { RunEvaluation } from "../components/observatoryMetrics";
import type { Data, Report, State } from "./types";

export type RunEvent = {
  seq: number;
  kind: string;
  stage: string;
  payload: Record<string, unknown>;
  at: string;
};
export type Approach = {
  id: string;
  name: string;
  summary: string;
  complexity: string;
  risk: string;
  dependencies: string[];
  artifacts: { title: string; body: string }[];
  nodes: string[];
  evidence: string[];
  assumptions: Record<string, number | string>;
};
export type FlagshipPackage = {
  baseline: {
    cases: number;
    median: number | null;
    p25: number | null;
    p75: number | null;
    disputes: number;
    intervals: number;
    eligible: number;
    eligible_intervals: number;
    mean: number | null;
    authority_systems: string[];
    source_systems: string[];
    policy_evidence: string[];
    dispute_evidence: string[];
    evidence: string[];
    days: number;
    asof: string | null;
  };
  evidence: string[];
  systems: string[];
  approaches: Approach[];
  scenarios: RoutingScenario[];
  assumptions: Record<string, number | string>;
  limitations: string[];
};
export type RoutingScenario = {
  approach: string;
  assumptions: Record<string, number | string> & {
    coverage: number;
    failure: number;
    reduction: number;
  };
  baseline_median: number | null;
  projected_median: number | null;
  elapsed_hours_saved: number;
  baseline_staff_hours: number;
  staff_hours: number;
  baseline_staff_cost: number;
  staff_cost: number;
  operating_cost: number;
  net_savings: number;
  failure_cases: number;
  failure_attempts: number;
  attempts: number;
  eligible_cases: number;
  review_cases: number;
  approvals_retained: number;
  sensitivity: { low: number | null; high: number | null };
  currency: string;
  evidence: string[];
};
export type ObjectiveComparison = {
  kind: "deterministic_reference";
  common_preference: string[];
  evidence: string[];
  criteria: {
    id: string;
    label: string;
    measure: string;
    unit: string;
    values: Record<string, number>;
    preferred: string[];
    spread: number;
  }[];
};
export type InvestigationResult = {
  evaluation?: RunEvaluation;
  comparison?: ObjectiveComparison | null;
  summary: string;
  evidence: string[];
  verified: boolean;
  findings: { kind: string; text: string; evidence: string[] }[];
  selected: string;
  package: FlagshipPackage;
  stages: Record<
    string,
    { summary: string; evidence: string[]; checks?: Record<string, boolean> }
  >;
  trials: Record<string, RoutingScenario>;
};
export type InvestigationRun = {
  id: string;
  mode: "live" | "deterministic";
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  created: string;
  days: number;
  events: RunEvent[];
  result: InvestigationResult | null;
  error?: string;
  approval?: { approach: string; at: string };
  parent_id?: string;
  repeat_of?: string;
};
type Inputs = { data: Data; report: Report };
const active = (r: InvestigationRun) =>
  r.status === "running" || r.status === "queued";
const now = () => new Date().toISOString();
const input = (s: State): Inputs => ({ data: s.data, report: s.report });
const key = (s: State, id: string) => s.tenant + "/" + id;

export async function getPackage(s: State): Promise<FlagshipPackage> {
  return server
    ? post("flagship/package", { days: s.report.days })
    : runtimeTask("package", input(s));
}
export async function simulate(
  s: State,
  assumptions: Record<string, number | string>,
): Promise<RoutingScenario> {
  return server
    ? post("flagship/simulate", { days: s.report.days, assumptions })
    : runtimeTask("simulate", { ...input(s), assumptions });
}

let database: Promise<IDBDatabase> | undefined;
function openDb() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("monolith-investigations-v1", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("runs");
      req.result.createObjectStore("inputs");
    };
    req.onerror = () => {
      database = undefined;
      reject(req.error);
    };
    req.onsuccess = () => resolve(req.result);
  }));
}
async function read<T>(table: string, id: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const op = db.transaction(table).objectStore(table).get(id);
    op.onsuccess = () => resolve(op.result);
    op.onerror = () => reject(op.error);
  });
}
const localBus =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("monolith-run-changes")
    : null;
const localChanges = new EventTarget();
function publish(id: string) {
  localChanges.dispatchEvent(new CustomEvent("changed", { detail: id }));
  localBus?.postMessage(id);
}
async function createLocal(
  s: State,
  snapshot: Inputs,
  parent_id?: string,
  repeat_of?: string,
) {
  const db = await openDb();
  const r: InvestigationRun = {
    id: crypto.randomUUID(),
    mode: "deterministic",
    created: now(),
    status: "queued",
    days: snapshot.report.days,
    events: [],
    result: null,
    parent_id,
    repeat_of,
  };
  const k = key(s, r.id);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["runs", "inputs"], "readwrite");
    tx.objectStore("runs").add(r, k);
    tx.objectStore("inputs").add(snapshot, k);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  return r;
}
async function updateLocal(
  s: State,
  id: string,
  modify: (r: InvestigationRun) => InvestigationRun,
): Promise<InvestigationRun> {
  const db = await openDb(),
    k = key(s, id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("runs", "readwrite"),
      table = tx.objectStore("runs"),
      req = table.get(k);
    let next: InvestigationRun;
    req.onsuccess = () => {
      try {
        if (!req.result) throw Error("Investigation not found.");
        next = modify(req.result);
        table.put(next, k);
      } catch (e) {
        reject(e);
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      publish(k);
      resolve(next);
    };
    tx.onabort = () => reject(tx.error || Error("Investigation write failed."));
  });
}
function append(
  r: InvestigationRun,
  kind: string,
  stage: string,
  payload: Record<string, unknown>,
) {
  return {
    ...r,
    events: [
      ...r.events,
      { kind, stage, payload, seq: (r.events.at(-1)?.seq || 0) + 1, at: now() },
    ],
  };
}
const executing = new Set<string>();
function executeLocal(s: State, id: string) {
  const k = key(s, id);
  if (executing.has(k)) return;
  executing.add(k);
  const work = async () => {
    const r = await read<InvestigationRun>("runs", k);
    if (!r || !active(r)) return;
    if (r.status === "running") {
      const error =
        "The browser closed during the run. Resume from its saved inputs.";
      await updateLocal(s, id, (v) => ({
        ...append(v, "run_interrupted", "run", { error }),
        status: "interrupted",
        error,
      }));
      return;
    }
    await updateLocal(s, id, (v) => ({
      ...append(v, "run_started", "run", { mode: v.mode }),
      status: "running",
    }));
    const snapshot = await read<Inputs>("inputs", k);
    if (!snapshot) throw Error("This run’s saved inputs are unavailable.");
    let writes = Promise.resolve();
    try {
      const result = await runtimeTask<InvestigationResult>(
        "investigate",
        snapshot,
        (e) => {
          writes = writes.then(async () => {
            await updateLocal(s, id, (v) =>
              append(v, e.kind, e.stage, e.payload),
            );
          });
        },
      );
      await writes;
      await updateLocal(s, id, (v) => ({
        ...append(v, "run_completed", "run", { verified: result.verified }),
        status: "completed",
        result,
      }));
    } catch (e) {
      await writes.catch(() => {});
      throw e;
    }
  };
  // A lock is held for the entire worker execution. Another tab may subscribe to the same run.
  const job = navigator.locks
    ? navigator.locks.request("monolith/" + k, { ifAvailable: true }, (lock) =>
        lock ? work() : undefined,
      )
    : work();
  void job
    .catch(async (e) => {
      const error = e instanceof Error ? e.message : "Investigation failed.";
      await updateLocal(s, id, (r) => ({
        ...append(r, "run_failed", "run", { error }),
        status: "failed",
        error,
      }));
    })
    .finally(() => executing.delete(k));
}
export async function listRuns(s: State): Promise<InvestigationRun[]> {
  if (server) return (await request("investigations")).runs;
  const db = await openDb(),
    prefix = s.tenant + "/";
  return new Promise((resolve, reject) => {
    const op = db
      .transaction("runs")
      .objectStore("runs")
      .getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    op.onsuccess = () =>
      resolve(
        (op.result as InvestigationRun[]).sort((a, b) =>
          b.created.localeCompare(a.created),
        ),
      );
    op.onerror = () => reject(op.error);
  });
}
export async function getRun(s: State, id: string): Promise<InvestigationRun> {
  if (server) return request("investigations/" + encodeURIComponent(id));
  const r = await read<InvestigationRun>("runs", key(s, id));
  if (!r) throw Error("Investigation not found.");
  return r;
}
export async function getSnapshot(s: State, id: string): Promise<State> {
  const saved: Inputs | undefined = server
    ? await request("investigations/" + encodeURIComponent(id) + "/snapshot")
    : await read("inputs", key(s, id));
  if (!saved) throw Error("The investigation snapshot is unavailable.");
  return { ...s, ...saved };
}
async function withRegistryLock<T>(s: State, fn: () => Promise<T>) {
  return navigator.locks
    ? navigator.locks.request("monolith/registry/" + s.tenant, fn)
    : fn();
}
export async function startRun(
  s: State,
  mode: "live" | "deterministic" = s.ai ? "live" : "deterministic",
): Promise<InvestigationRun> {
  if (server)
    return post("investigations", {
      days: s.report.days,
      mode,
      request_id: crypto.randomUUID(),
    });
  const run = await withRegistryLock(s, async () => {
    const existing = (await listRuns(s)).find(
      (r) => active(r) && !r.repeat_of && r.days === s.report.days,
    );
    return existing || createLocal(s, input(s));
  });
  executeLocal(s, run.id);
  return run;
}
export async function getRunEvaluation(
  s: State,
  id: string,
): Promise<RunEvaluation> {
  if (server)
    return request("investigations/" + encodeURIComponent(id) + "/evaluation");
  const run = await getRun(s, id);
  if (run.status !== "completed" || !run.result)
    throw Error("Evaluation requires a completed investigation.");
  if (run.result.evaluation) return run.result.evaluation;
  const saved = await read<Inputs>("inputs", key(s, id));
  if (!saved) throw Error("Saved inputs are unavailable.");
  return runtimeTask("evaluate", { ...saved, result: run.result });
}
export async function repeatRun(
  s: State,
  id: string,
): Promise<InvestigationRun> {
  if (server)
    return post("investigations/" + encodeURIComponent(id) + "/repeat", {
      request_id: crypto.randomUUID(),
    });
  const child = await withRegistryLock(s, async () => {
    const source = await getRun(s, id);
    if (source.status !== "completed")
      throw Error("Repeat requires a completed investigation.");
    const existing = (await listRuns(s)).find(
      (r) => r.repeat_of === id && active(r),
    );
    if (existing) return existing;
    const saved = await read<Inputs>("inputs", key(s, id));
    if (!saved) throw Error("Saved inputs are unavailable.");
    return createLocal(s, saved, undefined, id);
  });
  executeLocal(s, child.id);
  return child;
}
export async function resumeRun(
  s: State,
  id: string,
): Promise<InvestigationRun> {
  if (server)
    return post("investigations/" + encodeURIComponent(id) + "/resume", {});
  const child = await withRegistryLock(s, async () => {
    const parent = await getRun(s, id);
    if (parent.status !== "interrupted" && parent.status !== "failed")
      throw Error("Only interrupted or failed runs can resume.");
    const prior = (await listRuns(s)).find((r) => r.parent_id === id);
    if (prior) return prior;
    const saved = await read<Inputs>("inputs", key(s, id));
    if (!saved) throw Error("Saved inputs are unavailable.");
    return createLocal(s, saved, id);
  });
  executeLocal(s, child.id);
  return child;
}
export async function approveApproach(
  s: State,
  id: string,
  approach: string,
): Promise<InvestigationRun> {
  if (server)
    return post("investigations/" + encodeURIComponent(id) + "/approve", {
      approach,
    });
  return updateLocal(s, id, (r) => {
    if (
      r.status !== "completed" ||
      !r.result?.verified ||
      !r.result.package.approaches.some((a) => a.id === approach)
    )
      throw Error("Approval requires a verified proposal.");
    if (r.approval) {
      if (r.approval.approach === approach) return r;
      throw Error("This run already has an approved blueprint.");
    }
    if (r.result.evaluation?.status === "fail")
      throw Error(
        "An independent evidence check failed. Review the evaluation before approval.",
      );
    return {
      ...append(r, "blueprint_approved", "architect", { approach }),
      approval: { approach, at: now() },
    };
  });
}
async function readStream(
  s: State,
  r: InvestigationRun,
  update: (r: InvestigationRun) => void,
  signal: AbortSignal,
) {
  const cursor = r.events.at(-1)?.seq || 0;
  const res = await response(
    "investigations/" + encodeURIComponent(r.id) + "/events?after=" + cursor,
    { signal, headers: { Accept: "text/event-stream" } },
  );
  if (!res.body) throw Error("Investigation stream unavailable.");
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        const json = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!json) continue;
        const e = JSON.parse(json) as RunEvent;
        if (!Number.isInteger(e.seq) || e.seq <= (r.events.at(-1)?.seq || 0))
          continue;
        r = { ...r, status: "running", events: [...r.events, e] };
        update(r);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!signal.aborted) {
    const full = await getRun(s, r.id);
    update(full);
    return full;
  }
}
export async function watchRun(
  s: State,
  id: string,
  update: (r: InvestigationRun) => void,
  signal: AbortSignal,
) {
  let r = await getRun(s, id);
  if (signal.aborted) return;
  update(r);
  if (!active(r)) return;
  if (!server) {
    executeLocal(s, id);
    await new Promise<void>((resolve, reject) => {
      let reading = false,
        again = false;
      const cleanup = () => {
        clearInterval(timer);
        localChanges.removeEventListener("changed", changed);
        localBus?.removeEventListener("message", remote);
        signal.removeEventListener("abort", stop);
      };
      const stop = () => {
        cleanup();
        resolve();
      };
      const refresh = async () => {
        if (reading) {
          again = true;
          return;
        }
        reading = true;
        try {
          do {
            again = false;
            const next = await getRun(s, id);
            if (signal.aborted) return;
            update(next);
            if (!active(next)) {
              stop();
              break;
            }
          } while (again);
        } catch (e) {
          cleanup();
          reject(e);
        } finally {
          reading = false;
        }
      };
      const changed = (e: Event) => {
        if ((e as CustomEvent).detail === key(s, id)) void refresh();
      };
      const remote = (e: MessageEvent) => {
        if (e.data === key(s, id)) void refresh();
      };
      const timer = setInterval(refresh, 1500);
      localChanges.addEventListener("changed", changed);
      localBus?.addEventListener("message", remote);
      signal.addEventListener("abort", stop, { once: true });
      void refresh();
    });
    return;
  }
  let failures = 0;
  while (!signal.aborted && active(r)) {
    try {
      if (failures) {
        r = await getRun(s, id);
        if (signal.aborted) return;
        update(r);
        if (!active(r)) return;
      }
      const next = await readStream(s, r, update, signal);
      if (!next) return;
      r = next;
      failures = 0;
    } catch (e) {
      if (signal.aborted) return;
      if (++failures > 5) throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, 400 * 2 ** failures)),
      );
    }
  }
}
