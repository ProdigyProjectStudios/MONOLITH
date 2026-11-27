"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { FieldEngine } from "./overview/fieldEngine";
import { stagePosition } from "./overview/stagePosition";
import HandoffBackdrop from "./HandoffBackdrop";
import css from "./StudioBench.module.css";

type Stage = { id: string; title: string; color: string };
export default function InvestigationField<T extends string>({
  stages,
  phases,
  receipts,
  reached,
  transferring,
  selected,
  select,
  paused,
}: {
  stages: readonly (Stage & { id: T })[];
  phases: string[];
  receipts: Map<string, number>;
  reached: Set<string>;
  transferring: string | null;
  selected: T;
  select: (id: T) => void;
  paused: boolean;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<FieldEngine | null>(null);
  const [width, setWidth] = useState(0),
    [zoom, setZoom] = useState(1);
  const narrow = width < 580;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let closed = false,
      fx: FieldEngine | undefined;
    function lost() {
      setEngine(null);
    }
    const restored = () => {
      if (fx && !closed) setEngine(fx);
    };
    el.addEventListener("webglcontextrestored", restored);
    el.addEventListener("webglcontextlost", lost);
    import("./overview/fieldEngine")
      .then(({ FieldEngine }) => {
        if (closed) return;
        fx = new FieldEngine(el, "investigation");
        fx.setData(
          stages.map((s, i) => ({
            name: s.id,
            count: 1,
            pressure: false,
            formIndex: i,
            color: s.color,
          })),
          stages.slice(1).map((s, i) => ({
            source: stages[i].id,
            target: s.id,
            id: s.id,
            count: 1,
            pressure: false,
          })),
        );
        setEngine(fx);
      })
      .catch(() => {
        if (!closed) setEngine(null);
      });
    return () => {
      closed = true;
      el.removeEventListener("webglcontextrestored", restored);
      el.removeEventListener("webglcontextlost", lost);
      fx?.dispose();
    };
  }, [stages]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const resize = () => {
      setWidth(el.clientWidth);
      engine?.resize(el.clientWidth, el.clientHeight);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, [engine]);
  useEffect(() => {
    if (!engine || !canvas.current) return;
    const pref = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () =>
      engine.setActive(visible && !paused && !pref.matches && !document.hidden);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(canvas.current);
    pref.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      pref.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      engine.setActive(false);
    };
  }, [engine, paused]);
  useEffect(() => {
    engine?.setFocus({
      selected: null,
      hovered: null,
      emphasis: new Set([selected]),
    });
    engine?.setStageActivity(receipts, reached, transferring);
  }, [engine, selected, receipts, reached, transferring]);
  return (
    <div
      className={css.field}
      role="group"
      aria-label="Specialist field"
      data-renderer={engine ? "webgl" : "static"}
    >
      <HandoffBackdrop warm={false} />
      <div
        className={css.viewport}
        data-zoomed={zoom > 1}
        onPointerDown={(e) => {
          if (zoom > 1 && e.pointerType === "mouse" && e.button === 0)
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              left: e.currentTarget.scrollLeft,
              top: e.currentTarget.scrollTop,
            };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !(e.buttons & 1)) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) < 5) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.scrollTo(d.left - dx, d.top - dy);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className={css.scene}
          style={{ transform: `scale(${zoom})` }}
        >
          <canvas ref={canvas} className={css.membranes} aria-hidden="true" />
          <svg
            className={css.paths}
            aria-hidden="true"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {stages.slice(1).map((s, i) => {
              const a = stagePosition(i, narrow),
                b = stagePosition(i + 1, narrow);
              const x = a.x * 1000,
                y = a.y * 1000,
                dx = (b.x - a.x) * 1000,
                dy = (b.y - a.y) * 1000;
              return (
                <path
                  key={s.id}
                  data-reached={reached.has(s.id)}
                  d={`M${x},${y} q${dx * 0.48 + dy * 0.13},${dy * 0.5 - dx * 0.13} ${dx},${dy}`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {stages.map((s, i) => {
            const p = stagePosition(i, narrow),
              count = receipts.get(s.id) || 0;
            return (
              <button
                key={s.id}
                className={css.stage}
                onClick={() => select(s.id)}
                aria-label={s.title}
                aria-pressed={s.id === selected}
                style={
                  {
                    left: p.x * 100 + "%",
                    top: p.y * 100 + "%",
                    "--role": s.color,
                  } as CSSProperties
                }
              >
                <span className={css.stageCaption}>
                  <strong>
                    <i aria-hidden="true">{String(i + 1).padStart(2, "0")}</i>
                    {s.title}
                  </strong>
                  <small>
                    {phases[i]}
                    {count > 0 ? " · " + count + " tools" : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className={css.zoom} aria-label="Field controls" role="group">
        <button
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label="Zoom in"
          disabled={zoom >= 2}
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
        >
          <Plus size={13} />
        </button>
        <button aria-label="Fit view" onClick={() => setZoom(1)}>
          <Maximize size={13} />
        </button>
      </div>
    </div>
  );
}
