"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
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
import { date, n, Periods, type Analysis } from "./ContinuousPeriods";
import { Signals } from "./ContinuousSignals";
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
  onPeriods,
}: {
  analysis: Analysis;
  onPeriods: () => void;
}) {
  const all = analysis.graph.epochs,
    epochs = all.slice(-24);
  const peak = Math.max(...epochs.map((e) => e.events), 1);
  return (
    <div className={css.volume}>
      <div>
        <span>
          <Activity size={15} />
          Event volume
        </span>
        <small>
          {epochs.length
            ? n(epochs.length) + " observed periods"
            : "No observed periods"}
        </small>
      </div>
      {epochs.length > 0 && (
        <>
          <button
            type="button"
            aria-label="Inspect observed periods"
            className={css.histogram}
            onClick={onPeriods}
          >
            {epochs.map((e) => (
              <span
                key={e.id}
                title={date(e.start) + " · " + n(e.events) + " events"}
              >
                <i style={{ height: (100 * e.events) / peak + "%" }} />
              </span>
            ))}
          </button>
          <div className={css.axis}>
            <span>{date(epochs[0].start)}</span>
            <span>{date(epochs[epochs.length - 1].end)}</span>
          </div>
        </>
      )}
    </div>
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
        >
          <RefreshCw size={14} className={busy ? css.turn : ""} />
          Refresh monitor
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
              <span className={css.overline}>
                <Radio size={14} />
                Operational observation
              </span>
              <h2>Change monitor</h2>
              <p>
                {analysis.as_of ? (
                  <>
                    Revision {snapshot.revision} includes events through{" "}
                    {date(analysis.as_of, true)} UTC.
                  </>
                ) : (
                  "A timestamped event stream is required to compare operations."
                )}
              </p>
              <div className={css.heroStats}>
                <div>
                  <small>Change signals</small>
                  <strong>{n(analysis.signals.length)}</strong>
                </div>
                <div>
                  <small>Saved investigations</small>
                  <strong>{n(view.investigations.length)}</strong>
                </div>
                <div>
                  <small>Saved decisions</small>
                  <strong>{n(view.decisions.length)}</strong>
                </div>
              </div>
            </div>
            <Volume analysis={analysis} onPeriods={() => setTab("Periods")} />
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
                </button>
              ))}
            </div>
            <button
              className={css.textButton}
              type="button"
              onClick={() => onOpenMap(undefined, snapshot.id)}
            >
              <Network size={15} />
              Open twin <ArrowRight size={13} />
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
            <Signals
              key={snapshot.id}
              s={s}
              analysis={analysis}
              investigations={view.investigations}
              snapshotId={snapshot.id}
              selected={signal}
              onSelect={setSignal}
              onStudio={onOpenStudio}
              onMap={(id) => onOpenMap(id, snapshot.id)}
            />
          )}
          {tab === "Periods" && (
            <Periods
              analysis={analysis}
              snapshot={snapshot}
              history={view.history}
              onSnapshot={(id) => void changeRevision(id)}
              historyBusy={loadingHistory}
            />
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
