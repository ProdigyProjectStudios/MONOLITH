import type { EventRow, Report, Source } from "../../lib/types";

/** One observed record cited as evidence, resolved to its source. */
export type EvidenceRecord = {
  id: string;
  case: string;
  activity: string;
  system: string;
  timestamp: string;
  source: string;
  row: number | string;
};

export type SystemEvidence = {
  name: string;
  count: number;
  cases: number;
  share: number;
  activities: { name: string; count: number }[];
  inbound: { system: string; count: number }[];
  outbound: { system: string; count: number }[];
  pressure: boolean;
  samples: EvidenceRecord[];
};

export type HandoffEvidence = {
  id: string;
  source: string;
  target: string;
  /** Count reported by the analysis (authoritative). */
  count: number;
  cases: number;
  medianHours: number | null;
  share: number;
  pressure: boolean;
  samples: { case: string; from: EvidenceRecord; to: EvidenceRecord }[];
};

export type FieldEvidence = {
  systems: Map<string, SystemEvidence>;
  handoffs: Map<string, HandoffEvidence>;
  pressure: Set<string>;
  bottleneck?: Report["bottlenecks"][number];
};

export const linkId = (source: string, target: string) =>
  JSON.stringify([source, target]);

const order = (a: EventRow, b: EventRow) =>
  a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);

function record(row: EventRow, sources: Map<string, string>): EvidenceRecord {
  return {
    id: row.id,
    case: row.case,
    activity: row.activity,
    system: row.system,
    timestamp: row.timestamp,
    source: sources.get(row.source) || row.source,
    row: row.row,
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Systems touched by the records an analysis cites. */
export function systemsForEvidence(ids: string[], events: EventRow[]) {
  const wanted = new Set(ids);
  const systems = new Set<string>();
  if (!wanted.size) return systems;
  for (const row of events) if (wanted.has(row.id)) systems.add(row.system);
  return systems;
}

/**
 * Resolves every system and directed handoff in the report back to the
 * event records behind it. Handoffs are consecutive events in the same case
 * whose recording system changes, matching how the analysis counts links.
 */
export function buildFieldEvidence(
  report: Report,
  events: EventRow[],
  sourceList: Source[],
): FieldEvidence {
  const sources = new Map(sourceList.map((s) => [s.id, s.name]));
  const allowed = report.case_ids?.length ? new Set(report.case_ids) : null;
  const cases = new Map<string, EventRow[]>();
  for (const row of events) {
    if (allowed && !allowed.has(row.case)) continue;
    const list = cases.get(row.case);
    if (list) list.push(row);
    else cases.set(row.case, [row]);
  }

  const pressure = systemsForEvidence(report.bottlenecks[0]?.evidence || [], events);
  const totalEvents = report.systems.reduce((sum, s) => sum + s.count, 0) || 1;
  const totalHandoffs = report.links.reduce((sum, l) => sum + l.count, 0) || 1;

  const systemCases = new Map<string, Set<string>>();
  const activities = new Map<string, Map<string, number>>();
  const samples = new Map<string, EvidenceRecord[]>();
  const pairs = new Map<
    string,
    { hours: number[]; cases: Set<string>; samples: HandoffEvidence["samples"] }
  >();

  for (const [id, rows] of cases) {
    rows.sort(order);
    rows.forEach((row, i) => {
      let set = systemCases.get(row.system);
      if (!set) systemCases.set(row.system, (set = new Set()));
      set.add(id);
      let acts = activities.get(row.system);
      if (!acts) activities.set(row.system, (acts = new Map()));
      acts.set(row.activity, (acts.get(row.activity) || 0) + 1);
      const list = samples.get(row.system) || [];
      if (list.length < 4) {
        list.push(record(row, sources));
        samples.set(row.system, list);
      }
      const prev = rows[i - 1];
      if (!prev || prev.system === row.system) return;
      const key = linkId(prev.system, row.system);
      let pair = pairs.get(key);
      if (!pair) pairs.set(key, (pair = { hours: [], cases: new Set(), samples: [] }));
      const gap = (Date.parse(row.timestamp) - Date.parse(prev.timestamp)) / 3_600_000;
      if (Number.isFinite(gap) && gap >= 0) pair.hours.push(gap);
      pair.cases.add(id);
      if (pair.samples.length < 3)
        pair.samples.push({ case: id, from: record(prev, sources), to: record(row, sources) });
    });
  }

  const systems = new Map<string, SystemEvidence>();
  for (const sys of report.systems) {
    systems.set(sys.name, {
      name: sys.name,
      count: sys.count,
      cases: systemCases.get(sys.name)?.size || 0,
      share: sys.count / totalEvents,
      activities: Array.from(activities.get(sys.name) || [])
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
      inbound: report.links
        .filter((l) => l.target === sys.name)
        .map((l) => ({ system: l.source, count: l.count }))
        .sort((a, b) => b.count - a.count),
      outbound: report.links
        .filter((l) => l.source === sys.name)
        .map((l) => ({ system: l.target, count: l.count }))
        .sort((a, b) => b.count - a.count),
      pressure: pressure.has(sys.name),
      samples: samples.get(sys.name) || [],
    });
  }

  const handoffs = new Map<string, HandoffEvidence>();
  for (const link of report.links) {
    const id = linkId(link.source, link.target);
    const pair = pairs.get(id);
    handoffs.set(id, {
      id,
      source: link.source,
      target: link.target,
      count: link.count,
      cases: pair?.cases.size || 0,
      medianHours: pair ? median(pair.hours) : null,
      share: link.count / totalHandoffs,
      pressure: pressure.has(link.target),
      samples: pair?.samples || [],
    });
  }

  return { systems, handoffs, pressure, bottleneck: report.bottlenecks[0] };
}
