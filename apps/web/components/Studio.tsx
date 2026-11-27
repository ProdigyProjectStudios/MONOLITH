"use client";
import { can } from "../lib/client";

import {
  Activity,
  BookOpenCheck,
  Check,
  ChevronDown,
  ArrowDownRight,
  CircleAlert,
  CircuitBoard,
  CornerDownRight,
  FileCheck2,
  FlaskConical,
  GitBranch,
  GitFork,
  Layers3,
  LoaderCircle,
  Pause,
  Play,
  Radio,
  Radar,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Workflow,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { InvestigationRun, RunEvent } from "../lib/investigations";
import type { EventRow, State } from "../lib/types";
import { Evidence } from "./Detail";
import {
  ArchitectureReview,
  ProviderInspector,
  RunMeasurements,
} from "./StudioTelemetry";
import {
  approvedDesigns,
  investigationEngine,
  duration,
  elapsed,
  modelCalls,
} from "./studioReceipts";
import OperatingTradeoffs from "./OperatingTradeoffs";
import Observatory from "./Observatory";
import ArchitectureExplorer from "./ArchitectureExplorer";
import observatoryStyles from "./Observatory.module.css";
import styles from "./Studio.module.css";
import InvestigationField from "./InvestigationField";
import overview from "./Overview.module.css";
import bench from "./StudioBench.module.css";
import { TracePlot } from "./StudioTrace";

type Props = {
  s: State;
  snapshot?: State;
  run: InvestigationRun | null;
  runs: InvestigationRun[];
  busy: boolean;
  onStart: () => void;
  onDeterministic: () => void;
  onRepeat?: () => void;
  onSelectRun: (id: string) => void;
  onResume: () => void;
  onApprove: (approach: string) => void;
  onBlueprint: () => void;
};

const stages = [
  {
    id: "discovery",
    title: "Discovery",
    icon: Radar,
    color: "#8edcc1",
    remit:
      "Trace source systems and retrieve the records that establish the scope of the refund workflow.",
  },
  {
    id: "process",
    title: "Process intelligence",
    icon: GitFork,
    color: "#9ecdf6",
    remit:
      "Mine the observed transitions and measure how long refund authorisation takes across linked cases.",
  },
  {
    id: "strategy",
    title: "Automation strategy",
    icon: SlidersHorizontal,
    color: "#c1b3f1",
    remit:
      "Assess routing opportunities and identify the decisions that require human authority.",
  },
  {
    id: "architect",
    title: "Solutions architect",
    icon: CircuitBoard,
    color: "#e5bc91",
    remit:
      "Design competing routing approaches with explicit contracts, dependencies and failure handling.",
  },
  {
    id: "simulation",
    title: "Simulation",
    icon: FlaskConical,
    color: "#a5d4e6",
    remit:
      "Compare projected outcomes using measured intervals and adjustable operational assumptions.",
  },
  {
    id: "verification",
    title: "Verification",
    icon: ShieldCheck,
    color: "#c2e39b",
    remit:
      "Challenge the evidence, test the proposed decision boundary and decide whether a blueprint can advance.",
  },
] as const;
type Stage = (typeof stages)[number];
type StageId = Stage["id"];
type Phase = "Planned" | "In progress" | "Complete" | "Interrupted" | "Failed";

function shortTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("en-GB", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());
}

function recordIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

type RefundInterval = { hours: number; from: EventRow; to: EventRow };

function observedWaits(events: EventRow[], scopedCases: string[]) {
  const scope = new Set(scopedCases);
  const groups = new Map<string, EventRow[]>();
  for (const event of events) {
    if (!scope.has(event.case)) continue;
    if (!groups.has(event.case)) groups.set(event.case, []);
    groups.get(event.case)!.push(event);
  }
  const waits: RefundInterval[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    );
    group.forEach((row, i) => {
      if (
        i &&
        group[i - 1].activity.toLowerCase() === "invoice rekeyed" &&
        row.activity.toLowerCase() === "refund authorised"
      ) {
        const from = group[i - 1];
        const hours =
          (Date.parse(row.timestamp) - Date.parse(from.timestamp)) / 3_600_000;
        if (Number.isFinite(hours) && hours >= 0)
          waits.push({ hours, from, to: row });
      }
    });
  }
  return waits.sort((a, b) => a.hours - b.hours);
}

function WaitDistribution({
  intervals,
  s,
}: {
  intervals: RefundInterval[];
  s: State;
}) {
  const values = useMemo(
    () => intervals.map((pair) => pair.hours),
    [intervals],
  );
  const gradient = useId().replace(/:/g, "");
  const [selection, setSelection] = useState<number | null>(null);
  const density = useMemo(() => {
    if (!values.length) return null;
    const low = values[0],
      high = values[values.length - 1];
    const step = (high - low) / 24 || 1;
    const bins = Array<number>(24).fill(0);
    for (const v of values) bins[Math.min(23, Math.floor((v - low) / step))]++;
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    const maximum = Math.max(...bins);
    const ridge = (scale: number) => {
      const y = (i: number) => 46 - (bins[i] / maximum) * 36 * scale;
      let p = "M6.25," + y(0);
      for (let i = 1; i < bins.length; i++) {
        const x = i * 12.5;
        p +=
          " C" +
          x +
          "," +
          y(i - 1) +
          " " +
          x +
          "," +
          y(i) +
          " " +
          (x + 6.25) +
          "," +
          y(i);
      }
      return p;
    };
    return {
      low,
      high,
      step,
      bins,
      median,
      medianBin: Math.min(23, Math.floor((median - low) / step)),
      maximum,
      ridges: [ridge(1), ridge(0.76), ridge(0.51), ridge(0.26)],
    };
  }, [values]);
  if (!density)
    return (
      <div className={styles.chartEmpty}>
        No matching refund transitions in this window.
      </div>
    );
  const { low, high, step, bins, median, medianBin, maximum, ridges } = density;
  const bucket = high === low ? 0 : (selection ?? medianBin),
    marker = bucket * 12.5 + 6.25;
  const range =
    high === low
      ? low.toFixed(1) + " h"
      : (low + bucket * step).toFixed(1) +
        "–" +
        Math.min(high, low + (bucket + 1) * step).toFixed(1) +
        " h";
  return (
    <figure className={styles.distribution}>
      <figcaption>
        <span>
          <Activity size={13} />
          Observed refund interval
        </span>
        <small>hours</small>
      </figcaption>
      <div className={styles.chartValue}>
        <strong>
          {median.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
          <small>h</small>
        </strong>
        <span>median</span>
      </div>
      <svg
        viewBox="0 0 300 48"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Frequency distribution of ${values.length} observed refund transitions from ${low.toFixed(1)} to ${high.toFixed(1)} hours`}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse") {
            const b = e.currentTarget.getBoundingClientRect();
            setSelection(
              high === low
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      23,
                      Math.floor(((e.clientX - b.left) / b.width) * 24),
                    ),
                  ),
            );
          }
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#f1cc8f" />
            <stop offset="1" stopColor="#835e46" />
          </linearGradient>
        </defs>
        {[14, 30, 46].map((y) => (
          <line
            key={y}
            x1="0"
            x2="300"
            y1={y}
            y2={y}
            stroke="#67805a"
            strokeOpacity=".24"
            strokeDasharray="2 5"
          />
        ))}
        <path
          d={ridges[0] + " L293.75,46 L6.25,46 Z"}
          fill={`url(#${gradient})`}
          opacity=".20"
        />
        {ridges.map((ridge, i) => (
          <path
            key={i}
            d={ridge}
            fill="none"
            stroke={i ? "#d9a277" : "#f0c68d"}
            strokeWidth={i ? 1 : 1.65}
            opacity={i ? 0.38 : 0.95}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {bins.map((n, i) => (
          <rect
            key={i}
            x={i * 12.5 + 0.5}
            y={46 - (n / maximum) * 35}
            width="9"
            height={(n / maximum) * 35}
            rx="1.2"
            fill={`url(#${gradient})`}
            opacity={i === bucket ? 0.35 : 0.07}
          >
            <title>{`${(low + i * step).toFixed(1)}–${(low + (i + 1) * step).toFixed(1)}h · ${n} transitions`}</title>
          </rect>
        ))}
        <line
          x1={marker}
          x2={marker}
          y1="1"
          y2="47"
          stroke="#ffdc98"
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        <circle
          cx={marker}
          cy={46 - (bins[bucket] / maximum) * 36}
          r="2.5"
          fill="#ffe0aa"
        />
      </svg>
      <div className={styles.binControl}>
        <input
          type="range"
          aria-label="Inspect refund interval bucket"
          aria-valuetext={range + " · " + bins[bucket] + " transitions"}
          min={0}
          max={high === low ? 0 : 23}
          value={bucket}
          onChange={(e) => setSelection(+e.target.value)}
        />
        <span>
          {range} · {bins[bucket]} transitions
        </span>
      </div>
      <div className={styles.axis}>
        <span>{low.toFixed(1)}h</span>
        <span>{values.length} transitions</span>
        <span>{high.toFixed(1)}h</span>
      </div>
      <details className={bench.sourcePairs}>
        <summary>
          Inspect source events <span>{bins[bucket]}</span>
        </summary>
        {bins[bucket] === 0 ? (
          <p>No transitions in this interval.</p>
        ) : (
          intervals
            .filter(
              (pair) =>
                Math.min(23, Math.floor((pair.hours - low) / step)) === bucket,
            )
            .map((pair) => (
              <details key={pair.to.id}>
                <summary>
                  {pair.to.case} <span>{pair.hours.toFixed(2)} h</span>
                </summary>
                <Evidence s={s} id={pair.from.id} showTime />
                <Evidence s={s} id={pair.to.id} showTime />
              </details>
            ))
        )}
      </details>
    </figure>
  );
}

function stagePhase(
  stage: StageId,
  events: RunEvent[],
  runStatus?: string,
): Phase {
  const entries = events.filter((event) => event.stage === stage);
  if (entries.some((e) => e.kind === "stage_completed")) return "Complete";
  if (entries.some((e) => e.kind === "stage_failed" || e.kind === "run_failed"))
    return "Failed";
  if (
    !entries.some((e) => e.kind === "stage_started" || e.kind === "tool_result")
  )
    return "Planned";
  if (runStatus === "failed") return "Failed";
  if (runStatus === "interrupted") return "Interrupted";
  return "In progress";
}

function eventTitle(event: RunEvent) {
  if (["tool_started", "tool_result", "tool_error"].includes(event.kind)) {
    const name = String(event.payload.name || "Tool").replaceAll("_", " ");
    return (
      name +
      " · " +
      (event.kind === "tool_started"
        ? "started"
        : event.kind === "tool_error"
          ? "failed"
          : "result")
    );
  }
  if (event.kind === "model_call" || event.kind === "model_call_started") {
    const model = String(event.payload.model || "Provider");
    return (
      model +
      " · " +
      (event.kind === "model_call_started"
        ? "request"
        : event.payload.status === "failed"
          ? "failed"
          : "response")
    );
  }
  if (event.kind === "architecture_assessment")
    return label(String(event.payload.reviewer || "Architecture")) + " review";
  if (event.kind === "architecture_debate")
    return event.payload.disagreement
      ? "Design preferences diverged"
      : "Architecture reviews compared";
  if (event.kind === "handoff") {
    const target = String(event.payload.to ?? event.payload.target ?? "");
    return target
      ? `Handoff to ${stages.find((s) => s.id === target)?.title || target}`
      : "Stage handoff";
  }
  const prefix = stages.find((s) => s.id === event.stage)?.title;
  if (prefix && event.kind === "stage_started") return prefix + " started";
  if (prefix && event.kind === "stage_completed") return prefix + " complete";
  return label(event.kind);
}

function SourceList({ ids, s }: { ids: string[]; s: State }) {
  const [expanded, setExpanded] = useState(false);
  const unique = [...new Set(ids)];
  const visible = expanded ? unique : unique.slice(0, 3);
  if (!unique.length) return null;
  return (
    <div className={styles.sources}>
      {visible.map((id) => (
        <Evidence id={id} key={id} s={s} />
      ))}
      {unique.length > 3 && (
        <button
          type="button"
          className={styles.link}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? "Show fewer records"
            : `Show all ${unique.length} records`}
        </button>
      )}
    </div>
  );
}

function RecordedEvent({ event, s }: { event: RunEvent; s: State }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={styles.logRow}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <code>{String(event.seq).padStart(3, "0")}</code>
        <CornerDownRight size={13} />
        <span>{eventTitle(event)}</span>
        <time>{shortTime(event.at)} UTC</time>
        <ChevronDown size={12} />
      </summary>
      {open && (
        <div>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          <SourceList ids={recordIds(event.payload.evidence)} s={s} />
        </div>
      )}
    </details>
  );
}

function ToolReceipt({
  event,
  start,
  s,
}: {
  event: RunEvent;
  start?: RunEvent;
  s: State;
}) {
  const ms = elapsed(start?.at, event.at);
  const [open, setOpen] = useState(false);
  return (
    <details
      className={styles.tool}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <SquareTerminal size={14} />
        <span>{String(event.payload.name || "Tool result")}</span>
        <ChevronDown size={12} />
      </summary>
      {open && (
        <div>
          <small>
            {shortTime(event.at)} UTC
            {ms !== null ? " · " + duration(ms) + " recorded" : ""}
          </small>
          {typeof event.payload.agent === "string" && (
            <p className={styles.receiptAgent}>
              {event.payload.agent} · call {String(event.payload.call ?? "—")}
            </p>
          )}
          <h4>Input</h4>
          <pre>{JSON.stringify(event.payload.input ?? {}, null, 2)}</pre>
          <h4>Output</h4>
          <pre>{JSON.stringify(event.payload.result ?? {}, null, 2)}</pre>
          <SourceList ids={recordIds(event.payload.evidence)} s={s} />
        </div>
      )}
    </details>
  );
}
function Inspector({
  stage,
  events,
  s,
  phase,
  live,
}: {
  live: boolean;
  stage: Stage;
  events: RunEvent[];
  s: State;
  phase: Phase;
}) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<"Tools" | "Models" | "Evidence">("Tools");
  const relevant = events.filter((e) => e.stage === stage.id);
  const tools = relevant.filter((e) => e.kind === "tool_result");
  const info = modelCalls(relevant);
  const identity = (e: RunEvent) =>
    [e.payload.agent, e.payload.reviewer, e.payload.call, e.payload.name].join(
      "/",
    );
  const starts = new Map(
    relevant
      .filter((e) => e.kind === "tool_started")
      .map((e) => [identity(e), e]),
  );
  const pending = relevant.filter(
    (e) =>
      e.kind === "tool_started" &&
      !relevant.some(
        (later) =>
          ["tool_error", "tool_result"].includes(later.kind) &&
          later.seq > e.seq &&
          identity(later) === identity(e),
      ),
  );
  const failed = relevant.filter((e) => e.kind === "tool_error");
  const completed = relevant.findLast((e) => e.kind === "stage_completed");
  const evidence = [
    ...new Set(relevant.flatMap((e) => recordIds(e.payload.evidence))),
  ];
  return (
    <aside
      id="studio-specialist-inspector"
      tabIndex={-1}
      className={styles.inspector}
      aria-label="Specialist inspector"
      style={{ "--role": stage.color } as CSSProperties}
    >
      <div className={styles.kicker}>
        <ScanLine size={13} />
        Stage inspector
      </div>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        className={styles.inspectTitle}
      >
        <span
          style={{ "--role": stage.color } as CSSProperties}
          className={styles.roleIcon}
        >
          <stage.icon size={18} />
        </span>
        <div>
          <h3>{stage.title}</h3>
          <small>{phase}</small>
        </div>
      </motion.div>
      <p className={styles.remit}>
        {completed?.payload.summary
          ? String(completed.payload.summary)
          : stage.remit}
      </p>
      <div className={styles.tabs} role="group" aria-label="Inspector detail">
        {(live
          ? (["Tools", "Models", "Evidence"] as const)
          : (["Tools", "Evidence"] as const)
        ).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}{" "}
            <span>
              {t === "Tools"
                ? tools.length
                : t === "Models"
                  ? info.calls.length + info.pending.length
                  : evidence.length}
            </span>
          </button>
        ))}
      </div>
      <div className={styles.inspectBody}>
        {tab === "Tools" ? (
          <>
            {pending.map((e) => (
              <p className={styles.liveTool} key={e.seq}>
                <LoaderCircle size={12} className={styles.spin} />
                {String(e.payload.name)} · running
              </p>
            ))}
            {failed.map((e) => (
              <p className={styles.liveTool} key={e.seq}>
                <CircleAlert size={12} />
                {String(e.payload.name)} · {String(e.payload.error)}
              </p>
            ))}
            {tools.map((e) => (
              <ToolReceipt
                key={e.seq}
                event={e}
                start={starts.get(identity(e))}
                s={s}
              />
            ))}
            {!tools.length && !pending.length && !failed.length && (
              <p className={styles.quiet}>
                Tool results will appear when this stage executes.
              </p>
            )}
          </>
        ) : tab === "Models" ? (
          <ProviderInspector events={relevant} />
        ) : evidence.length ? (
          <SourceList ids={evidence} s={s} />
        ) : (
          <p className={styles.quiet}>
            No source references in this stage at the selected event.
          </p>
        )}
      </div>
    </aside>
  );
}

function Replay({
  events,
  position,
  setPosition,
  playing,
  setPlaying,
  resetSelection,
}: {
  events: RunEvent[];
  position: number;
  setPosition: (position: number | null) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  resetSelection: () => void;
}) {
  if (!events.length) return null;
  const latest = events[position - 1];
  function seek(value: number) {
    setPlaying(false);
    resetSelection();
    setPosition(value >= events.length ? null : value);
  }
  return (
    <div className={styles.transportPanel}>
      <TracePlot
        compact
        events={events}
        position={position - 1}
        active={playing}
        onSeek={(i) => seek(i + 1)}
      />
      <div className={styles.replay}>
        <button
          type="button"
          className={styles.transport}
          aria-label={playing ? "Pause replay" : "Play investigation replay"}
          onClick={() => {
            resetSelection();
            if (!playing && position >= events.length) setPosition(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className={styles.replayLine}>
          <div>
            <strong>{latest ? eventTitle(latest) : "Run start"}</strong>
            <code>
              {position} / {events.length}
            </code>
          </div>
          <input
            type="range"
            min={0}
            max={events.length}
            value={position}
            aria-label="Investigation event"
            onChange={(e) => seek(+e.target.value)}
          />
        </div>
        {position < events.length && (
          <button
            className={styles.iconButton}
            title="Jump to latest event"
            aria-label="Jump to latest event"
            type="button"
            onClick={() => seek(events.length)}
          >
            <Radio size={16} />
          </button>
        )}
      </div>
      <nav aria-label="Recorded stage timeline" className={styles.timeline}>
        {stages.map((stage, i) => {
          const start = events.findIndex(
            (e) => e.stage === stage.id && e.kind === "stage_started",
          );
          const end = events.findLastIndex(
            (e) =>
              e.stage === stage.id &&
              ["stage_completed", "stage_failed"].includes(e.kind),
          );
          const limit =
            end >= 0 ? end : events.findLastIndex((e) => e.stage === stage.id);
          const ms =
            start >= 0 && limit >= 0
              ? elapsed(events[start].at, events[limit].at)
              : null;
          const visible = start >= 0 && position > start;
          return (
            <button
              key={stage.id}
              style={{ "--role": stage.color } as CSSProperties}
              data-seen={visible}
              disabled={start < 0}
              onClick={() => seek(limit + 1)}
              title={
                start < 0
                  ? stage.title + " pending"
                  : `Jump to ${stage.title} · ${ms !== null ? duration(ms) : "recorded stage"}`
              }
              aria-label={"Replay " + stage.title + " stage"}
            >
              <span>
                <stage.icon size={11} />
                {
                  [
                    "Discovery",
                    "Process",
                    "Strategy",
                    "Design",
                    "Simulation",
                    "Verify",
                  ][i]
                }
              </span>
              <i />
              <small>{ms !== null ? duration(ms) : "Pending"}</small>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Results({
  run,
  s,
  busy,
  onApprove,
  onBlueprint,
}: {
  run: InvestigationRun;
  s: State;
  busy: boolean;
  onApprove: (id: string) => void;
  onBlueprint: () => void;
}) {
  const result = run.result;
  const [choice, setChoice] = useState(
    run.approval?.approach ||
      result?.selected ||
      result?.package.approaches[0]?.id ||
      "",
  );
  const [tab, setTab] = useState<"Approaches" | "Findings">("Approaches");
  if (!result) return null;
  const approaches = result.package.approaches;
  const trials = Object.values(result.trials || {});
  const checks = Object.entries(result.stages?.verification?.checks || {});
  const eligible = approvedDesigns(run);
  const evaluationHold = run.result?.evaluation?.status === "fail";
  const chosen = approaches.find((a) => a.id === choice);
  return (
    <section
      className={styles.panel + " " + overview.field + " " + bench.panel}
    >
      <header className={styles.sectionHead}>
        <div className={styles.titleWithIcon}>
          <span className={styles.panelIcon}>
            <FileCheck2 size={18} />
          </span>
          <div>
            <h2>Investigation outcome</h2>
            <p>
              {run.mode === "live"
                ? "Specialist findings and verified designs"
                : "Deterministic findings and candidate designs"}
            </p>
          </div>
        </div>
        <span
          className={styles.status}
          data-status={result.verified ? "completed" : "failed"}
        >
          {result.verified ? <Check size={12} /> : <CircleAlert size={12} />}{" "}
          {result.verified ? "Verified" : "Review required"}
        </span>
      </header>
      <div className={styles.resultBody}>
        <p className={styles.summary}>{result.summary}</p>
        <div
          className={styles.tabs}
          role="group"
          aria-label="Investigation outcome views"
        >
          {(["Approaches", "Findings"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
            >
              {t}{" "}
              <span>
                {t === "Approaches"
                  ? approaches.length
                  : result.findings.length}
              </span>
            </button>
          ))}
        </div>
        {tab === "Findings" ? (
          <div>
            {result.findings.map((f, i) => (
              <article key={i} className={styles.finding}>
                <small>{label(f.kind)}</small>
                <p>{f.text}</p>
                <SourceList ids={f.evidence} s={s} />
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className={styles.approaches}>
              {approaches.map((a) => {
                const trial = trials.find((t) => t.approach === a.id);
                return (
                  <button
                    type="button"
                    className={styles.proposal}
                    aria-pressed={a.id === choice}
                    key={a.id}
                    onClick={() => setChoice(a.id)}
                  >
                    <span className={styles.proposalHeading}>
                      <Layers3 size={18} />
                      <strong>{a.name}</strong>
                      <i>{a.id === choice && <Check size={12} />}</i>
                    </span>
                    <p>{a.summary}</p>
                    {trial && (
                      <div className={styles.trial}>
                        <small>Investigation scenario</small>
                        <dl>
                          <div>
                            <dt>Projected median</dt>
                            <dd>
                              {trial.projected_median?.toLocaleString("en-GB", {
                                maximumFractionDigits: 2,
                              }) ?? "—"}
                              h
                            </dd>
                          </div>
                          <div>
                            <dt>Modelled net savings</dt>
                            <dd>
                              {trial.net_savings.toLocaleString("en-GB", {
                                style: "currency",
                                currency: trial.currency || "GBP",
                                maximumFractionDigits: 0,
                              })}
                            </dd>
                          </div>
                        </dl>
                        <small>
                          {Math.round(trial.assumptions.coverage * 100)}%
                          coverage ·{" "}
                          {Math.round(trial.assumptions.reduction * 100)}%
                          reduction ·{" "}
                          {Math.round(trial.assumptions.failure * 100)}% failure
                        </small>
                      </div>
                    )}
                    <span className={styles.complexity}>
                      Complexity · {a.complexity}
                    </span>
                  </button>
                );
              })}
            </div>
            <OperatingTradeoffs run={run} />
            {chosen && (
              <div className={styles.chosen}>
                <h3>Implementation constraints</h3>
                <p>{chosen.risk}</p>
                <ul>
                  {chosen.dependencies.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {!!checks.length && (
          <details className={styles.checks}>
            <summary>
              <ShieldCheck size={14} />
              Verification checks
              <span>
                {checks.filter(([, v]) => v).length}/{checks.length} passed
              </span>
              <ChevronDown size={12} />
            </summary>
            <ul>
              {checks.map(([name, pass]) => (
                <li key={name}>
                  {pass ? <Check size={13} /> : <CircleAlert size={13} />}{" "}
                  {label(name)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className={styles.approval}>
          <div>
            <ShieldCheck size={18} />
            <span>
              <strong>
                {run.approval
                  ? "Blueprint approved"
                  : evaluationHold
                    ? "Approval held"
                    : "Human approval"}
              </strong>
              <small>
                {run.approval
                  ? approaches.find((a) => a.id === run.approval?.approach)
                      ?.name
                  : evaluationHold
                    ? "Independent checks failed. Inspect the frozen evidence in Observatory."
                    : "Scope covers design and shadow-mode evaluation."}
              </small>
            </span>
          </div>
          {run.approval ? (
            <button className="btn" type="button" onClick={onBlueprint}>
              <BookOpenCheck size={14} />
              Open blueprint
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={
                busy ||
                !result.verified ||
                evaluationHold ||
                !chosen ||
                (!!eligible && !eligible.has(choice))
              }
              onClick={() => onApprove(choice)}
            >
              Approve design
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const logFilters = [
  "All events",
  "Tool activity",
  "Model calls",
  "Decisions",
] as const;
function ExecutionLog({ events, s }: { events: RunEvent[]; s: State }) {
  const [filter, setFilter] =
      useState<(typeof logFilters)[number]>("All events"),
    [limit, setLimit] = useState(30);
  const matching = useMemo(() => {
    return events
      .filter(
        (e) =>
          filter === "All events" ||
          (filter === "Tool activity"
            ? e.kind.startsWith("tool_")
            : filter === "Model calls"
              ? e.kind.startsWith("model_call")
              : e.kind.startsWith("architecture_") ||
                (e.stage === "verification" && e.kind === "stage_completed") ||
                e.kind === "blueprint_approved"),
      )
      .reverse();
  }, [events, filter]);
  const visible = matching.slice(0, limit);
  return (
    <section
      className={styles.panel + " " + overview.field + " " + bench.panel}
    >
      <header className={styles.sectionHead}>
        <div className={styles.titleWithIcon}>
          <span className={styles.panelIcon}>
            <SquareTerminal size={17} />
          </span>
          <div>
            <h2>Execution log</h2>
            <p>Recorded events through the selected point</p>
          </div>
        </div>
        <div className={styles.logFilter}>
          <select
            aria-label="Filter execution log"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as (typeof logFilters)[number]);
              setLimit(30);
            }}
          >
            {logFilters.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <code className={styles.count}>{matching.length}</code>
        </div>
      </header>
      <div className={styles.log}>
        {visible.map((e) => (
          <RecordedEvent key={e.seq} event={e} s={s} />
        ))}
        {!visible.length && (
          <p className={styles.logEmpty}>
            No matching receipts at this point in the trace.
          </p>
        )}
        {visible.length < matching.length && (
          <button
            className={styles.more}
            onClick={() => setLimit((l) => l + 30)}
          >
            Show earlier events · {matching.length - visible.length} remaining
          </button>
        )}
      </div>
    </section>
  );
}
const emptyEvents: RunEvent[] = [];

function StudioRun({
  s,
  snapshot,
  run,
  runs,
  busy,
  onStart,
  onDeterministic,
  onSelectRun,
  onResume,
  onApprove,
  onBlueprint,
}: Props) {
  const evidenceWorkspace = snapshot || s;
  const reduceMotion = useReducedMotion();
  const [cursor, setCursor] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState<StageId | null>(null);
  const events = run?.events ?? emptyEvents;
  const end = events.length;
  const position = cursor === null ? end : Math.min(cursor, end);
  const visible = useMemo(() => events.slice(0, position), [events, position]);
  const activeRun = run?.status === "running" || run?.status === "queued";
  const effectiveStatus = position === end ? run?.status : undefined;
  const active =
    selected ||
    [...visible]
      .reverse()
      .map((e) => stages.find((n) => n.id === e.stage)?.id)
      .find(Boolean) ||
    "discovery";
  const stage = stages.find((st) => st.id === active)!;
  useEffect(() => {
    if (!playing) return;
    if (position >= end) {
      setPlaying(false);
      setCursor(null);
      return;
    }
    const tick = window.setTimeout(() => setCursor(position + 1), 740);
    return () => window.clearTimeout(tick);
  }, [playing, position, end]);
  const waits = useMemo(
    () => observedWaits(s.data.events, s.report.case_ids),
    [s.data.events, s.report.case_ids],
  );
  const recordedWaits = useMemo(
    () =>
      snapshot
        ? observedWaits(snapshot.data.events, snapshot.report.case_ids)
        : waits,
    [snapshot, waits],
  );
  const completed = stages.filter(
    (st) => stagePhase(st.id, visible, effectiveStatus) === "Complete",
  ).length;
  const mode = run
    ? investigationEngine(run, visible)
    : s.ai
      ? "AI mode configured"
      : "Deterministic analysis";
  const [motionPaused, setMotionPaused] = useState(false);

  const phase = stagePhase(stage.id, visible, effectiveStatus);
  const activity = useMemo(() => {
    const receipts = new Map<string, number>();
    const finished = new Set<string>(),
      reached = new Set<string>();
    for (const e of visible) {
      if (e.kind === "tool_result" && e.stage)
        receipts.set(e.stage, (receipts.get(e.stage) ?? 0) + 1);
      if (e.kind === "stage_completed" && e.stage) finished.add(e.stage);
      if (e.kind === "stage_started") {
        const i = stages.findIndex((s) => s.id === e.stage);
        if (i > 0 && finished.has(stages[i - 1].id)) reached.add(stages[i].id);
      }
      if (e.kind === "handoff") {
        const i = stages.findIndex(
          (s) => s.id === (e.payload.to ?? e.payload.target),
        );
        if (i > 0 && stages[i - 1].id === (e.payload.from ?? e.stage))
          reached.add(stages[i].id);
      }
    }
    const last = visible.at(-1);
    const transferring =
      last?.kind === "handoff"
        ? String(last.payload.to ?? last.payload.target)
        : null;
    return { receipts, reached, transferring };
  }, [visible]);
  const decisionRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const cut = run && (run.status === "failed" || run.status === "interrupted");
  const sourceLabel =
    s.data.sources.length && s.data.sources.every((x) => x.synthetic)
      ? "Synthetic workspace"
      : "Workspace data";
  return (
    <div
      className={[overview.fieldTheme, styles.studio, bench.studio].join(" ")}
      data-motion={!motionPaused}
    >
      <section
        aria-label="Investigation work surface"
        className={overview.field + " " + bench.panel}
      >
        <header className={bench.head}>
          <div>
            <span className={bench.eyebrow}>
              <GitBranch size={14} /> Investigation · {sourceLabel}
            </span>
            <h2>Refund approval delays</h2>
            <p>
              Invoice re-entry to finance authorisation · {s.report.days}-day
              window
            </p>
          </div>
          <div className={bench.actions}>
            {" "}
            <button
              className="btn primary"
              disabled={
                busy ||
                activeRun ||
                !waits.length ||
                !can(s, "investigations:run")
              }
              type="button"
              onClick={onStart}
            >
              {activeRun ? (
                <LoaderCircle size={14} className={styles.spin} />
              ) : s.ai ? (
                <Sparkles size={14} />
              ) : (
                <Play size={13} />
              )}{" "}
              {activeRun
                ? "Investigation running"
                : s.ai
                  ? "Investigate with AI"
                  : "Run deterministic investigation"}
            </button>
            {s.ai && (
              <button
                type="button"
                className="btn"
                disabled={
                  busy ||
                  activeRun ||
                  !waits.length ||
                  !can(s, "investigations:run")
                }
                onClick={onDeterministic}
              >
                Run deterministic investigation
              </button>
            )}
          </div>
        </header>
        <div className={bench.fieldBar}>
          <div>
            <Workflow size={15} />
            <h3>Specialist handoffs</h3>
          </div>
          <span>{mode}</span>
          <div className={bench.legend} aria-label="Handoff key">
            <span>Planned</span>
            <span>Recorded</span>
          </div>
          <div className={bench.tools}>
            <span>
              <b>
                {completed}/{stages.length}
              </b>{" "}
              complete
            </span>
            <button
              type="button"
              aria-label={
                motionPaused ? "Resume studio motion" : "Pause studio motion"
              }
              onClick={() => setMotionPaused((v) => !v)}
            >
              {motionPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </div>
        </div>
        <InvestigationField
          stages={stages}
          phases={stages.map((st) =>
            stagePhase(st.id, visible, effectiveStatus),
          )}
          receipts={activity.receipts}
          reached={activity.reached}
          transferring={
            playing || (activeRun && position === end)
              ? activity.transferring
              : null
          }
          paused={motionPaused}
          selected={stage.id}
          select={setSelected}
        />
        <div
          className={bench.selection}
          style={{ "--role": stage.color } as CSSProperties}
        >
          <stage.icon size={21} />
          <div>
            <small>{phase} · Selected specialist</small>
            <strong>{stage.title}</strong>
          </div>
          <p>{stage.remit}</p>
          <button
            className="btn"
            onClick={() =>
              document.getElementById("studio-specialist-inspector")?.focus()
            }
          >
            Inspect specialist <ArrowDownRight size={14} />
          </button>
        </div>
        {run && <RunMeasurements events={visible} run={run} />}
        <Replay
          events={events}
          position={position}
          setPosition={setCursor}
          playing={playing}
          setPlaying={setPlaying}
          resetSelection={() => setSelected(null)}
        />
      </section>
      <div className={bench.records}>
        <div className={overview.field + " " + bench.panel}>
          {run && selected && (
            <button className={bench.follow} onClick={() => setSelected(null)}>
              <Radio size={13} /> Follow event selection
            </button>
          )}
          <Inspector
            key={stage.id}
            stage={stage}
            events={visible}
            s={evidenceWorkspace}
            live={run?.mode === "live"}
            phase={phase}
          />
        </div>
        <div
          className={overview.field + " " + bench.panel + " " + bench.interval}
          aria-label="Observed refund intervals"
          tabIndex={-1}
        >
          <WaitDistribution s={evidenceWorkspace} intervals={recordedWaits} />
        </div>
      </div>
      {run && (
        <div className={bench.review}>
          <span>
            {position < end ? "Replay" : "Investigation"} · Event {position} of{" "}
            {end}
          </span>
          {visible.length > 0 && (
            <button onClick={() => logRef.current?.focus()}>
              {eventTitle(visible[visible.length - 1])}{" "}
              <ArrowDownRight size={13} />
            </button>
          )}
          {run?.result && position === end && (
            <button onClick={() => decisionRef.current?.focus()}>
              Review decision <ArrowDownRight size={14} />
            </button>
          )}
          {runs.length > 0 && (
            <select
              aria-label="Saved investigations"
              className={styles.runSelect}
              value={run?.id || ""}
              onChange={(e) => onSelectRun(e.target.value)}
            >
              {!run && <option value="">Select a saved run</option>}
              {runs.map((r) => (
                <option value={r.id} key={r.id}>
                  {new Date(r.created).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  UTC · {investigationEngine(r)} · {r.id.slice(-6)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {run?.mode === "live" && (
        <ArchitectureReview
          events={visible}
          run={run}
          renderEvidence={(ids) => (
            <SourceList ids={ids} s={evidenceWorkspace} />
          )}
        />
      )}
      {cut && position === end && (
        <section className={styles.failure}>
          <CircleAlert size={18} />
          <div>
            <strong>
              {run.status === "failed"
                ? "Investigation failed"
                : "Execution interrupted"}
            </strong>
            <p>
              {run.error ||
                "The last recorded event is available for inspection."}
            </p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={onResume}
            disabled={
              busy ||
              !can(
                s,
                run?.mode === "live" ? "models:run" : "investigations:run",
              )
            }
          >
            <RotateCcw size={13} />
            Retry investigation
          </button>
        </section>
      )}
      {run && position === end && run.result && (
        <motion.div
          ref={decisionRef}
          tabIndex={-1}
          aria-label="Review investigation decision"
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Results
            run={run}
            s={evidenceWorkspace}
            busy={busy || !can(s, "decisions:approve")}
            onApprove={onApprove}
            onBlueprint={onBlueprint}
          />
        </motion.div>
      )}
      {visible.length > 0 && (
        <div ref={logRef} tabIndex={-1} aria-label="Inspect execution log">
          <ExecutionLog events={visible} s={evidenceWorkspace} />
        </div>
      )}
    </div>
  );
}

type StudioView = "investigation" | "observatory" | "architecture";
function studioView(): StudioView {
  const name =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("studio")
      : null;
  return name === "observatory" || name === "architecture"
    ? name
    : "investigation";
}
export default function Studio(props: Props) {
  const [view, updateView] = useState<StudioView>(studioView);
  useEffect(() => {
    const sync = () => updateView(studioView());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function setView(next: StudioView) {
    if (next === view) return;
    const url = new URL(location.href);
    if (next === "investigation") url.searchParams.delete("studio");
    else url.searchParams.set("studio", next);
    window.history.pushState(window.history.state, "", url);
    updateView(next);
  }
  return (
    <>
      <div
        role="group"
        aria-label="Studio views"
        className={observatoryStyles.switcher}
      >
        <button
          type="button"
          aria-pressed={view === "investigation"}
          onClick={() => setView("investigation")}
        >
          <Workflow size={14} />
          Investigation
        </button>
        <button
          type="button"
          aria-pressed={view === "observatory"}
          onClick={() => setView("observatory")}
        >
          <Radar size={14} />
          Observatory
        </button>
        <button
          type="button"
          aria-pressed={view === "architecture"}
          onClick={() => setView("architecture")}
        >
          <Workflow size={14} />
          Architecture explorer
        </button>
      </div>
      {view === "architecture" ? (
        <ArchitectureExplorer
          run={props.run}
          snapshot={props.snapshot}
          onObservatory={() => setView("observatory")}
        />
      ) : view === "investigation" ? (
        <StudioRun key={props.run?.id || "unstarted"} {...props} />
      ) : (
        <Observatory
          key={props.s.tenant}
          {...props}
          onInvestigation={() => setView("investigation")}
        />
      )}
    </>
  );
}
