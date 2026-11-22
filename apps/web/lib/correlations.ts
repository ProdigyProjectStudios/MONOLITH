import { request } from "./client";
import type { State } from "./types";

export type Observation = {
  key: string;
  object_id: string;
  portal_id: string | null;
  source_id: string;
  event_id: string;
  case_id: string;
  stage: string;
  modified_at: string;
  case_property: string | null;
  case_reference: string | null;
};
export type Deal = Observation & {
  observations: number;
  record_url: string | null;
};
export type Correlation = {
  rule: string;
  basis: string;
  case_id: string;
  system: string;
  activity: string;
  evidence: string[];
};
export type LinkedProcess = {
  case_id: string;
  steps: string[];
  evidence: string[];
};
export type DealDetail = {
  history: Observation[];
  matches: Correlation[];
  hypotheses: Correlation[];
  processes: LinkedProcess[];
};
export const pageSize = 20;
export function loadDeals(
  query: string,
  offset: number,
  signal: AbortSignal,
): Promise<{ items: Deal[]; total: number }> {
  const params = new URLSearchParams({
    q: query,
    offset: String(offset),
    limit: String(pageSize),
  });
  return request("correlations/hubspot?" + params, {
    signal,
    cache: "no-store",
  });
}
export function loadDeal(
  key: string,
  signal: AbortSignal,
): Promise<DealDetail> {
  return request("correlations/hubspot/" + encodeURIComponent(key), {
    signal,
    cache: "no-store",
  });
}
export function linkedVariant(s: State, process: LinkedProcess): number {
  if (!s.report.case_ids.includes(process.case_id)) return -1;
  const rows = s.data.events.filter((e) => e.case === process.case_id);
  const ids = new Set(process.evidence);
  if (
    rows.length !== ids.size ||
    rows.some((e) => e.synthetic || !ids.has(e.id))
  )
    return -1;
  const signature = JSON.stringify(process.steps);
  return s.report.paths.findIndex((p) => JSON.stringify(p.steps) === signature);
}
