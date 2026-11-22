"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  ChartNoAxesColumnIncreasing,
  CloudDownload,
  History,
  LoaderCircle,
  Network,
  Radio,
  RefreshCw,
  ScanLine,
  Workflow,
} from "lucide-react";
import type { ContinuousSnapshot } from "../lib/continuousTypes";
import type { useContinuous } from "../lib/useContinuous";
import type { State } from "../lib/types";
import { amount, date, n, Periods, type Analysis } from "./ContinuousPeriods";
import { Signals } from "./ContinuousSignals";
import ContinuousField from "./ContinuousField";
import { DecisionMemory, Investigations } from "./ContinuousTimeline";
import css from "./Continuous.module.css";

const tabs = [
  { id: "Signals", icon: Radio },
  { id: "Periods", icon: ChartNoAxesColumnIncreasing },
  { id: "Investigations", icon: Workflow },
  { id: "Decision memory", icon: BookMarked },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Props = {
  s: State;
  continuous: ReturnType<typeof useContinuous>;
  onOpenStudio: (id?: string) => void;
  selectedSignal?: string;
  selectedSnapshot?: string;
  onOpenMap: (signalId?: string, snapshotId?: string) => void;
};
function Volume({
  analysis,
  onPeriod,
}: {
  analysis: Analysis;
  onPeriod: (id: string) => void;
}) {
  const epochs = analysis.graph.epochs.slice(-24);
  const peak = Math.max(1, ...epochs.map((epoch) => epoch.events));
  return (
    <section className={css.volume} aria-label="Event volume by period">
      <header>
        <span>Event volume</span>
        <small>
          {epochs.length
            ? n(epochs.length) + " observed periods"
            : "Awaiting observations"}
        </small>
      </header>
      {epochs.length > 0 && (
        <>
          <div className={css.histogram}>
            {epochs.map((epoch) => {
              const label =
                date(epoch.start) + " · " + n(epoch.events) + " events";
              return (
                <button
                  key={epoch.id}
                  type="button"
                  aria-label={"Inspect period " + label}
                  title={label}
                  onClick={() => onPeriod(epoch.id)}
                >
                  <i style={{ height: (100 * epoch.events) / peak + "%" }} />
                </button>
              );
            })}
          </div>
          <div className={css.axis}>
            <span>{date(epochs[0].start)}</span>
            <span>{date(epochs[epochs.length - 1].end)}</span>
          </div>
        </>
      )}
    </section>
  );
}
const monitorLabels: Record<string, string> = {
  current: "Up to date",
  pending: "Changes queued",
  processing: "Processing changes",
  failed: "Refresh failed",
};
export default function Continuous({
  s,
  continuous,
  onOpenStudio,
  selectedSignal,
  selectedSnapshot,
  onOpenMap,
}: Props) {
  const {
    view,
    busy,
    error,
    refresh,
    loadSnapshot,
    resume,
    appendFixture,
    canAppendFixture,
  } = continuous;
  const fieldTarget = useRef<HTMLDivElement>(null);
  const [fieldSeek, setFieldSeek] = useState(0);
  const [epoch, setEpoch] = useState("");
  const periodsTarget = useRef<HTMLDivElement>(null);
  const [periodSeek, setPeriodSeek] = useState(0);
  useEffect(() => {
    if (periodSeek) {
      const control = periodsTarget.current?.querySelector<HTMLSelectElement>(
        'select[aria-label="Observed period"]',
      );
      control?.focus({ preventScroll: true });
      control?.scrollIntoView({ block: "center" });
    }
  }, [periodSeek]);
  useEffect(() => {
    if (fieldSeek) {
      const target = fieldTarget.current?.querySelector<HTMLElement>(
        'section[aria-label="Selected signal"]',
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
    }
  }, [fieldSeek]);
  const [tab, setTab] = useState<Tab>("Signals"),
    [signal, setSignal] = useState(selectedSignal || "");
  const [frozen, setFrozen] = useState<ContinuousSnapshot | null>(null),
    [loadingHistory, setLoadingHistory] = useState(false),
    [localError, setLocalError] = useState("");
  const request = useRef(0),
    latestId = view?.snapshot?.id;
  useEffect(() => {
    ++request.current;
    setFrozen(null);
    setLocalError("");
    setLoadingHistory(false);
  }, [s.tenant]);
  useEffect(() => {
    if (selectedSignal) {
      setSignal(selectedSignal);
      setTab("Signals");
    }
  }, [selectedSignal]);
  const snapshot = frozen ?? view?.snapshot,
    analysis = snapshot?.analysis;
  const lead =
    analysis?.signals.find((item) => item.id === signal) ??
    analysis?.signals.find((item) => item.kind === "latency") ??
    analysis?.signals[0];
  const metric = analysis?.as_of
    ? (lead?.metric ?? analysis.metrics.find((item) => item.id === "cases"))
    : undefined;
  const inspectSignal = (id: string) => {
    setSignal(id);
    setTab("Signals");
    setFieldSeek((seq) => seq + 1);
  };
  const historical = !!frozen && frozen.id !== latestId;
  const changeRevision = async (id: string) => {
    const seq = ++request.current;
    setLocalError("");
    if (id === latestId) {
      setFrozen(null);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    try {
      const snap = await loadSnapshot(id);
      if (request.current === seq) setFrozen(snap);
    } catch (err) {
      if (request.current === seq)
        setLocalError(
          err instanceof Error
            ? err.message
            : "Could not retrieve the saved revision.",
        );
    } finally {
      if (request.current === seq) setLoadingHistory(false);
    }
  };
  const changeRef = useRef(changeRevision);
  changeRef.current = changeRevision;
  useEffect(() => {
    if (selectedSnapshot) void changeRef.current(selectedSnapshot);
  }, [selectedSnapshot, s.tenant]);
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );
  // Uploaded copies of the published streams retain these event IDs after a rename.
  const backlog = s.data.events.some(
    (e) => e.synthetic && e.id === "EV-6e70154ef7e7d05d",
  );
  const recovery = s.data.events.some(
    (e) => e.synthetic && e.id === "EV-ba8a3f3d285647de",
  );
  const wave = backlog ? "recovery" : "backlog";
  const monitor = view?.monitor;
  const header = (
    <div className={css.toolbar}>
      <div className={css.status} role="status">
        <i data-status={monitor?.status} />
        {monitor
          ? (monitorLabels[monitor.status] ?? monitor.status)
          : "Loading monitor"}
      </div>
      <div>
        {canAppendFixture && !recovery && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void appendFixture(wave)}
          >
            <CloudDownload size={15} />
            {backlog
              ? "Load synthetic recovery stream"
              : "Load synthetic change stream"}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Refresh monitor"
          title="Refresh monitor"
        >
          <RefreshCw size={14} className={busy ? css.turn : ""} />
          <span className={css.refreshLabel}>Refresh monitor</span>
        </button>
      </div>
    </div>
  );
  return (
    <div
      className={css.workspace}
      aria-label="Continuous intelligence workspace"
    >
      {header}
      {(localError || error || monitor?.error) && (
        <p role="alert" className={css.alert}>
          {localError || error || monitor?.error}
        </p>
      )}
      {snapshot && analysis && view ? (
        <>
          <section className={css.hero} aria-label="Operational observation">
            <div className={css.heroLeft}>
              <div className={css.overline}>
                {historical ? "Archived revision" : "Revision"} {snapshot.revision}
                {analysis.as_of && <> · Through {date(analysis.as_of)} UTC</>}
              </div>
              <h2>Change monitor</h2>
              {metric && (
                <div className={css.leadMeasure}>
                  <h3>{lead?.title || metric.label}</h3>
                  <div className={css.measurePair}>
                    <span>
                      <small>Previous {analysis.window_days} days</small>
                      <strong>{amount(metric.previous, metric.unit)}</strong>
                    </span>
                    <span>
                      <small>Recent {analysis.window_days} days</small>
                      <strong>{amount(metric.recent, metric.unit)}</strong>
                    </span>
                  </div>
                  <div className={css.measureFoot}>
                    <span>
                      {lead ? metric.label : "Active cases"} ·{" "}
                      {amount(metric.delta, metric.unit, true)}
                    </span>
                    {lead && (
                      <button
                        className={css.textButton}
                        type="button"
                        onClick={() => inspectSignal(lead.id)}
                      >
                        Inspect change
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!metric && (
                <p>
                  A timestamped event stream is required to compare operations.
                </p>
              )}
              <Volume
                analysis={analysis}
                onPeriod={(id) => {
                  setEpoch(id);
                  setTab("Periods");
                  setPeriodSeek((seq) => seq + 1);
                }}
              />
            </div>
            <ContinuousField
              key={snapshot.id}
              s={s}
              snapshot={snapshot}
              runs={view.investigations}
              signalId={signal}
              inspect={inspectSignal}
            />
          </section>
          <div className={css.navigation}>
            <div
              className={css.tabs}
              role="group"
              aria-label="Continuous intelligence views"
            >
              {tabs.map(({ id, icon: Icon }) => (
                <button
                  type="button"
                  aria-pressed={tab === id}
                  key={id}
                  onClick={() => setTab(id)}
                >
                  <Icon size={15} />
                  {id}
                  <span className={css.tabCount} aria-hidden="true">
                    {id === "Signals"
                      ? analysis.signals.length
                      : id === "Periods"
                        ? analysis.graph.epochs.length
                        : id === "Investigations"
                          ? view.investigations.length
                          : view.decisions.length}
                  </span>
                </button>
              ))}
            </div>
            <button
              className={css.textButton}
              type="button"
              onClick={() => onOpenMap(undefined, snapshot.id)}
            >
              <Network size={15} />
              Open twin
            </button>
          </div>
          {historical && (
            <div className={css.historyBar}>
              <History size={14} />
              <span>
                Viewing revision {snapshot.revision} ·{" "}
                {date(snapshot.created_at, true)} UTC
              </span>
              <button
                className={css.textButton}
                onClick={() => void changeRevision(latestId || "")}
              >
                Return to latest
              </button>
            </div>
          )}
          {tab === "Signals" && (
            <div ref={fieldTarget}>
              <Signals
                key={snapshot.id + "-" + fieldSeek}
                s={s}
                analysis={analysis}
                investigations={view.investigations}
                snapshotId={snapshot.id}
                selected={lead?.id || ""}
                onSelect={setSignal}
                onStudio={onOpenStudio}
                onMap={(id) => onOpenMap(id, snapshot.id)}
              />
            </div>
          )}
          {tab === "Periods" && (
            <div ref={periodsTarget}>
              <Periods
                key={snapshot.id}
                epochId={epoch}
                setEpochId={setEpoch}
                analysis={analysis}
                snapshot={snapshot}
                history={view.history}
                onSnapshot={(id) => void changeRevision(id)}
                historyBusy={loadingHistory}
              />
            </div>
          )}
          {tab === "Investigations" && (
            <Investigations
              s={s}
              view={view}
              busy={busy}
              onResume={(id) => void resume(id)}
              onStudio={onOpenStudio}
              snapshotId={snapshot.id}
            />
          )}
          {tab === "Decision memory" && (
            <DecisionMemory view={view} s={s} onStudio={onOpenStudio} />
          )}
        </>
      ) : (
        <section className={css.panel}>
          <div className={css.empty}>
            {busy ? (
              <LoaderCircle size={21} className={css.turn} />
            ) : (
              <ScanLine size={21} />
            )}
            <h2>
              {busy ? "Reading the event stream" : "Awaiting an observation"}
            </h2>
            <p>
              {busy
                ? "The monitor is checking the latest workspace records."
                : "Refresh the monitor to save the first comparison of this workspace’s event stream."}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
