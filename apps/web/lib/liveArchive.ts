/** Read-only same-origin archive. Never uses workspace credentials, the API or IndexedDB. */
import type { InvestigationRun } from "./investigations";
import type { State } from "./types";

export const archiveIndexPath = "/replays/index.json";
const replayId = "northstar-refund-live";
const seedHash =
  "bd4da6173d4dc37007ac60e6ffd116d818536067d7769489e1a590d08417fc0c";
const maxArchiveBytes = 8 * 1024 * 1024;
const stages = [
  "discovery",
  "process",
  "strategy",
  "architect",
  "simulation",
  "verification",
];
const specialists = [
  "Discovery Agent",
  "Process Intelligence Agent",
  "Automation Strategy Agent",
  "Solutions Architect Agent",
  "Simulation Agent",
  "Verification Agent",
  "Reliability reviewer",
  "Operations reviewer",
];

type Json = Record<string, unknown>;
type Entry = { path: string; sha256: string; bytes: number };
export type ArchivedCapture = {
  fixture: boolean;
  capturedAt: string;
  sha256: string;
  snapshot: State;
  run: InvestigationRun;
  modelCalls: number;
  totalTokens: number;
  costUsd: number | null;
};
export const archiveTenant = "northstar";
const record = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === "string");
const objects = (v: unknown): v is Json[] =>
  Array.isArray(v) && v.every(record);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const amount = (v: unknown): v is number =>
  finite(v) && Number.isInteger(v) && v >= 0;
function requireCapture(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

export function parseArchiveIndex(index: unknown): Entry | null {
  requireCapture(
    record(index) &&
      index.schema === "monolith.replays.index.v1" &&
      objects(index.captures) &&
      index.captures.length <= 1,
    "The archive index has an unsupported format.",
  );
  if (!index.captures.length) return null;
  const { id, path, sha256, bytes } = index.captures[0];
  requireCapture(
    id === replayId &&
      typeof sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(sha256) &&
      typeof path === "string" &&
      path === "/replays/" + replayId + "-" + sha256 + ".json" &&
      amount(bytes) &&
      bytes > 0 &&
      bytes <= maxArchiveBytes,
    "The archive index contains an invalid capture reference.",
  );
  return { path, sha256, bytes };
}
async function readBounded(response: Response, limit: number) {
  requireCapture(
    response.ok,
    "The archive server could not return the recording.",
  );
  requireCapture(
    response.headers.get("content-type")?.split(";")[0].trim() ===
      "application/json",
    "The archive server returned an unexpected file type.",
  );
  requireCapture(
    Number(response.headers.get("content-length") || 0) <= limit,
    "The archive response exceeds its size limit.",
  );
  const reader = response.body?.getReader();
  requireCapture(reader, "The archive response is empty.");
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("The archive response exceeds its size limit.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
function decode(bytes: Uint8Array) {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error("The archive contains invalid JSON.");
  }
}
async function digest(data: Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (record(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortedKeys(v[k])]),
    );
  return v;
}
async function validateSnapshot(value: unknown) {
  requireCapture(
    record(value) && record(value.data) && record(value.report),
    "The archived snapshot is missing.",
  );
  const data = value.data;
  requireCapture(
    Object.keys(data).sort().join(",") === "docs,events,sources",
    "Unexpected archived data fields.",
  );
  const rows: Record<string, Json[]> = {};
  for (const key of ["docs", "events", "sources"]) {
    const source = data[key];
    requireCapture(
      objects(source) &&
        source.every(
          (row) => typeof row.id === "string" && row.synthetic === true,
        ),
      "The capture must contain the public synthetic Northstar seed.",
    );
    rows[key] = source
      .slice()
      .sort((a, b) =>
        String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0,
      );
  }
  const canonical = new TextEncoder().encode(JSON.stringify(sortedKeys(rows)));
  requireCapture(
    (await digest(canonical)) === seedHash,
    "The archived source records do not match the published Northstar seed.",
  );
  const ids = new Set(rows.events.map((r) => r.case));
  requireCapture(
    value.report.days === 30 &&
      strings(value.report.case_ids) &&
      value.report.case_ids.length === ids.size &&
      new Set(value.report.case_ids).size === ids.size &&
      value.report.case_ids.every((id) => ids.has(id)),
    "The archived case window does not match the Northstar fixture.",
  );
  // The snapshot's data bytes are pinned and verified. Construct a new isolated
  // workspace state, ignoring any credential or connection fields in the envelope.
  return {
    data,
    report: value.report,
    tenant: archiveTenant,
    ai: false,
    hubspot: false,
    audit: [],
  } as unknown as State;
}
function validateReferences(root: unknown, ids: Set<string>) {
  const keys = new Set([
    "evidence",
    "evidence_ids",
    "agent_evidence",
    "policy_evidence",
    "dispute_evidence",
  ]);
  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (!record(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      if (keys.has(name))
        requireCapture(
          strings(child) && child.every((id) => ids.has(id)),
          "A capture citation is missing from its archived source snapshot.",
        );
      else if (typeof child === "object" && child !== null) pending.push(child);
    }
  }
}
/** Reconcile the displayed interval with the pinned rows, independent of the report's text. */
function checkMeasuredInterval(snapshot: State, result: Json) {
  const last = new Map<string, State["data"]["events"][number]>(),
    intervals: number[] = [],
    cases = new Set<string>();
  const ordered = [...snapshot.data.events].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );
  for (const row of ordered) {
    const previous = last.get(row.case);
    if (
      previous?.activity.toLowerCase() === "invoice rekeyed" &&
      row.activity.toLowerCase() === "refund authorised"
    ) {
      intervals.push(
        (Date.parse(row.timestamp) - Date.parse(previous.timestamp)) /
          3_600_000,
      );
      cases.add(row.case);
    }
    last.set(row.case, row);
  }
  intervals.sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2
      ? intervals[middle]
      : (intervals[middle - 1] + intervals[middle]) / 2;
  const b = record(result.package) ? result.package.baseline : null;
  requireCapture(
    record(b) &&
      b.cases === cases.size &&
      b.intervals === intervals.length &&
      finite(b.median) &&
      Math.abs(median - b.median) < 0.011,
    "The archived refund baseline disagrees with its source events.",
  );
}
function validateBlueprint(result: Json, approval: string) {
  const v = record(result.stages) ? result.stages.verification : null;
  requireCapture(
    record(v) &&
      v.verdict === "accept" &&
      v.selected === result.selected &&
      strings(v.eligible_designs) &&
      v.eligible_designs.includes(approval) &&
      v.eligible_designs.includes(String(result.selected)) &&
      strings(v.rejected_designs) &&
      !v.rejected_designs.includes(approval) &&
      !v.rejected_designs.includes(String(result.selected)),
    "The archive has no eligible, approved design.",
  );
  const pkg = result.package;
  requireCapture(
    record(pkg) &&
      record(pkg.baseline) &&
      finite(pkg.baseline.median) &&
      finite(pkg.baseline.cases) &&
      finite(pkg.baseline.intervals) &&
      finite(pkg.baseline.p25) &&
      finite(pkg.baseline.p75) &&
      strings(pkg.evidence) &&
      strings(pkg.systems) &&
      objects(pkg.approaches) &&
      pkg.approaches.length >= 2 &&
      pkg.approaches.some((a) => a.id === approval),
    "The recorded design or measured baseline is incomplete.",
  );
  for (const a of pkg.approaches) {
    requireCapture(
      ["id", "name", "summary", "complexity", "risk"].every(
        (k) => typeof a[k] === "string",
      ) &&
        strings(a.dependencies) &&
        strings(a.nodes) &&
        strings(a.evidence) &&
        objects(a.artifacts) &&
        a.artifacts.length &&
        a.artifacts.every(
          (f) => typeof f.title === "string" && typeof f.body === "string",
        ),
      "An archived architecture artifact is incomplete.",
    );
  }
  requireCapture(
    objects(result.findings) &&
      result.findings.every(
        (f) =>
          typeof f.text === "string" &&
          typeof f.kind === "string" &&
          strings(f.evidence),
      ) &&
      record(result.trials) &&
      Object.keys(result.trials).length >= 2,
    "The archived findings or simulations are incomplete.",
  );
  for (const t of Object.values(result.trials)) {
    requireCapture(
      record(t) &&
        typeof t.approach === "string" &&
        finite(t.projected_median) &&
        finite(t.net_savings) &&
        t.currency === "GBP" &&
        record(t.sensitivity) &&
        finite(t.sensitivity.low) &&
        finite(t.sensitivity.high) &&
        record(t.assumptions) &&
        ["coverage", "failure", "reduction"].every((k) =>
          finite((t.assumptions as Json)[k]),
        ),
      "An archived simulation trial is incomplete.",
    );
  }
}
async function validateArchive(
  value: unknown,
  sha256: string,
): Promise<ArchivedCapture> {
  requireCapture(
    record(value) &&
      value.schema === "monolith.replay.v1" &&
      value.id === replayId &&
      record(value.provenance),
    "The capture schema is unsupported.",
  );
  const p = value.provenance;
  requireCapture(
    p.kind === "verified_live_capture" &&
      p.tenant === archiveTenant &&
      p.dataset === "Northstar Commerce" &&
      p.seed_sha256 === seedHash &&
      p.synthetic === true &&
      p.provider === "openai" &&
      p.transport === "responses" &&
      timestamp(p.captured_at),
    "The capture does not match this public Northstar archive.",
  );
  const r = value.run,
    audit = value.acceptance;
  requireCapture(
    record(r) &&
      r.mode === "live" &&
      r.status === "completed" &&
      typeof r.id === "string" &&
      /^[a-f0-9]{32}$/.test(r.id) &&
      timestamp(r.created) &&
      r.days === 30 &&
      record(r.approval) &&
      typeof r.approval.approach === "string" &&
      timestamp(r.approval.at) &&
      objects(r.events) &&
      record(r.result) &&
      r.result.verified === true &&
      typeof r.result.summary === "string" &&
      typeof r.result.selected === "string" &&
      strings(r.result.evidence) &&
      r.result.evidence.length > 0,
    "Only a completed, verified and human-approved recording can be replayed.",
  );
  requireCapture(
    record(audit) &&
      audit.acceptance === "live_provider_execution_verified" &&
      audit.run_id === r.id &&
      amount(audit.model_calls) &&
      record(audit.tokens) &&
      amount(audit.tokens.total_tokens) &&
      record(audit.verification) &&
      audit.verification.approved_by_human === true &&
      audit.verification.verdict === "accept" &&
      audit.verification.selected === r.result.selected,
    "The capture lacks a matching live execution attestation.",
  );
  const snapshot = await validateSnapshot(value.snapshot);
  const ids = new Set(
    [...snapshot.data.events, ...snapshot.data.docs].map((e) => e.id),
  );
  validateReferences(r, ids);
  validateBlueprint(r.result, r.approval.approach);
  checkMeasuredInterval(snapshot, r.result);
  const completed: string[] = [],
    aliases = new Set<string>(),
    agents = new Set<string>();
  let tokens = 0,
    terminal = 0,
    approved = 0;
  for (const [i, event] of r.events.entries()) {
    requireCapture(
      event.seq === i + 1 &&
        typeof event.stage === "string" &&
        typeof event.kind === "string" &&
        timestamp(event.at) &&
        record(event.payload),
      "The recorded event sequence has a gap or malformed entry.",
    );
    const payload = event.payload;
    if (event.kind === "stage_completed") {
      requireCapture(
        payload.mode === "live" &&
          strings(payload.evidence) &&
          payload.evidence.length &&
          typeof payload.summary === "string",
        "A recorded stage lacks source evidence.",
      );
      completed.push(event.stage);
    }
    if (event.kind === "model_call") {
      requireCapture(
        payload.mode === "live" &&
          payload.provider === "openai" &&
          payload.status === "completed" &&
          payload.transport === "responses" &&
          payload.provider_endpoint === "https://api.openai.com/v1/responses" &&
          (payload.request_id === null ||
            (typeof payload.request_id === "string" &&
              /^request-[a-f0-9]{24}$/.test(payload.request_id))) &&
          typeof payload.agent === "string" &&
          typeof payload.response_id === "string" &&
          /^response-[a-f0-9]{24}$/.test(payload.response_id) &&
          !aliases.has(payload.response_id) &&
          record(payload.usage) &&
          amount(payload.usage.input_tokens) &&
          amount(payload.usage.output_tokens) &&
          payload.usage.total_tokens ===
            payload.usage.input_tokens + payload.usage.output_tokens &&
          amount(payload.usage.total_tokens) &&
          payload.usage.total_tokens > 0,
        "The recording lacks sanitised OpenAI Responses receipts.",
      );
      aliases.add(payload.response_id);
      agents.add(payload.agent);
      tokens += payload.usage.total_tokens;
    }
    if (event.kind === "run_completed" && payload.verified === true)
      terminal = i + 1;
    if (
      event.kind === "blueprint_approved" &&
      payload.approach === r.approval.approach
    )
      approved = i + 1;
  }
  requireCapture(
    stages.every((stage) => {
      const stageMap = (r.result as Json).stages;
      const out = record(stageMap) ? stageMap[stage] : null;
      return (
        record(out) &&
        typeof out.summary === "string" &&
        strings(out.evidence) &&
        out.evidence.length > 0
      );
    }) &&
      completed.join(",") === stages.join(",") &&
      terminal > 0 &&
      approved === terminal + 1 &&
      approved === r.events.length &&
      aliases.size === audit.model_calls &&
      tokens === audit.tokens.total_tokens &&
      specialists.every((name) => agents.has(name)),
    "The saved receipts, specialist stages and approval do not reconcile.",
  );
  return {
    fixture: value.test_only === true,
    run: r as unknown as InvestigationRun,
    snapshot,
    capturedAt: p.captured_at,
    sha256,
    modelCalls: aliases.size,
    totalTokens: tokens,
    costUsd: finite(audit.estimated_cost_usd) ? audit.estimated_cost_usd : null,
  };
}
export async function loadLiveArchive(
  tenant: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ArchivedCapture | null> {
  requireCapture(
    tenant === archiveTenant,
    "This public archive belongs to the Northstar demo.",
  );
  const options: RequestInit = {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    mode: "same-origin",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  };
  const catalog = await fetcher(archiveIndexPath, options);
  if (catalog.status === 404) return null;
  const entry = parseArchiveIndex(
    decode(await readBounded(catalog, 16 * 1024)),
  );
  if (!entry) return null;
  const captured = await fetcher(entry.path, options);
  const bytes = await readBounded(captured, entry.bytes);
  requireCapture(
    bytes.length === entry.bytes && (await digest(bytes)) === entry.sha256,
    "The recording failed its integrity check.",
  );
  return validateArchive(decode(bytes), entry.sha256);
}
