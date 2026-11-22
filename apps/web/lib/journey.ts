import type { EventRow } from "./types";

export type ProcessCase = { id: string; rows: EventRow[] };

/** Keep complete case histories whose keys the report included in its event window. */
export function indexJourneys(events: EventRow[], caseIds: string[]) {
  const scope = new Set(caseIds);
  const byCase = new Map<string, EventRow[]>();
  for (const event of events) {
    if (!scope.has(event.case)) continue;
    const rows = byCase.get(event.case);
    if (rows) rows.push(event);
    else byCase.set(event.case, [event]);
  }
  const paths = new Map<string, ProcessCase[]>();
  for (const [id, rows] of byCase) {
    rows.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    );
    const key = JSON.stringify(rows.map((e) => e.activity));
    const entry = { id, rows };
    const cases = paths.get(key);
    if (cases) cases.push(entry);
    else paths.set(key, [entry]);
  }
  return paths;
}

export function intervalHours(rows: EventRow[], step: number) {
  if (!rows[step] || !rows[step - 1]) return null;
  const ms =
    Date.parse(rows[step].timestamp) - Date.parse(rows[step - 1].timestamp);
  return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : null;
}

export function journeyStages(steps: string[], cases: ProcessCase[]) {
  return steps.map((label, step) => {
    const systems = new Set(cases.map(({ rows }) => rows[step].system));
    const hours: number[] = [];
    if (step) {
      for (const { rows } of cases) {
        const value = intervalHours(rows, step);
        if (value !== null) hours.push(value);
      }
    }
    hours.sort((a, b) => a - b);
    const mid = Math.floor(hours.length / 2);
    const median = hours.length
      ? (hours[mid] + hours[Math.floor((hours.length - 1) / 2)]) / 2
      : null;
    return { label, system: [...systems].join(" · "), median };
  });
}
