"use client";
import { useId, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { InvestigationRun, RunEvent } from "../lib/investigations";
import css from "./StudioTrace.module.css";

const stages = [
  "discovery",
  "process",
  "strategy",
  "architect",
  "simulation",
  "verification",
];
const names = [
  "Discovery",
  "Process",
  "Strategy",
  "Architecture",
  "Simulation",
  "Verification",
];
const color = (e: RunEvent) =>
  e.kind.includes("fail") || e.kind === "tool_error"
    ? "#ffb48b"
    : e.kind.includes("model") || e.kind.includes("architecture")
      ? "#c6bbdd"
      : e.kind === "handoff"
        ? "#f4c1a6"
        : e.kind.includes("tool")
          ? "#acbfed"
          : "#cad0da";
function label(e: RunEvent) {
  return e.kind === "handoff"
    ? "Handoff to " + (e.payload.to ?? e.payload.target ?? "next stage")
    : String(e.payload.name ?? e.payload.agent ?? e.kind.replaceAll("_", " "));
}
type Point = { x: number; y: number; e: RunEvent; i: number };
function geometry(events: RunEvent[]) {
  let lane = 0;
  const all = events.map((e, i) => {
    const stage = stages.indexOf(e.stage);
    if (stage !== -1) lane = stage;
    const branch =
      e.payload.reviewer === "reliability"
        ? -5
        : e.payload.reviewer === "operations"
          ? 5
          : 0;
    return {
      e,
      i,
      x: 6 + (588 * i) / Math.max(1, events.length - 1),
      y: 12 + lane * 17 + branch,
    };
  });
  const step = Math.max(1, Math.ceil(all.length / 160));
  const sampled = all.filter(
    (p, i) =>
      i === 0 ||
      i === all.length - 1 ||
      i % step === 0 ||
      p.e.kind === "handoff",
  );
  let path = "";
  sampled.forEach((p, i) => {
    if (!i) {
      path = "M" + p.x + "," + p.y;
      return;
    }
    const prev = sampled[i - 1],
      mid = (prev.x + p.x) / 2;
    path +=
      " C" + mid + "," + prev.y + " " + mid + "," + p.y + " " + p.x + "," + p.y;
  });
  return { all, sampled, path };
}
export function TracePlot({
  events,
  position,
  active = false,
  compact = false,
  onSeek,
}: {
  events: RunEvent[];
  position: number;
  active?: boolean;
  compact?: boolean;
  onSeek?: (i: number) => void;
}) {
  const id = useId().replace(/:/g, "");
  const { all, sampled, path } = useMemo(() => geometry(events), [events]);
  const current = all[position],
    prefix = events[position]?.stage;
  if (!sampled.length) return null;
  return (
    <div
      className={css.chart}
      data-compact={compact}
      data-active={active}
      data-interactive={!!onSeek}
    >
      {!compact && (
        <div className={css.lanes} aria-hidden="true">
          {names.map((n, i) => (
            <span key={n} data-on={stages[i] === prefix}>
              {n}
            </span>
          ))}
        </div>
      )}
      <svg
        viewBox="0 0 600 110"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          "Recorded sequence through " +
          new Set(
            events.map((e) => e.stage).filter((id) => stages.includes(id)),
          ).size +
          " specialist stages"
        }
        onPointerDown={
          onSeek
            ? (ev) => {
                const rect = ev.currentTarget.getBoundingClientRect();
                const fraction =
                  (((ev.clientX - rect.left) / rect.width) * 600 - 6) / 588;
                const index = Math.round(fraction * (events.length - 1));
                onSeek(Math.max(0, Math.min(events.length - 1, index)));
              }
            : undefined
        }
      >
        <defs>
          <linearGradient id={id + "-trail"}>
            <stop stopColor="#8ea9d9" />
            <stop offset=".52" stopColor="#c9cddd" />
            <stop offset="1" stopColor="#eec3af" />
          </linearGradient>
        </defs>
        {stages.map((stage, i) => (
          <line
            key={stage}
            x1="0"
            x2="600"
            y1={12 + i * 17}
            y2={12 + i * 17}
            stroke={stage === prefix ? "#a5bbeb6b" : "#a9adc23b"}
            strokeDasharray="1 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke={"url(#" + id + "-trail)"}
          strokeWidth={compact ? 7 : 13}
          opacity=".08"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path}
          fill="none"
          stroke={"url(#" + id + "-trail)"}
          strokeWidth={compact ? 1.5 : 2.1}
          vectorEffect="non-scaling-stroke"
        />
        {!compact &&
          sampled
            .filter((p) =>
              [
                "tool_result",
                "handoff",
                "model_call",
                "run_failed",
                "stage_completed",
              ].includes(p.e.kind),
            )
            .map((p) => (
              <circle
                key={p.i}
                cx={p.x}
                cy={p.y}
                r={p.e.kind === "handoff" ? 2.7 : 1.7}
                fill={color(p.e)}
              />
            ))}
        {current && (
          <g>
            <line
              x1={current.x}
              x2={current.x}
              y1="1"
              y2="109"
              stroke={color(current.e)}
              strokeDasharray="2 3"
              opacity=".55"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={current.x}
              cy={current.y}
              r="7"
              fill={color(current.e)}
              opacity=".18"
              className={css.halo}
            />
            <circle
              cx={current.x}
              cy={current.y}
              r="3.3"
              fill={color(current.e)}
              stroke="#f4f1e9"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
export function TraceLens({
  run,
  onStage,
}: {
  run: InvestigationRun;
  onStage: (id: string) => void;
}) {
  const [cursor, setCursor] = useState<number | null>(null),
    events = run.events;
  if (!events.length) return null;
  const end = events.length - 1,
    idx = cursor === null ? end : Math.min(end, cursor),
    event = events[idx];
  const current =
    cursor === null && (run.status === "running" || run.status === "queued");
  const stage = stages.indexOf(event.stage),
    stageName = stage === -1 ? "Run" : names[stage];
  const position = (i: number) => setCursor(i >= end ? null : Math.max(0, i));
  const at = new Date(event.at);
  return (
    <section className={css.lens} aria-label="Recorded execution trace">
      <div className={css.traceHead}>
        <span>
          <Activity size={14} />
          Execution trace
        </span>
        <small>{events.length} recorded events</small>
      </div>
      <TracePlot
        events={events}
        position={idx}
        active={current}
        onSeek={position}
      />
      <div className={css.transport}>
        <button
          type="button"
          disabled={idx === 0}
          aria-label="Previous trace event"
          onClick={() => position(idx - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={end}
          value={idx}
          onChange={(e) => position(+e.target.value)}
          aria-label="Inspect trace event"
          aria-valuetext={
            "Event " + event.seq + ", " + stageName + ", " + label(event)
          }
        />
        <button
          type="button"
          disabled={idx === end}
          aria-label="Next trace event"
          onClick={() => position(idx + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className={css.readout}>
        <span style={{ color: color(event) }}>#{event.seq}</span>
        <b>{label(event)}</b>
        <small>
          {event.kind.replaceAll("_", " ")} · {stageName}
          {Number.isNaN(at.getTime())
            ? ""
            : " · " +
              at.toLocaleTimeString("en-GB", { timeZone: "UTC" }) +
              " UTC"}
        </small>
        {stage !== -1 && (
          <button type="button" onClick={() => onStage(event.stage)}>
            Stage trace <ArrowUpRight size={12} />
          </button>
        )}
      </div>
    </section>
  );
}
