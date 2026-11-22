import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesColumn,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  type EventRow,
  type Page,
  type Rec,
  type Report,
  type Source,
} from "../lib/types";
import { number } from "./UI";
import { Register } from "./OpportunityRegister";
import styles from "./Overview.module.css";
import ReliefPlot from "./relief/ReliefPlot";
import ReliefEvidence from "./relief/ReliefEvidence";
import { buildReliefHistory, type ReliefHistory } from "./relief/model";
import type { ReliefMode } from "./relief/surface";

const date = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const emptyEvents: EventRow[] = [];
const emptySources: Source[] = [];

function FieldTimeline({
  history,
  epoch,
  setEpoch,
  paused,
}: {
  history: ReliefHistory;
  epoch: number;
  setEpoch: (n: number) => void;
  paused: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const last = history.windows.length - 1;
  useEffect(() => {
    if (!playing) return;
    const stop = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", stop);
    const timer = window.setTimeout(() => {
      if (epoch >= last) setPlaying(false);
      else setEpoch(epoch + 1);
    }, 1380);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [playing, epoch, last, setEpoch]);
  useEffect(() => {
    setPlaying(false);
  }, [history]);
  useEffect(() => {
    if (paused) setPlaying(false);
  }, [paused]);
  if (last < 0) return null;
  const value = epoch < 0 ? last : Math.min(epoch, last);
  const selected = history.windows[value];
  const scope = history.report;
  const max = Math.max(...history.bars, 1);
  const label =
    epoch < 0
      ? "Full report"
      : date.format(selected.start) + " – " + date.format(selected.end - 1);
  return (
    <div className={styles.timeline}>
      <button
        type="button"
        className={styles.play}
        aria-label={playing ? "Pause field history" : "Play field history"}
        disabled={last === 0}
        onClick={() => {
          if (playing) setPlaying(false);
          else {
            if (epoch < 0 || value === last) setEpoch(0);
            setPlaying(true);
          }
        }}
        title={playing ? "Pause field history" : "Play field history"}
      >
        {playing ? (
          <Pause size={20} fill="currentColor" />
        ) : (
          <Play size={20} fill="currentColor" />
        )}
      </button>
      <div className={styles.timeControl}>
        <div className={styles.timeMeta}>
          <span>
            Event volume{" "}
            {epoch >= 0 && (
              <>
                <i>/</i> <b>{label}</b>
              </>
            )}
          </span>
          <button
            type="button"
            aria-pressed={epoch < 0}
            aria-label="Full report"
            onClick={() => {
              setPlaying(false);
              setEpoch(-1);
            }}
          >
            Full report
          </button>
        </div>
        <div
          className={styles.track}
          data-full={epoch < 0}
          style={
            {
              "--cursor": (last ? (value / last) * 100 : 0) + "%",
            } as CSSProperties
          }
        >
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${history.bars.length * 6} 32`}
            preserveAspectRatio="none"
          >
            {history.bars.map((count, i) => {
              const h = (count / max) * 31;
              const time =
                scope.start +
                ((i + 0.5) / history.bars.length) * (scope.end - scope.start);
              const active =
                epoch >= 0
                  ? time >= selected.start && time < selected.end
                  : count === max;
              return (
                <rect
                  key={i}
                  x={i * 6 + 1.7}
                  y={32 - h}
                  width={1.4}
                  height={h}
                  className={active ? styles.activeBar : undefined}
                />
              );
            })}
          </svg>
          <input
            type="range"
            min={0}
            max={Math.max(0, last)}
            step={1}
            value={value}
            disabled={last === 0}
            aria-label="Operational field timeline"
            aria-valuetext={label}
            onChange={(event) => {
              setPlaying(false);
              setEpoch(Number(event.target.value));
            }}
            onPointerUp={(event) => {
              if (epoch < 0) setEpoch(Number(event.currentTarget.value));
            }}
            onKeyDown={(event) => {
              if (epoch < 0 && event.key === "End") setEpoch(last);
            }}
          />
        </div>
        <div className={styles.dates}>
          <span>{date.format(scope.start)}</span>
          <span>{date.format((scope.start + scope.end) / 2)}</span>
          <span>{date.format(scope.end - 1)}</span>
        </div>
      </div>
    </div>
  );
}

function signalTitle(record: Rec) {
  if (record.id === "refund") return "Refund approval delays";
  if (record.id === "entry") return "Duplicate data entry";
  if (record.id === "review") return "Dispute review boundary";
  return record.title;
}

export function Overview({
  r,
  events = emptyEvents,
  sources = emptySources,
  navigate,
  open,
  selectSystem,
  openStudio,
}: {
  r: Report;
  events?: EventRow[];
  sources?: Source[];
  navigate: (p: Page) => void;
  open: (r: Rec) => void;
  selectSystem: (s: string) => void;
  openStudio: () => void;
}) {
  const history = useMemo(() => buildReliefHistory(r, events), [r, events]);
  const [epoch, setEpoch] = useState(-1),
    [mode, setMode] = useState<ReliefMode>("flow");
  const [system, setSystem] = useState(""),
    [showKey, setShowKey] = useState(false);
  useEffect(() => {
    setEpoch(-1);
    setSystem("");
  }, [history]);
  const frame = history.windows[epoch] ?? history.report;
  const invoker = useRef<HTMLElement | null>(null);
  const inspectSystem = (name: string, button?: HTMLElement) => {
    invoker.current =
      button ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setSystem(name);
  };
  const closeEvidence = () => {
    const target = invoker.current;
    setSystem("");
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  };
  const currentSystem = frame.systems.find((s) => s.name === system);
  const primary =
    r.recommendations.find((rec) => rec.id === "refund") ??
    r.recommendations[0];
  const historical = frame !== history.report;
  const pressure = frame.systems.reduce<typeof currentSystem>(
    (best, s) => (s.interval && (!best || s.wait > best.wait) ? s : best),
    undefined,
  );
  const busiest = r.links.reduce<(typeof r.links)[number] | undefined>(
    (best, l) => (!best || l.count > best.count ? l : best),
    undefined,
  );
  const isRefund = primary?.id === "refund";
  const inspect = () => {
    if (historical && pressure) inspectSystem(pressure.name);
    else if (primary) open(primary);
  };
  const escalate = () => {
    if (!historical && isRefund) openStudio();
    else inspect();
  };
  const scope = historical ? frame : history.report;
  const shown = scope.systems.filter((s) => s.count > 0);
  const signal = historical
    ? pressure?.interval?.to
    : primary
      ? signalTitle(primary)
      : null;
  const subtitle =
    historical && pressure?.interval
      ? number(pressure.interval.count) + " observed transitions"
      : primary
        ? number(primary.cases) +
          (isRefund ? " refund cases" : " matched cases")
        : "";
  return (
    <>
      <div className={styles.overview}>
        <section aria-label="Operational map" className={styles.landscape}>
          {scope.count > 0 ? (
            <ReliefPlot
              history={history}
              frame={frame}
              mode={mode}
              inspect={inspectSystem}
            />
          ) : (
            <div className={styles.noField}>
              <ChartNoAxesColumn size={28} />
              <p>No events to map in this window.</p>
              <button onClick={() => navigate("Data sources")}>
                Open data sources
              </button>
            </div>
          )}
          <header className={styles.head}>
            <div>
              <h1 id="workspace-heading" tabIndex={-1}>
                Operational field
              </h1>
              <p>
                {number(shown.length)} systems
                <br />
                {number(scope.count)} observed events
              </p>
            </div>
            <div
              className={styles.switch}
              role="group"
              aria-label="Field encoding"
            >
              {(["flow", "volume"] as const).map((encoding) => (
                <button
                  key={encoding}
                  onClick={() => setMode(encoding)}
                  aria-label={encoding === "flow" ? "Flow" : "Volume"}
                  aria-pressed={mode === encoding}
                >
                  {encoding === "flow" ? "Flow" : "Volume"}
                </button>
              ))}
            </div>
          </header>
          <div className={styles.keyBox}>
            <button
              onClick={() => setShowKey(!showKey)}
              aria-expanded={showKey}
              aria-controls="read-relief"
              className={styles.key}
            >
              Field key
            </button>
            {showKey && (
              <section
                id="read-relief"
                role="region"
                aria-label="Field key"
                className={styles.keyPanel}
              >
                <strong>Reading the relief</strong>
                <p>
                  In Flow, higher ridges mark longer median waits and more
                  handoffs per event. Copper marks the system with the longest
                  measured median interval among the systems shown.
                </p>
                <p>
                  Volume shows events per day on a shared scale. Scrub the
                  timeline for up to seven days of arrivals. Intervals are
                  counted at the arriving event. Select a system to inspect its
                  source rows.
                </p>
                {history.peaks.length < frame.systems.length && (
                  <p>
                    The field shows the six busiest systems. Business Map
                    includes all {frame.systems.length}.
                  </p>
                )}
              </section>
            )}
          </div>
        </section>

        <section className={styles.signalBand} aria-label="Intelligence feed">
          {signal ? (
            <div className={styles.signal}>
              <div className={styles.signalName}>
                <span>
                  {historical ? "Selected interval" : "Selected signal"}
                </span>
                <button
                  aria-label={
                    !historical && isRefund
                      ? "Bottleneck Refund approval delays"
                      : "Inspect " + signal
                  }
                  onClick={inspect}
                >
                  {signal}
                </button>
              </div>
              <div className={styles.signalMeasure}>
                <strong>
                  {number(
                    historical && pressure ? pressure.wait : primary!.hours,
                  )}{" "}
                  h median
                </strong>
                <small>{subtitle}</small>
              </div>
              <button className={styles.action} onClick={escalate}>
                {!historical && isRefund
                  ? "Investigate delay"
                  : "Inspect evidence"}{" "}
                <ArrowRight size={23} strokeWidth={1.35} />
              </button>
            </div>
          ) : (
            <p className={styles.empty}>
              {historical
                ? "No measured transitions in this replay window."
                : "No evidence-supported opportunities in this reporting window."}
            </p>
          )}
          <FieldTimeline
            history={history}
            epoch={epoch}
            setEpoch={setEpoch}
            paused={Boolean(currentSystem) || showKey}
          />
        </section>
        <div className={styles.after}>
          <section aria-label="Operational metrics" className={styles.metrics}>
            {[
              [number(r.events), "Observed events"],
              [number(r.cases), "Linked cases"],
              [number(r.variants), "Process variants"],
              [r.cases ? number(r.cycle) + " h" : "—", "Median case duration"],
            ].map(([value, label]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <div className={styles.crossroads}>
            <div>
              <h2>System handoffs</h2>
              {busiest ? (
                <p>
                  {busiest.source} → {busiest.target} had the most traffic, with{" "}
                  {number(busiest.count)} observed handoffs.
                </p>
              ) : (
                <p>No cross-system handoffs in this report.</p>
              )}
              <button
                aria-label="Expand business map"
                onClick={() => navigate("Business map")}
              >
                Explore map <ArrowUpRight size={16} />
              </button>
            </div>
            <div>
              <h2>Analysis trace</h2>
              <p>Inspect the tools and evidence behind this report.</p>
              <button onClick={() => navigate("Agent activity")}>
                View analysis trace <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <Register recs={r.recommendations} open={open} />
        </div>
      </div>
      {currentSystem && (
        <ReliefEvidence
          system={currentSystem}
          frame={frame}
          sources={sources}
          close={closeEvidence}
          openMap={() => {
            setSystem("");
            selectSystem(currentSystem.name);
          }}
        />
      )}
    </>
  );
}
