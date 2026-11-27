"use client";
import { useState, useMemo } from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import RoutePassage from "./RoutePassage";
import HandoffBackdrop from "./HandoffBackdrop";
import css from "./OperationalWork.module.css";

export default function BlueprintSequence({ nodes }: { nodes: string[] }) {
  const [index, pick] = useState(0),
    [paused, pause] = useState(false);
  const selected = Math.min(index, Math.max(0, nodes.length - 2));
  const from = nodes[selected],
    to = nodes[selected + 1];
  // Component labels can repeat. Stable position keys keep the two stations distinct.
  const systems = useMemo(
    () => [
      {
        name: "from",
        count: 0,
        pressure: false,
        formIndex: selected,
        color: "#96dec5",
      },
      {
        name: "to",
        count: 0,
        pressure: false,
        formIndex: selected + 1,
        color: "#b6a7ec",
      },
    ],
    [selected],
  );
  const route = useMemo(
    () => ({
      id: "contract-" + selected,
      source: "from",
      target: "to",
      count: 0,
      pressure: false,
    }),
    [selected],
  );
  if (nodes.length < 2)
    return (
      <p className={css.single}>{from || "No proposed steps recorded."}</p>
    );
  return (
    <section
      role="group"
      aria-label="Proposed architecture flow"
      className={css.sequence}
    >
      <div className={css.sequenceStage} data-paused={paused}>
        <HandoffBackdrop warm={false} />
        <header>
          <span>
            Proposed transfer · {selected + 1} / {nodes.length - 1}
          </span>
          <button
            className={css.motion}
            onClick={() => pause(!paused)}
            aria-label={
              paused ? "Resume transfer motion" : "Pause transfer motion"
            }
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </header>
        <RoutePassage systems={systems} route={route} paused={paused} />
        <div className={css.transferNames}>
          <strong>{from}</strong>
          <ArrowRight size={16} />
          <strong>{to}</strong>
        </div>
      </div>
      <div className={css.steps}>
        <h3>Implementation path</h3>
        <ol>
          {nodes.map((node, i) => (
            <li key={i}>
              {i < nodes.length - 1 ? (
                <button
                  aria-label={
                    "Inspect transfer from " + node + " to " + nodes[i + 1]
                  }
                  aria-pressed={i === selected}
                  onClick={() => pick(i)}
                >
                  <code>{String(i + 1).padStart(2, "0")}</code>
                  <span>{node}</span>
                  <ArrowRight size={13} />
                </button>
              ) : (
                <span>
                  <code>{String(i + 1).padStart(2, "0")}</code>
                  {node}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
