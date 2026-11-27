"use client";
import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, Pause, Play } from "lucide-react";
import type { State, EventRow } from "../lib/types";
import type { InvestigationRun } from "../lib/investigations";
import { names } from "./observatoryMetrics";
import { investigationEngine } from "./studioReceipts";
import { Evidence } from "./Detail";
import HandoffBackdrop from "./HandoffBackdrop";
import ProcessRibbon from "./ProcessRibbon";
import skin from "./Overview.module.css";
import css from "./StudioInstruments.module.css";

type Band = {
  key: string;
  label: string;
  count: number;
  details: string;
  source?: EventRow;
};
const dateLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default function ObservatorySignal({
  s,
  run,
  onStage,
  onInvestigation,
}: {
  s: State;
  run: InvestigationRun | null;
  onStage: (id: string) => void;
  onInvestigation: () => void;
}) {
  const bands = useMemo<Band[]>(() => {
    if (run)
      return Object.entries(names).map(([key, label]) => {
        const events = run.events.filter((e) => e.stage === key);
        const tools = events.filter((e) => e.kind === "tool_result").length;
        const models = events.filter((e) => e.kind === "model_call").length;
        return {
          key,
          label,
          count: events.length,
          details: `${tools} tool results · ${models} model receipts`,
        };
      });
    const allowed = new Set(s.report.case_ids);
    const groups = new Map<
      string,
      { count: number; cases: Set<string>; source: EventRow }
    >();
    for (const e of s.data.events) {
      if (!allowed.has(e.case)) continue;
      const time = Date.parse(e.timestamp);
      if (!Number.isFinite(time)) continue;
      const day = new Date(time).toISOString().slice(0, 10);
      const group = groups.get(day) ?? {
        count: 0,
        cases: new Set<string>(),
        source: e,
      };
      group.count++;
      group.cases.add(e.case);
      if (time > Date.parse(group.source.timestamp)) group.source = e;
      groups.set(day, group);
    }
    return [...groups.keys()]
      .sort()
      .slice(-6)
      .map((key) => {
        const group = groups.get(key)!;
        return {
          key,
          label: dateLabel.format(new Date(key)),
          count: group.count,
          details: group.cases.size + " linked cases · UTC",
          source: group.source,
        };
      });
  }, [run, s.report.case_ids, s.data.events]);
  const stops = useMemo(
    () => bands.map((b) => ({ label: b.label, magnitude: b.count })),
    [bands],
  );
  const maximum = Math.max(0, ...bands.map((b) => b.count));
  const peak = maximum ? bands.findIndex((b) => b.count === maximum) : -1;
  const [picked, pick] = useState<string | null>(null),
    [paused, pause] = useState(false);
  const idx = bands.findIndex((b) => b.key === picked);
  const selected = idx < 0 ? Math.max(0, peak) : idx;
  const band = maximum > 0 ? bands[selected] : undefined;
  return (
    <section
      className={skin.field + " " + css.instrument}
      aria-label="Activity signal"
      data-paused={paused}
    >
      <div className={css.chamber}>
        <HandoffBackdrop warm={false} />
        <header className={css.signalHead}>
          <div>
            <small>
              <Activity size={14} />
              {run ? investigationEngine(run) : "Workspace evidence"}
            </small>
            <h3>{run ? "Specialist activity" : "Source activity"}</h3>
            <p>
              {run
                ? "Recorded events by specialist"
                : "Latest active dates in the selected case scope"}
            </p>
          </div>
          {band && (
            <button
              className={css.motion}
              aria-label={
                paused ? "Resume signal motion" : "Pause signal motion"
              }
              onClick={() => pause(!paused)}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
          )}
        </header>
        {band ? (
          <ProcessRibbon
            label="Activity by interval"
            stops={stops}
            selected={selected}
            start={0}
            maximum={maximum}
            peak={peak}
            select={(i) => pick(bands[i].key)}
            paused={paused}
          />
        ) : (
          <p className={css.unavailable}>
            {run
              ? "No specialist events recorded for this run yet."
              : "No source events in this case scope."}
          </p>
        )}
        {band && <div className={css.scaleKey}>Ribbon width · event count</div>}
      </div>
      {band && (
        <div className={css.selection}>
          <div>
            <small>{run ? "Selected specialist" : "Selected date"}</small>
            <strong>{band.label}</strong>
          </div>
          <div>
            <strong>
              {band.count.toLocaleString("en-GB")} {run ? "recorded" : "source"}{" "}
              events
            </strong>
            <span>{band.details}</span>
          </div>
          {run ? (
            <button
              className="btn"
              disabled={!band.count}
              onClick={() => onStage(band.key)}
            >
              Inspect stage trace <ArrowDownRight size={14} />
            </button>
          ) : (
            band.source && (
              <div className={css.source} key={band.key}>
                <small>Latest source row</small>
                <Evidence s={s} id={band.source.id} showTime />
              </div>
            )
          )}
        </div>
      )}
      {!run && (
        <footer className={css.foot}>
          <div>
            <h4>No investigation selected</h4>
            <span>
              Start a run to inspect specialist receipts and compare findings.
            </span>
          </div>
          <button className="btn primary" onClick={onInvestigation}>
            Open investigation <ArrowDownRight size={14} />
          </button>
        </footer>
      )}
    </section>
  );
}
