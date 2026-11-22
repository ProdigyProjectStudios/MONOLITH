import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  GitBranch,
  GitFork,
  Layers3,
  Network,
  Radio,
  ScanLine,
  Search,
  ShieldCheck,
  Target,
  Workflow,
} from "lucide-react";
import type { ContinuousView } from "../lib/continuousTypes";
import type { State } from "../lib/types";
import { useFrozenSources } from "../lib/frozenSources";
import { Evidence } from "./Detail";
import { amount, n, type Analysis, type Signal } from "./ContinuousPeriods";
import css from "./Continuous.module.css";

export const detectorLabels: Record<string, string> = {
  latency: "Latency",
  variant: "Process variant",
  drift: "Process drift",
  duplicate: "Duplicate work",
  handoff: "Handoff",
};
const detectorIcons = {
  latency: Clock3,
  variant: GitBranch,
  drift: Workflow,
  duplicate: Copy,
  handoff: GitFork,
};
export function Sources({
  ids,
  s,
  label = "Source evidence",
  snapshotId,
  studio,
}: {
  ids: string[];
  s: State;
  label?: string;
  snapshotId?: string;
  studio?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [limit, setLimit] = useState(8);
  const frozen = useFrozenSources(s, open ? snapshotId : undefined, studio);
  const data = frozen.workspace.data;
  const unique = useMemo(() => [...new Set(ids)], [ids]);
  const valid = useMemo(
    () =>
      open
        ? new Set([
            ...data.events.map((e) => e.id),
            ...data.docs.map((d) => d.id),
          ])
        : null,
    [data, open],
  );
  return (
    <details
      className={css.sources}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <BookOpen size={14} />
        <strong>{label}</strong>
        <span>{n(unique.length)}</span>
        <ChevronDown size={15} />
      </summary>
      {open && (
        <div>
          {frozen.loading ? (
            <p>Loading saved evidence…</p>
          ) : frozen.error ? (
            <p role="alert">{frozen.error}</p>
          ) : unique.length ? (
            unique.slice(0, limit).map((id) =>
              valid?.has(id) ? (
                <Evidence key={id} id={id} s={frozen.workspace} />
              ) : (
                <p className={css.muted} key={id}>
                  <code>{id}</code> · Unavailable in the current workspace
                </p>
              ),
            )
          ) : (
            <p className={css.muted}>No source references were recorded.</p>
          )}
          {unique.length > limit && (
            <button
              className={css.textButton}
              type="button"
              onClick={() => setLimit(limit + 12)}
            >
              Show more evidence
            </button>
          )}
        </div>
      )}
    </details>
  );
}
function SignalSize({ signal }: { signal: Signal }) {
  const metric = signal.metric;
  const direction =
    (metric.delta ?? 0) > 0
      ? ArrowUpRight
      : (metric.delta ?? 0) < 0
        ? ArrowDownRight
        : ArrowRight;
  const Icon = direction;
  return (
    <span className={css.change}>
      <Icon size={14} />
      {amount(metric.delta, metric.unit, true)}
    </span>
  );
}
function Detail({
  signal,
  s,
  analysis,
  run,
  snapshotId,
  onStudio,
  onMap,
}: {
  signal: Signal;
  s: State;
  analysis: Analysis;
  snapshotId: string;
  run?: ContinuousView["investigations"][number];
  onStudio: (id?: string) => void;
  onMap: (id?: string) => void;
}) {
  const [cohort, setCohort] = useState<"both" | "recent" | "previous">("both");
  const metric = signal.metric,
    opportunity = analysis.opportunities.find((o) => o.signal_id === signal.id);
  return (
    <section
      className={css.inspector}
      aria-label="Selected signal"
      tabIndex={-1}
    >
      <div className={css.inspectHead}>
        <span className={css.overline}>
          <ScanLine size={13} />
          Signal detail
        </span>
        <span className={css.confidence}>{signal.confidence} confidence</span>
      </div>
      <h3>{signal.title}</h3>
      <p>{signal.summary}</p>
      <div className={css.signalMetric}>
        <small>{metric.label}</small>
        <div>
          <strong>{amount(metric.recent, metric.unit)}</strong>
          <SignalSize signal={signal} />
        </div>
        <span>Previous window · {amount(metric.previous, metric.unit)}</span>
      </div>
      <div className={css.inspectorMeta}>
        <span>
          <Layers3 size={14} />
          {n(signal.support)} supporting cases
          {signal.support_period ? " · " + signal.support_period : ""}
        </span>
        <span>
          <Target size={14} />
          {n(signal.case_ids.length)} example cases
        </span>
      </div>
      {opportunity && (
        <div className={css.opportunity}>
          <span>
            <Workflow size={14} />
            Operational opportunity
          </span>
          <h4>{opportunity.title}</h4>
          <p>{opportunity.action}</p>
          {opportunity.human_control && (
            <p className={css.guard}>
              <ShieldCheck size={13} />
              {opportunity.human_control}
            </p>
          )}
        </div>
      )}
      {signal.evidence_by_window && (
        <div className={css.cohortPicker}>
          <label>
            Evidence window
            <select
              aria-label="Evidence window"
              value={cohort}
              onChange={(e) => setCohort(e.target.value as typeof cohort)}
            >
              <option value="both">Both windows</option>
              <option value="recent">Recent window</option>
              <option value="previous">Previous window</option>
            </select>
          </label>
          {signal.support_by_window && (
            <small>
              {n(signal.support_by_window.previous)} previous ·{" "}
              {n(signal.support_by_window.recent)} recent matching cases
            </small>
          )}
        </div>
      )}
      <Sources
        snapshotId={snapshotId}
        key={signal.id + cohort}
        s={s}
        ids={
          cohort === "both"
            ? signal.evidence
            : (signal.evidence_by_window?.[cohort] ?? [])
        }
      />
      <details className={css.details}>
        <summary>
          Detection basis <ChevronDown size={14} />
        </summary>
        <p>{signal.method}</p>
        {signal.caveat && <p>{signal.caveat}</p>}
      </details>
      <div className={css.actions}>
        {run && (
          <button
            className="btn primary"
            type="button"
            onClick={() => onStudio(run.id)}
          >
            <Workflow size={15} />
            Open investigation
          </button>
        )}
        <button type="button" className="btn" onClick={() => onMap(signal.id)}>
          <Network size={15} />
          Inspect twin
        </button>
      </div>
    </section>
  );
}
export function Signals({
  s,
  analysis,
  investigations,
  snapshotId,
  selected,
  onSelect,
  onStudio,
  onMap,
}: {
  s: State;
  analysis: Analysis;
  investigations: ContinuousView["investigations"];
  snapshotId: string;
  selected: string;
  onSelect: (id: string) => void;
  onStudio: (id?: string) => void;
  onMap: (id?: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const listView = useRef<HTMLDivElement>(null);
  const [inspectCount, setInspectCount] = useState(0);
  useEffect(() => {
    if (!inspectCount || !window.matchMedia("(max-width: 700px)").matches)
      return;
    const inspector = listView.current?.querySelector<HTMLElement>(
      'section[aria-label="Selected signal"]',
    );
    inspector?.focus({ preventScroll: true });
    inspector?.scrollIntoView({ block: "start" });
  }, [inspectCount]);
  const matches = analysis.signals.filter(
    (signal) => filter === "all" || signal.kind === filter,
  );
  const signal = matches.find((a) => a.id === selected) ?? matches[0];
  const activeRun =
    signal &&
    investigations.find(
      (r) => r.signal_id === signal.id && r.snapshot_id === snapshotId,
    );
  return (
    <div className={css.signalGrid} ref={listView}>
      <div className={css.signalBoard}>
        <header className={css.panelHead}>
          <div>
            <span className={css.overline}>
              <Radio size={13} />
              Change detection
            </span>
            <h2>Change signals</h2>
          </div>
          <label className={css.select}>
            <select
              aria-label="Filter detectors"
              value={filter}
              onChange={(e) => {
                const next = e.target.value;
                setFilter(next);
                // Keep the same observation when it also belongs to this filter.
                const first = analysis.signals.find(
                  (item) => next === "all" || item.kind === next,
                );
                if (
                  first &&
                  !analysis.signals.some(
                    (item) =>
                      item.id === selected &&
                      (next === "all" || item.kind === next),
                  )
                ) {
                  onSelect(first.id);
                }
              }}
            >
              <option value="all">All detectors</option>
              {Object.entries(detectorLabels).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className={css.signalList}>
          {matches.map((a) => {
            const Icon =
              detectorIcons[a.kind as keyof typeof detectorIcons] ?? ScanLine;
            return (
              <button
                key={a.id}
                aria-label={"Inspect signal " + a.title}
                aria-pressed={a.id === signal?.id}
                className={css.signalRow}
                type="button"
                onClick={() => {
                  onSelect(a.id);
                  setInspectCount((count) => count + 1);
                }}
              >
                <span className={css.detectorIcon} data-kind={a.kind}>
                  <Icon size={17} />
                </span>
                <span className={css.signalName}>
                  <small>{detectorLabels[a.kind] ?? a.kind}</small>
                  <strong>{a.title}</strong>
                  <span>
                    {n(a.support)} supporting cases · {n(a.evidence.length)}{" "}
                    references
                  </span>
                </span>
                <SignalSize signal={a} />
                <ChevronRight size={14} />
              </button>
            );
          })}
        </div>
        {!matches.length && (
          <div className={css.empty}>
            <Search size={20} />
            <h3>
              {analysis.signals.length
                ? "No matching signals"
                : "No qualifying changes"}
            </h3>
            <p>
              {analysis.signals.length
                ? "Select another detector to inspect its observations."
                : "The comparison found no changes that met the detector thresholds."}
            </p>
          </div>
        )}
        <div className={css.boardFoot}>
          <ShieldCheck size={14} />
          Minimum support · {n(analysis.min_support)}
        </div>
      </div>
      {signal ? (
        <Detail
          snapshotId={snapshotId}
          key={signal.id}
          signal={signal}
          analysis={analysis}
          s={s}
          run={activeRun}
          onStudio={onStudio}
          onMap={onMap}
        />
      ) : (
        <section className={css.inspector}>
          <span className={css.overline}>
            <ScanLine size={13} />
            Detector coverage
          </span>
          <h3>Observation criteria</h3>
          <p>{analysis.method}</p>
          {analysis.caveats.length > 0 && (
            <details className={css.details}>
              <summary>
                Method limitations <ChevronDown size={14} />
              </summary>
              {analysis.caveats.map((m, i) => (
                <p key={i}>{m}</p>
              ))}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
