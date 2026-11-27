"use client";
import { useMemo, useState } from "react";
import { ArrowDownRight, Activity, Pause, Play } from "lucide-react";
import type { Report } from "../lib/types";
import ProcessRibbon from "./ProcessRibbon";
import HandoffBackdrop from "./HandoffBackdrop";
import css from "./OperationalWork.module.css";

export default function AgentProfile({
  traces,
  inspect,
}: {
  traces: Report["traces"];
  inspect: (i: number) => void;
}) {
  const [picked, pick] = useState<number | null>(null),
    [paused, pause] = useState(false);
  const peak = traces.reduce(
    (best, t, i) => (t.ms > traces[best].ms ? i : best),
    0,
  );
  const selected = picked !== null && traces[picked] ? picked : peak,
    task = traces[selected];
  const start = Math.floor(selected / 6) * 6;
  const stops = useMemo(
    () =>
      traces
        .slice(start, start + 6)
        .map((t) => ({ label: t.role, magnitude: t.ms })),
    [traces, start],
  );
  if (!task) return null;
  return (
    <section
      aria-label="Recorded stage timing"
      className={css.agentStage}
      data-paused={paused}
    >
      <HandoffBackdrop warm={selected === peak && task.ms > 0} />
      <header>
        <div>
          <span className={css.caption}>
            <Activity size={13} /> Stage duration · milliseconds
          </span>
          <h3>{task.role}</h3>
        </div>
        <button
          className={css.motion}
          aria-label={paused ? "Resume timing motion" : "Pause timing motion"}
          onClick={() => pause(!paused)}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </header>
      {traces[peak].ms > 0 && (
        <ProcessRibbon
          label="Recorded stage durations"
          stops={stops}
          maximum={traces[peak].ms}
          peak={peak}
          selected={selected}
          start={start}
          select={pick}
          paused={paused}
        />
      )}
      <footer className={css.agentRead}>
        <div>
          <strong>
            {task.ms.toFixed(2)} <small>ms</small>
          </strong>
          <span>{task.tool}</span>
        </div>
        <button className="btn" onClick={() => inspect(selected)}>
          Inspect execution <ArrowDownRight size={14} />
        </button>
      </footer>
      {traces.length > 6 && (
        <label className={css.picker}>
          Recorded stage
          <select
            value={selected}
            onChange={(e) => pick(Number(e.target.value))}
          >
            {traces.map((t, i) => (
              <option key={i} value={i}>
                {t.role}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}
