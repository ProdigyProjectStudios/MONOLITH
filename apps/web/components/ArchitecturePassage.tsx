"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, Pause, Play, Workflow } from "lucide-react";
import type { Layer } from "./architectureMap";
import HandoffBackdrop from "./HandoffBackdrop";
import RoutePassage from "./RoutePassage";
import skin from "./Overview.module.css";
import css from "./StudioInstruments.module.css";

const colors = [
  "#80d9c0",
  "#a5cafa",
  "#c4b1eb",
  "#efc498",
  "#93cfdd",
  "#b7de9c",
];
export default function ArchitecturePassage({
  layer,
  index,
  total,
  runtime,
  children,
  inspect,
}: {
  layer: Layer;
  index: number;
  total: number;
  runtime: string;
  children: ReactNode;
  inspect: () => void;
}) {
  const [paused, pause] = useState(false);
  const systems = useMemo(
    () =>
      [layer.input, layer.output].map((name, i) => ({
        name,
        count: 0,
        pressure: false,
        formIndex: index + i,
        color: colors[(index + i) % colors.length],
      })),
    [layer, index],
  );
  const route = useMemo(
    () => ({
      id: layer.id,
      source: layer.input,
      target: layer.output,
      count: 0,
      pressure: false,
    }),
    [layer],
  );
  return (
    <div
      className={skin.field + " " + css.instrument}
      role="group"
      aria-label="Component transfer"
      data-paused={paused}
    >
      <div className={css.chamber}>
        <HandoffBackdrop warm={false} />
        <header className={css.signalHead}>
          <div>
            <small>
              <Workflow size={14} />
              Component {index + 1} of {total} · {runtime} design
            </small>
            <h3>{layer.component}</h3>
          </div>
          <button
            className={css.motion}
            aria-label={
              paused ? "Resume contract motion" : "Pause contract motion"
            }
            onClick={() => pause(!paused)}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </header>
        <RoutePassage systems={systems} route={route} paused={paused} />
        <div className={css.endpoints}>
          <div>
            <small>Input</small>
            <strong>{layer.input}</strong>
          </div>
          <div>
            <small>Output</small>
            <strong>{layer.output}</strong>
          </div>
        </div>
      </div>
      {children}
      <footer className={css.foot}>
        <div>
          <small>Engineering constraint</small>
          <p>{layer.invariant}</p>
        </div>
        <button className="btn" onClick={inspect}>
          Inspect implementation <ArrowDownRight size={14} />
        </button>
      </footer>
    </div>
  );
}
