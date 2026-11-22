import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type FieldWindow, type ReliefHistory } from "./model";
import {
  makeReliefMesh,
  type Anchor,
  type ReliefMesh,
  type ReliefMode,
} from "./surface";
import {
  createReliefPainter,
  intermediate,
  projectSections,
  type ReliefProfile,
} from "./raster";
import styles from "../Overview.module.css";

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));

function labelPlacement(
  anchor: Anchor,
  compact: boolean,
  index: number,
  crowded: boolean,
) {
  const labelWidth = Math.min(
    compact ? 0.34 : 0.23,
    (anchor.name.length + (anchor.warm && !compact ? 11 : 0)) *
      (compact ? 0.0205 : 0.0083),
  );
  let left = anchor.low
    ? anchor.x + (compact ? 0.025 : 0.045)
    : anchor.x - (compact ? 0.074 : 0.085) - labelWidth * 0.52;
  if (!compact && anchor.warm) left = anchor.x - labelWidth - 0.034;
  left = clamp(left, compact ? 0.035 : 0.025, 0.98 - labelWidth);
  const minY = compact ? 0.12 : 0.135;
  let top = anchor.low
    ? clamp(anchor.y + (compact ? 0.135 : 0.15), 0.78, 0.94)
    : clamp(
        anchor.y -
          (index === 0 && !anchor.warm ? 0.272 : compact ? 0.155 : 0.174),
        minY,
        0.81,
      );
  if (compact && crowded && index % 2) top = clamp(top - 0.075, minY, 0.92);
  const elbow = anchor.low
    ? Math.max(anchor.x + 0.013, left - 0.013)
    : Math.min(anchor.x - 0.009, left + labelWidth + 0.009);
  return { left, top, elbow, labelWidth };
}

// Test against the cut faces themselves. The system labels supply the same
// action through a larger touch target and native keyboard controls.
function materialAt(mesh: ReliefMesh, x: number, y: number) {
  for (let i = mesh.slices.length - 1; i >= 0; i--) {
    const slice = mesh.slices[i];
    let left = 0,
      right = mesh.columns - 1;
    while (right - left > 1) {
      const middle = (left + right) >> 1;
      if (slice.x[middle] < x) left = middle;
      else right = middle;
    }
    const t = (x - slice.x[left]) / (slice.x[right] - slice.x[left]);
    const top = slice.y[left] + t * (slice.y[right] - slice.y[left]);
    const skirt = 0.017 + 0.051 * (1 - i / (mesh.slices.length - 1));
    if (y >= top && y <= top + skirt) return true;
  }
  return false;
}

function CanvasFallback({ mesh }: { mesh: ReliefMesh }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 500"
      preserveAspectRatio="none"
      className={styles.fallback}
    >
      {mesh.slices
        .filter((_, i) => i % 4 === 0)
        .map((line, i) => {
          const path = Array.from(
            line.x,
            (x, j) =>
              (j ? "L" : "M") +
              (x * 1000).toFixed(1) +
              "," +
              (line.y[j] * 500).toFixed(1),
          ).join(" ");
          return (
            <path
              key={i}
              d={path + " L1100,560 L-100,560 Z"}
              fill={`rgb(${26 + i * 2},${33 + i * 2},${62 + i * 2})`}
              stroke="#a2a8bc"
              strokeWidth=".8"
            />
          );
        })}
    </svg>
  );
}

export default function ReliefPlot({
  history,
  frame,
  mode,
  inspect,
}: {
  history: ReliefHistory;
  frame: FieldWindow;
  mode: ReliefMode;
  inspect: (system: string, button?: HTMLElement) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const displayed = useRef<{
    from?: ReliefProfile;
    target: ReliefProfile;
    t: number;
  } | null>(null);
  const engine = useRef<ReturnType<typeof createReliefPainter>>(null);
  const moving = useRef<ReturnType<typeof createReliefPainter>>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);
  const [fallback, setFallback] = useState(false);
  const compact = size.w > 0 && size.w <= 640;
  const mesh = useMemo(
    () => (size.w ? makeReliefMesh(history, frame, mode, compact) : null),
    [history, frame, mode, compact, Boolean(size.w)],
  );

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const resize = () => {
      const w = Math.round(element.clientWidth),
        h = Math.round(element.clientHeight);
      setSize((prior) => (w === prior.w && h === prior.h ? prior : { w, h }));
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionPreference = () => setReduced(media.matches);
    resize();
    motionPreference();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    media.addEventListener("change", motionPreference);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", motionPreference);
    };
  }, []);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !mesh || !size.w || !size.h || fallback) return;
    const ctx = element.getContext("2d", { alpha: true });
    if (!ctx) {
      setFallback(true);
      return;
    }
    // Match the CSS size while bounding texture memory on high-density screens.
    const density = Math.min(window.devicePixelRatio || 1, 1.55, 2100 / size.w);
    const width = Math.round(size.w * density),
      height = Math.round(size.h * density);
    const resized = element.width !== width || element.height !== height;
    if (resized) {
      element.width = width;
      element.height = height;
    }
    // Interaction uses fewer samples while the surface is moving. The last
    // frame is always redrawn at full display resolution, including replay.
    const moveWidth = Math.min(width, 820);
    const moveHeight = Math.max(1, Math.round((height * moveWidth) / width));
    if (!engine.current || resized) {
      engine.current = createReliefPainter(ctx, width, height, density);
      moving.current =
        moveWidth === width
          ? engine.current
          : createReliefPainter(
              ctx,
              moveWidth,
              moveHeight,
              (density * moveWidth) / width,
            );
    }
    const draw = engine.current;
    if (!draw) {
      setFallback(true);
      return;
    }
    const drawMove = moving.current ?? draw;
    const target = projectSections(mesh, moveWidth);
    const last = displayed.current;
    const from =
      last &&
      (last.from ? intermediate(last.from, last.target, last.t) : last.target);
    const finish = () => {
      draw(moveWidth === width ? target : projectSections(mesh, width));
      displayed.current = { target, t: 1 };
      element.dataset.paintState = "settled";
    };
    if (
      !from ||
      resized ||
      reduced ||
      document.hidden ||
      from.width !== moveWidth ||
      from.rows !== target.rows
    ) {
      finish();
      return;
    }
    element.dataset.paintState = "transitioning";
    let handle = 0;
    const started = performance.now();
    const animate = (now: number) => {
      if (now - started >= 530 || document.hidden) {
        finish();
        return;
      }
      const progress = clamp((now - started) / 530, 0, 1);
      const t = progress * progress * (3 - 2 * progress);
      drawMove(target, from, t);
      displayed.current = { from, target, t };
      handle = requestAnimationFrame(animate);
    };
    const stopIfHidden = () => {
      if (document.hidden) {
        cancelAnimationFrame(handle);
        finish();
      }
    };
    document.addEventListener("visibilitychange", stopIfHidden);
    handle = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(handle);
      document.removeEventListener("visibilitychange", stopIfHidden);
    };
  }, [mesh, size, reduced, fallback]);

  // Native controls stay operable without canvas. All leaders use the exact
  // projected sample of the labelled system even at narrow aspect ratios.
  const [entered, setEntered] = useState("");
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const ridgeAt = (clientX: number, clientY: number) => {
    if (!root.current || !mesh) return undefined;
    const bounds = root.current.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width,
      y = (clientY - bounds.top) / bounds.height;
    if (!materialAt(mesh, x, y)) return undefined;
    return mesh.anchors.reduce<Anchor | undefined>(
      (best, anchor) =>
        !best || Math.abs(x - anchor.x) < Math.abs(x - best.x) ? anchor : best,
      undefined,
    );
  };
  useEffect(() => {
    setEntered("");
  }, [frame.id, mode]);
  return (
    <div
      ref={root}
      className={styles.plot}
      data-operational-relief
      data-mode={mode}
      data-epoch={frame.id}
      onPointerMove={(event) => {
        if (
          event.pointerType !== "mouse" ||
          (event.target as Element).closest("button")
        )
          return;
        setEntered(ridgeAt(event.clientX, event.clientY)?.name ?? "");
      }}
      onPointerLeave={() => setEntered("")}
      onClick={(event) => {
        if ((event.target as Element).closest("button")) return;
        const anchor = ridgeAt(event.clientX, event.clientY);
        if (anchor) inspect(anchor.name, controls.current.get(anchor.name));
      }}
      style={{ cursor: entered ? "pointer" : undefined }}
    >
      {fallback && mesh ? (
        <CanvasFallback mesh={mesh} />
      ) : (
        <canvas data-relief-surface ref={canvas} aria-hidden="true" />
      )}
      {mesh && (
        <>
          <svg
            aria-hidden="true"
            className={styles.leaders}
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
          >
            {mesh.anchors.map((a, i) => {
              const label = labelPlacement(
                a,
                compact,
                i,
                mesh.anchors.length > 4,
              );
              const ly = label.top * size.h + (compact ? 17 : 22);
              return (
                <g
                  key={a.name}
                  data-warm={a.warm}
                  data-hover={entered === a.name}
                >
                  <path
                    d={`M ${(label.left + 0.003) * size.w} ${ly} H ${label.elbow * size.w} L ${a.x * size.w} ${a.y * size.h}`}
                  />
                  <circle
                    cx={a.x * size.w}
                    cy={a.y * size.h}
                    r={compact ? 2.6 : 3.6}
                  />
                </g>
              );
            })}
          </svg>
          {mesh.anchors.map((anchor, i) => {
            const label = labelPlacement(
              anchor,
              compact,
              i,
              mesh.anchors.length > 4,
            );
            const sys = frame.systems.find(
              (item) => item.name === anchor.name,
            )!;
            return (
              <button
                type="button"
                key={anchor.name}
                className={styles.callout}
                data-relief-system={anchor.name}
                data-warm={anchor.warm}
                data-hover={entered === anchor.name}
                ref={(button) => {
                  if (button) controls.current.set(anchor.name, button);
                  else controls.current.delete(anchor.name);
                }}
                style={{
                  left: 100 * label.left + "%",
                  top: 100 * label.top + "%",
                }}
                onPointerEnter={() => setEntered(anchor.name)}
                onPointerLeave={() => setEntered("")}
                onFocus={() => setEntered(anchor.name)}
                onBlur={() => setEntered("")}
                onClick={(event) => inspect(anchor.name, event.currentTarget)}
                aria-haspopup="dialog"
                aria-label={`Inspect ${anchor.name} evidence, ${sys.count.toLocaleString("en-GB")} observed events${sys.interval ? ", " + sys.wait + " hour median for " + sys.interval.from + " to " + sys.interval.to : ""}`}
              >
                <span>{anchor.name}</span>
                {anchor.warm && !compact && <em> / {sys.wait} h</em>}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
