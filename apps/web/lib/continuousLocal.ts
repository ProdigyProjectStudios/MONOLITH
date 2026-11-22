import { getSnapshot, listRuns } from "./investigations";
import { runtimeTask } from "./runtime";
import type { Data, State } from "./types";
import type {
  ContinuousView,
  ContinuousSnapshot,
  ContinuousSignal,
  StreamAnalysis,
  ContinuousDecision,
  ContinuousStage,
  ContinuousRun,
  Reassessment,
} from "./continuousTypes";

type FrozenSignal = ContinuousSignal &
  Pick<StreamAnalysis, "as_of" | "windows">;
type Frozen = {
  data: Data;
  signals: FrozenSignal[];
  memory: ContinuousDecision[];
};
type Entry = {
  head?: string;
  history: ContinuousView["history"];
  signatures: Record<string, string>;
  runs: ContinuousRun[];
  decisions: ContinuousDecision[];
  reviews: Reassessment[];
};
const empty = (): Entry => ({
  history: [],
  signatures: {},
  runs: [],
  decisions: [],
  reviews: [],
});
const stores = ["ledger", "snapshot", "inputs"] as const;
type Store = (typeof stores)[number];
type Write = [Store, string, unknown];
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("monolith-continuous-memory-v1", 1);
    req.onupgradeneeded = () =>
      stores.forEach((name) => req.result.createObjectStore(name));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      connection = undefined;
      reject(req.error);
    };
  }));
}
async function read<T>(name: Store, key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction(name).objectStore(name).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function save(writes: Write[]) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [...new Set(writes.map((w) => w[0]))],
      "readwrite",
    );
    for (const [name, key, value] of writes)
      tx.objectStore(name).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
const key = (tenant: string, id: string) => JSON.stringify([tenant, id]);
export async function localSnapshot(tenant: string, id: string) {
  const snapshot = await read<ContinuousSnapshot>("snapshot", key(tenant, id));
  if (!snapshot)
    throw Error("The requested observation is unavailable in this workspace.");
  return snapshot;
}
export async function localInputs(tenant: string, id: string) {
  const frozen = await read<Frozen>("inputs", key(tenant, id));
  if (!frozen) throw Error("The original revision is unavailable.");
  return frozen.data;
}
function viewOf(
  ledger: Entry,
  snapshot: ContinuousSnapshot | null,
): ContinuousView {
  const pending = ledger.runs.filter(
    (r) => r.status === "queued" || r.status === "running",
  ).length;
  const failed = ledger.runs.find((r) => r.status === "failed");
  const revision = snapshot?.revision ?? 0;
  return {
    monitor: {
      status: pending ? "processing" : failed ? "failed" : "current",
      revision,
      processed_revision: revision,
      pending,
      updated_at: ledger.runs[0]?.updated_at ?? snapshot?.created_at ?? null,
      error: failed?.error ?? null,
    },
    snapshot,
    signals: snapshot?.analysis.signals ?? [],
    history: ledger.history,
    investigations: ledger.runs,
    decisions: ledger.decisions,
    reassessments: ledger.reviews,
  };
}
export async function localView(tenant: string) {
  const ledger = (await read<Entry>("ledger", tenant)) ?? empty();
  return viewOf(
    ledger,
    ledger.head ? await localSnapshot(tenant, ledger.head) : null,
  );
}
function canonicalData(data: Data) {
  const ordered = (rows: { id: string }[]) =>
    [...rows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
      );
  return JSON.stringify([
    ordered(data.events),
    ordered(data.sources),
    ordered(data.docs),
  ]);
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function syncLocal(
  s: State,
  publish: (v: ContinuousView) => void,
  resumeId?: string,
) {
  const tenant = s.tenant;
  await navigator.locks.request("monolith/continuous/" + tenant, async () => {
    const ledger = (await read<Entry>("ledger", tenant)) ?? empty();
    const ledgerWrite = (): Write => ["ledger", tenant, ledger];
    const inputHash = await digest(canonicalData(s.data));
    let snapshot = ledger.head
      ? await localSnapshot(tenant, ledger.head)
      : null;
    const emit = () =>
      publish({
        ...viewOf(ledger, snapshot),
        investigations: ledger.runs.map((r) => ({
          ...r,
          checkpoints: [...r.checkpoints],
        })),
        history: [...ledger.history],
        reassessments: [...ledger.reviews],
      });
    async function settle() {
      for (const run of [...ledger.runs].reverse()) {
        if (
          run.status === "completed" ||
          (run.status === "failed" && resumeId !== run.id)
        )
          continue;
        try {
          const inputs = await read<Frozen>(
            "inputs",
            key(tenant, run.snapshot_id),
          );
          const signal = inputs?.signals.find((v) => v.id === run.signal_id);
          if (!inputs || !signal)
            throw Error("The original investigation inputs are unavailable.");
          run.status = "running";
          run.error = null;
          while (run.checkpoints.length < 6) {
            const stage = await runtimeTask<ContinuousStage>(
              "continuousStage",
              {
                data: inputs.data,
                signal,
                memory: inputs.memory,
                checkpoints: run.checkpoints,
              },
            );
            run.checkpoints.push(stage);
            run.updated_at = new Date().toISOString();
            await save([ledgerWrite()]);
            emit();
          }
          run.result = await runtimeTask<ContinuousRun["result"]>(
            "continuousFinish",
            { signal, checkpoints: run.checkpoints },
          );
          run.status = "completed";
          run.updated_at = new Date().toISOString();
          const decision = await runtimeTask<ContinuousDecision | null>(
            "continuousNormalize",
            { run: { ...run, finished_at: run.updated_at }, signal },
          );
          if (decision)
            ledger.decisions = [
              decision,
              ...ledger.decisions.filter((d) => d.id !== decision.id),
            ];
        } catch (e) {
          run.status = "failed";
          run.result = null;
          run.error =
            e instanceof Error
              ? e.message
              : "The deterministic specialist stopped.";
        }
        await save([ledgerWrite()]);
        emit();
      }
    }
    await settle();
    const legacy = await listRuns(s);
    for (const run of legacy.filter(
      (r) => r.status === "completed" && r.result,
    )) {
      const prior = ledger.decisions.find((d) => d.run_id === run.id);
      if (prior && prior.approval?.at === run.approval?.at) continue;
      const original = await getSnapshot(s, run.id);
      const decision = await runtimeTask<ContinuousDecision | null>(
        "continuousNormalize",
        { run: { ...run, as_of: original.report.asof } },
      );
      if (decision)
        ledger.decisions = [
          decision,
          ...ledger.decisions.filter((d) => d.id !== decision.id),
        ];
    }
    const snapshotId = "snapshot-" + inputHash;
    if (!ledger.history.some((h) => h.id === snapshotId)) {
      const analysis = await runtimeTask<StreamAnalysis>("continuousAnalysis", {
        data: s.data,
        memory: ledger.decisions,
      });
      const revision = (snapshot?.revision ?? 0) + 1,
        now = new Date().toISOString();
      snapshot = { id: snapshotId, revision, created_at: now, analysis };
      const signals = analysis.signals.map((signal) => ({
        ...signal,
        windows: analysis.windows,
        as_of: analysis.as_of,
      }));
      const frozen: Frozen = {
        data: s.data,
        signals,
        memory: [...ledger.decisions],
      };
      const observations = await runtimeTask<Reassessment[]>(
        "continuousReviews",
        { data: s.data, memory: frozen.memory, signals },
      );
      const knownReviews = new Set(ledger.reviews.map((r) => r.id));
      ledger.reviews.unshift(
        ...observations
          .filter((r) => !knownReviews.has(r.id))
          .map((r) => ({ ...r, snapshot_id: snapshotId })),
      );
      const jobs: ContinuousRun[] = [];
      for (const signal of signals) {
        const signature = JSON.stringify([
          signal.metric,
          [...signal.evidence].sort(),
          [...signal.case_ids].sort(),
        ]);
        if (signature !== ledger.signatures[signal.id])
          jobs.push({
            id: "monitor-" + revision + "-" + signal.id,
            snapshot_id: snapshotId,
            signal_id: signal.id,
            created_at: now,
            updated_at: now,
            mode: "deterministic",
            status: "queued",
            checkpoints: [],
            result: null,
            error: null,
          });
        ledger.signatures[signal.id] = signature;
      }
      ledger.runs.unshift(...jobs);
      ledger.history.unshift({
        id: snapshotId,
        revision,
        created_at: now,
        as_of: analysis.as_of,
        events: s.data.events.length,
        signals: signals.length,
      });
      ledger.head = snapshotId;
      await save([
        ledgerWrite(),
        ["snapshot", key(tenant, snapshotId), snapshot],
        ["inputs", key(tenant, snapshotId), frozen],
      ]);
    } else await save([ledgerWrite()]);
    emit();
    await settle();
  });
}
