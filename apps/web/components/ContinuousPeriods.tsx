import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  History,
  Layers3,
} from "lucide-react";
import type {
  ContinuousSnapshot,
  ContinuousView,
} from "../lib/continuousTypes";
import css from "./Continuous.module.css";

export type Analysis = ContinuousSnapshot["analysis"];
export type Signal = Analysis["signals"][number];
export type Metric = Analysis["metrics"][number];
export type Epoch = Analysis["graph"]["epochs"][number];

const counts = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
export function n(value: number) {
  return counts.format(value);
}
export function date(value: string | null | undefined, clock = false) {
  if (!value) return "Unavailable";
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(clock ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "UTC",
  }).format(instant);
}
export function amount(
  value: number | null | undefined,
  unit: string,
  signed = false,
) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "Unavailable";
  const prefix = signed && value > 0 ? "+" : "";
  const suffix =
    (
      {
        hours: " h",
        hour: " h",
        percent: signed ? " pp" : "%",
        "%": signed ? " pp" : "%",
        percentage_points: " pp",
        pp: " pp",
        count: "",
        cases: "",
        events: "",
      } as Record<string, string>
    )[unit] ?? (unit ? " " + unit : "");
  return prefix + n(value) + suffix;
}
function MetricRows({ metrics }: { metrics: Metric[] }) {
  return (
    <div className={css.tableWrap}>
      <table className={css.metrics}>
        <caption>Change between observation windows</caption>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Previous</th>
            <th scope="col">Recent</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id}>
              <th scope="row">{m.label}</th>
              <td>{amount(m.previous, m.unit)}</td>
              <td>{amount(m.recent, m.unit)}</td>
              <td>{amount(m.delta, m.unit, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Periods({
  analysis,
  snapshot,
  history,
  onSnapshot,
  historyBusy,
  epochId,
  setEpochId,
}: {
  epochId: string;
  setEpochId: (id: string) => void;
  analysis: Analysis;
  snapshot: ContinuousSnapshot;
  history: ContinuousView["history"];
  onSnapshot: (id: string) => void;
  historyBusy: boolean;
}) {
  const epochs = analysis.graph.epochs;
  const selected = epochs.find((e) => e.id === epochId) ?? epochs.at(-1);
  const windows = [analysis.windows.previous, analysis.windows.recent].filter(
    (w) => w?.start && w?.end,
  );
  return (
    <div className={css.sections}>
      <section className={css.panel}>
        <header className={css.panelHead}>
          <div>
            <span className={css.overline}>
              <Layers3 size={13} />
              Observation windows
            </span>
            <h2>Period comparison</h2>
          </div>
          <label className={css.select}>
            <History size={14} />
            <select
              aria-label="Observation revision"
              disabled={historyBusy}
              value={snapshot.id}
              onChange={(e) => onSnapshot(e.target.value)}
            >
              {!history.some((h) => h.id === snapshot.id) && (
                <option value={snapshot.id}>
                  Revision {snapshot.revision}
                </option>
              )}
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  Revision {h.revision} · {date(h.as_of || h.created_at)}
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className={css.periodPair}>
          {windows.map((w, i) => (
            <div key={w.id} className={css.period}>
              <span>
                <i data-tone={i ? "lime" : "slate"} />
                {i ? "Recent window" : "Previous window"}
              </span>
              <strong>
                {date(w.start)} <ArrowRight size={13} /> {date(w.end)}
              </strong>
              <small>
                {n(w.events)} events · {n(w.cases)} cases
              </small>
            </div>
          ))}
        </div>
        {windows.length === 0 ? (
          <p className={css.note}>
            Comparison windows appear after timestamped events are available.
          </p>
        ) : (
          <p className={css.note}>
            UTC intervals include the start and exclude the end. Both windows
            span {analysis.window_days} days.
          </p>
        )}
        {windows.length > 0 && !!analysis.metrics.length && (
          <MetricRows metrics={analysis.metrics} />
        )}
      </section>
      {epochs.length > 0 && (
        <section className={css.panel}>
          <header className={css.panelHead}>
            <div>
              <span className={css.overline}>
                <BarChart3 size={13} />
                Event history
              </span>
              <h2>Observed periods</h2>
            </div>
            <label className={css.select}>
              <select
                aria-label="Observed period"
                value={selected?.id}
                onChange={(e) => setEpochId(e.target.value)}
              >
                {epochs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {date(e.start)} · {n(e.events)} events
                  </option>
                ))}
              </select>
            </label>
          </header>
          {selected && (
            <div className={css.epochDetail}>
              <strong>
                {date(selected.start)} – {date(selected.end)}
              </strong>
              <span>{n(selected.events)} events</span>
              <span>{n(selected.cases)} cases</span>
              <span>{n(selected.node_ids.length)} entities</span>
              <span>{n(selected.edge_ids.length)} relationships</span>
            </div>
          )}
        </section>
      )}
      <details className={css.details}>
        <summary>
          Detection method <ChevronDown size={15} />
        </summary>
        <p>{analysis.method}</p>
        {analysis.caveats.map((c, i) => (
          <p key={i}>{c}</p>
        ))}
      </details>
    </div>
  );
}
