"use client";

import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  Activity,
  BookOpenCheck,
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  CircuitBoard,
  CornerDownRight,
  Cpu,
  Database,
  FileCheck2,
  FlaskConical,
  GitBranch,
  GitFork,
  Layers3,
  ListTree,
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
import observatoryStyles from "./Observatory.module.css";
import styles from "./Studio.module.css";

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

function observedWaits(events: EventRow[], scopedCases: string[]) {
  const scope = new Set(scopedCases);
  const groups = new Map<string, EventRow[]>();
  for (const event of events) {
    if (!scope.has(event.case)) continue;
    if (!groups.has(event.case)) groups.set(event.case, []);
    groups.get(event.case)!.push(event);
  }
  const waits: number[] = [];
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
        waits.push(
          (Date.parse(row.timestamp) - Date.parse(group[i - 1].timestamp)) /
            3_600_000,
        );
      }
    });
  }
  return waits.sort((a, b) => a - b);
}

function WaitDistribution({ values }: { values: number[] }) {
  const gradient = useId().replace(/:/g, "");
  if (!values.length)
    return (
      <div className={styles.chartEmpty}>
        No matching refund transitions in this window.
      </div>
    );
  const low = values[0],
    high = values[values.length - 1];
  const step = Math.max((high - low) / 24, 0.001);
  const bins = Array<number>(24).fill(0);
  values.forEach((v) => bins[Math.min(23, Math.floor((v - low) / step))]++);
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const maximum = Math.max(...bins);
  const medianX = high === low ? 0 : ((median - low) / (high - low)) * 300;
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
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c8eb92" />
            <stop offset="1" stopColor="#567347" />
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
        {bins.map((n, i) => (
          <rect
            key={i}
            x={i * 12.5 + 0.5}
            y={46 - (n / maximum) * 35}
            width="9"
            height={(n / maximum) * 35}
            rx="1.2"
            fill={`url(#${gradient})`}
            opacity={0.52 + 0.43 * (1 - Math.abs(i - 12) / 24)}
          >
            <title>{`${(low + i * step).toFixed(1)}–${(low + (i + 1) * step).toFixed(1)}h · ${n} transitions`}</title>
          </rect>
        ))}
        <line
          x1={medianX}
          x2={medianX}
          y1="1"
          y2="47"
          stroke="#def8b4"
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        <circle cx={medianX} cy="2" r="2" fill="#dbf4b1" />
      </svg>
      <div className={styles.axis}>
        <span>{low.toFixed(1)}h</span>
        <span>{values.length} transitions</span>
        <span>{high.toFixed(1)}h</span>
      </div>
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
    <aside className={styles.inspector}>
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

function Graph({
  events,
  selected,
  select,
  status,
}: {
  events: RunEvent[];
  selected: StageId;
  select: (v: StageId) => void;
  status?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([r]) =>
      setNarrow(r.contentRect.width < 530),
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const columns = narrow ? 2 : 3;
  const layout = stages.map((_, i) => {
    const row = Math.floor(i / columns),
      col = i % columns;
    return { x: row % 2 ? columns - 1 - col : col, y: row };
  });
  function toward(i: number, j: number) {
    if (j < 0 || j >= layout.length) return Position.Left;
    if (layout[j].y !== layout[i].y)
      return layout[j].y > layout[i].y ? Position.Bottom : Position.Top;
    return layout[j].x > layout[i].x ? Position.Right : Position.Left;
  }
  const nodes: Node[] = stages.map((stage, i) => {
    const phase = stagePhase(stage.id, events, status);
    const count = events.filter(
      (e) => e.stage === stage.id && e.kind === "tool_result",
    ).length;
    return {
      id: stage.id,
      type: "default",
      position: { x: layout[i].x * (narrow ? 185 : 215), y: layout[i].y * 99 },
      style: narrow ? { width: 166 } : undefined,
      sourcePosition: toward(i, i + 1),
      targetPosition: toward(i, i - 1),
      className: styles.graphNode,
      ariaLabel: stage.title,
      data: {
        label: (
          <button
            type="button"
            onClick={() => select(stage.id)}
            aria-pressed={selected === stage.id}
            style={{ "--role": stage.color } as CSSProperties}
            className={styles.nodeFace}
          >
            <span className={styles.nodeHead}>
              <stage.icon size={18} />
              <span>{stage.title}</span>
            </span>
            <span className={styles.nodeFoot} data-phase={phase}>
              <i />
              {phase}
              {events.at(-1)?.stage === stage.id &&
                events.at(-1)?.kind === "model_call_started" &&
                phase === "In progress" && (
                  <Cpu size={11} aria-label="Model request in progress" />
                )}
              {count > 0 && (
                <b title="Tool results">
                  <Braces size={10} />
                  {count}
                </b>
              )}
            </span>
          </button>
        ),
      },
      draggable: false,
      connectable: false,
      selectable: false,
    };
  });
  const edges: Edge[] = stages.slice(1).map((to, i) => {
    const from = stages[i];
    const handoff = events.some(
      (e) =>
        e.kind === "handoff" &&
        (e.payload.from ?? e.stage) === from.id &&
        (e.payload.to ?? e.payload.target) === to.id,
    );
    const traversed =
      handoff ||
      (events.some(
        (e) => e.kind === "stage_completed" && e.stage === from.id,
      ) &&
        events.some((e) => e.kind === "stage_started" && e.stage === to.id));
    const last = events.at(-1);
    const transferring =
      last?.kind === "handoff" &&
      last.payload.from === from.id &&
      last.payload.to === to.id;
    const inFlight =
      traversed &&
      (transferring || stagePhase(to.id, events, status) === "In progress");
    const stroke = inFlight ? "#c6ed9b" : traversed ? "#8fac76" : "#53615c";
    return {
      id: from.id + "-" + to.id,
      source: from.id,
      target: to.id,
      type: "smoothstep",
      animated: inFlight && !reduced,
      className: inFlight ? styles.transfer : undefined,
      style: {
        stroke,
        strokeWidth: traversed ? 2 : 1.4,
        strokeDasharray: traversed ? undefined : "4 4",
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
    };
  });
  return (
    <div className={styles.graph} ref={box} data-narrow={narrow}>
      <ReactFlow
        key={columns}
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => select(node.id as StageId)}
        deleteKeyCode={null}
        panOnDrag
        zoomOnScroll={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: narrow ? 0.04 : 0.12, maxZoom: 1.3 }}
        minZoom={0.35}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#414b47" gap={17} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
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
    <section className={styles.panel}>
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
    <section className={styles.panel}>
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
  const completed = stages.filter(
    (st) => stagePhase(st.id, visible, effectiveStatus) === "Complete",
  ).length;
  const mode = run
    ? investigationEngine(run, visible)
    : s.ai
      ? "AI mode configured"
      : "Deterministic analysis";
  const cut = run && (run.status === "failed" || run.status === "interrupted");
  const sourceLabel =
    s.data.sources.length && s.data.sources.every((x) => x.synthetic)
      ? "Synthetic workspace"
      : "Workspace data";
  return (
    <div className={styles.studio}>
      <section className={styles.caseHero}>
        <div className={styles.caseLead}>
          <div className={styles.eyeline}>
            <span>
              <GitBranch size={13} />
              Process investigation
            </span>
            <i /> {sourceLabel}
          </div>
          <h2>Refund approval delays</h2>
          <p>
            Trace the wait from invoice re-entry to finance authorisation.
            Compare routing designs and inspect the evidence for a shadow pilot.
          </p>
          <div className={styles.launch}>
            <button
              className="btn primary"
              disabled={busy || activeRun || !waits.length}
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
                disabled={busy || activeRun || !waits.length}
                onClick={onDeterministic}
              >
                Run deterministic investigation
              </button>
            )}
            <span>
              <Database size={12} />
              Current workspace · {s.report.days} days
            </span>
          </div>
        </div>
        <WaitDistribution values={waits} />
      </section>
      <section className={styles.panel}>
        <header className={styles.sectionHead}>
          <div className={styles.titleWithIcon}>
            <span className={styles.panelIcon}>
              <Workflow size={18} />
            </span>
            <div>
              <h2>Investigation graph</h2>
              <p>{mode}</p>
            </div>
          </div>
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
                  UTC · {r.mode === "live" ? "AI" : "Deterministic"} ·{" "}
                  {r.id.slice(-6)}
                </option>
              ))}
            </select>
          )}
        </header>
        {run && <RunMeasurements events={visible} run={run} />}
        <div className={styles.mainGrid}>
          <div className={styles.graphBlock}>
            <div className={styles.graphMeta}>
              <span
                className={styles.status}
                data-status={effectiveStatus || "planned"}
              >
                {run ? (
                  position < end ? (
                    <RotateCcw size={12} />
                  ) : (
                    <Activity size={12} />
                  )
                ) : (
                  <ListTree size={12} />
                )}{" "}
                {run
                  ? position < end
                    ? "Replay"
                    : label(run.status)
                  : "Run plan"}
              </span>
              <span>
                <i className={styles.dash} />
                Planned
              </span>
              <span>
                <i className={styles.solid} />
                Executed
              </span>
              <b>
                {completed}/{stages.length}
              </b>
            </div>
            <Graph
              events={visible}
              selected={stage.id}
              select={setSelected}
              status={effectiveStatus}
            />
            <Replay
              events={events}
              position={position}
              setPosition={setCursor}
              playing={playing}
              setPlaying={setPlaying}
              resetSelection={() => setSelected(null)}
            />
          </div>
          <Inspector
            key={stage.id}
            stage={stage}
            events={visible}
            s={evidenceWorkspace}
            live={run?.mode === "live"}
            phase={stagePhase(stage.id, visible, effectiveStatus)}
          />
        </div>
      </section>
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
            disabled={busy}
          >
            <RotateCcw size={13} />
            Retry investigation
          </button>
        </section>
      )}
      {run && position === end && run.result && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Results
            run={run}
            s={evidenceWorkspace}
            busy={busy}
            onApprove={onApprove}
            onBlueprint={onBlueprint}
          />
        </motion.div>
      )}
      {visible.length > 0 && (
        <ExecutionLog events={visible} s={evidenceWorkspace} />
      )}
    </div>
  );
}

export default function Studio(props: Props) {
  const [view, setView] = useState<"investigation" | "observatory">(
    "investigation",
  );
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
      </div>
      {view === "investigation" ? (
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
