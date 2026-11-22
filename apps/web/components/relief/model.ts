import type { EventRow, Report } from "../../lib/types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_PEAKS = 6;

type Observation = {
  row: EventRow;
  time: number;
  previous?: EventRow;
  hours: number;
};
type Transition = { before: EventRow; after: EventRow; hours: number };

export type SystemMeasure = {
  name: string;
  count: number;
  rate: number;
  arrivals: number;
  departures: number;
  cases: number;
  wait: number;
  interval: { from: string; to: string; count: number } | null;
  witnesses: EventRow[];
};

export type FieldWindow = {
  id: string;
  start: number;
  end: number;
  count: number;
  systems: SystemMeasure[];
};

export type ReliefHistory = {
  report: FieldWindow;
  windows: FieldWindow[];
  peaks: string[];
  bars: number[];
  maxRate: number;
  maxWait: number;
};

type Accumulator = {
  count: number;
  arrivals: number;
  departures: number;
  cases: Set<string>;
  rows: EventRow[];
  pairs: Map<string, Transition[]>;
};
const round = (value: number) => Math.round(value * 100) / 100;

function measure(
  id: string,
  start: number,
  end: number,
  observations: Observation[],
  names: string[],
): FieldWindow {
  const systems = new Map<string, Accumulator>(
    names.map((name) => [
      name,
      {
        count: 0,
        arrivals: 0,
        departures: 0,
        cases: new Set(),
        rows: [],
        pairs: new Map(),
      },
    ]),
  );
  let count = 0;
  for (const { row, previous, hours, time } of observations) {
    if (time < start || time >= end) continue;
    const system = systems.get(row.system);
    if (!system) continue;
    count++;
    system.count++;
    system.cases.add(row.case);
    if (system.rows.length < 4) system.rows.push(row);
    if (!previous) continue;
    if (previous.system !== row.system) {
      system.arrivals++;
      const origin = systems.get(previous.system);
      if (origin) origin.departures++;
    }
    const key = JSON.stringify([previous.activity, row.activity]);
    let group = system.pairs.get(key);
    if (!group) system.pairs.set(key, (group = []));
    group.push({ before: previous, after: row, hours });
  }
  return {
    id,
    start,
    end,
    count,
    systems: names.map((name) => {
      const system = systems.get(name)!;
      let wait = 0;
      let interval: SystemMeasure["interval"] = null;
      let witnesses = system.rows;
      for (const group of system.pairs.values()) {
        group.sort((a, b) => a.hours - b.hours);
        const mid = Math.floor(group.length / 2);
        const median = round(
          (group[mid].hours + group[Math.floor((group.length - 1) / 2)].hours) /
            2,
        );
        if (
          interval &&
          (median < wait || (median === wait && group.length <= interval.count))
        )
          continue;
        wait = median;
        interval = {
          from: group[mid].before.activity,
          to: group[mid].after.activity,
          count: group.length,
        };
        const middle =
          group.length % 2 ? [group[mid]] : [group[mid - 1], group[mid]];
        witnesses = Array.from(
          new Map(
            middle.flatMap((sample) =>
              [sample.before, sample.after].map(
                (row) => [row.id, row] as const,
              ),
            ),
          ).values(),
        );
      }
      return {
        name,
        count: system.count,
        rate: system.count / Math.max(1, (end - start) / DAY),
        arrivals: system.arrivals,
        departures: system.departures,
        cases: system.cases.size,
        wait,
        interval,
        witnesses,
      };
    }),
  };
}

/**
 * The report selects whole cases by completion time. Its field uses the same
 * complete traces. Within those traces replay selects arrivals by event time;
 * an interval crossing its boundary belongs to the arriving observation.
 */
export function buildReliefHistory(
  report: Report,
  events: EventRow[],
): ReliefHistory {
  const allowed = new Set(report.case_ids);
  const groups = new Map<string, Observation[]>();
  for (const row of events) {
    if (!allowed.has(row.case)) continue;
    const time = Date.parse(row.timestamp);
    if (!Number.isFinite(time)) continue;
    let group = groups.get(row.case);
    if (!group) groups.set(row.case, (group = []));
    group.push({ row, time, hours: 0 });
  }
  const observations: Observation[] = [];
  const order = new Map<string, { sum: number; count: number }>();
  let first = Infinity,
    last = -Infinity;
  for (const group of groups.values()) {
    group.sort((a, b) => a.time - b.time || a.row.id.localeCompare(b.row.id));
    const seen = new Set<string>();
    for (const [index, observation] of group.entries()) {
      const { row, time } = observation;
      if (index) {
        observation.previous = group[index - 1].row;
        observation.hours = (time - group[index - 1].time) / HOUR;
      }
      observations.push(observation);
      first = Math.min(first, time);
      last = Math.max(last, time);
      if (seen.has(row.system)) continue;
      seen.add(row.system);
      const rank = order.get(row.system) ?? { sum: 0, count: 0 };
      rank.sum += index / Math.max(1, group.length - 1);
      rank.count++;
      order.set(row.system, rank);
    }
  }

  const names = report.systems.map((s) => s.name);
  const rank = (name: string) => {
    const value = order.get(name);
    return value ? value.sum / value.count : 1;
  };
  const totals = new Map(report.systems.map((s) => [s.name, s.count]));
  const peaks = [...names]
    .sort(
      (a, b) =>
        (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b),
    )
    .slice(0, MAX_PEAKS)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const hasRows = Number.isFinite(first);
  const start = hasRows ? Math.floor(first / DAY) * DAY : 0;
  const end = hasRows ? (Math.floor(last / DAY) + 1) * DAY : DAY;
  const all = measure("report", start, end, observations, names);
  const days = (end - start) / DAY;
  const steps = hasRows ? Math.min(31, days) : 0;
  const windows: FieldWindow[] = [];
  for (let i = 0; i < steps; i++) {
    const to = start + Math.ceil(((i + 1) * days) / steps) * DAY;
    windows.push(
      measure(
        new Date(to - DAY).toISOString().slice(0, 10),
        Math.max(start, to - 7 * DAY),
        to,
        observations,
        names,
      ),
    );
  }
  const bars = Array<number>(Math.min(144, Math.max(3, days * 6))).fill(0);
  for (const { time } of observations) {
    bars[
      Math.min(
        bars.length - 1,
        Math.floor(((time - start) / (end - start)) * bars.length),
      )
    ]++;
  }
  // Keep the same scales when moving through time, including quiet windows.
  let maxRate = 0,
    maxWait = 0;
  for (const system of all.systems) {
    maxRate = Math.max(maxRate, system.rate);
    maxWait = Math.max(maxWait, system.wait);
  }
  return { report: all, windows, peaks, bars, maxRate, maxWait };
}
