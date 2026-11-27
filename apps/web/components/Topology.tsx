"use client";
import { AnimatePresence, MotionPanel } from "./WorkspaceMotion";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Crosshair, Focus, Info, Minus, Plus } from "lucide-react";
import {
  at,
  clamp,
  focused,
  homeCamera,
  makeScene,
  screen,
  zoomAt,
  type Camera,
  type FieldLink,
  type FieldSystem,
  type Point,
  type Route,
  type Scene,
} from "./field/scene";
import { useCamera, useSceneTransition } from "./field/movement";
import { observeSprites } from "./field/sprites";
import { paint, travel } from "./field/paint";
import styles from "./Topology.module.css";

export type { FieldLink, FieldSystem, FieldTone } from "./field/scene";
export type TopologyProps = {
  systems: FieldSystem[];
  links: FieldLink[];
  selected?: string;
  selectedLink?: string;
  onSelect?: (id: string) => void;
  onSelectLink?: (id: string) => void;
  focus?: string;
  focusRevision?: number;
  labels?: boolean;
  controls?: boolean;
  paused?: boolean;
  showTrafficVolume?: boolean;
  ariaLabel?: string;
  unit?: string;
};
function pathD(r: Route) {
  return `M ${r.a.x} ${r.a.y} C ${r.b.x} ${r.b.y} ${r.c.x} ${r.c.y} ${r.d.x} ${r.d.y}`;
}
function StaticField({ scene, view }: { scene: Scene; view: Camera }) {
  return (
    <svg
      className={styles.surface}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      aria-hidden="true"
    >
      <g
        transform={`translate(${scene.width / 2 + view.x} ${scene.height / 2 + view.y}) scale(${view.zoom}) translate(${-scene.width / 2} ${-scene.height / 2})`}
      >
        {scene.routes.map((r) => (
          <path
            key={r.key}
            d={pathD(r)}
            fill="none"
            stroke={`rgb(${r.colour})`}
            opacity=".57"
            strokeWidth={0.5 + r.strength}
          />
        ))}
        {scene.nodes.map((n) => (
          <g
            key={n.key}
            transform={`translate(${n.x},${n.y}) scale(${n.radius / 95}) rotate(-13)`}
            stroke={`rgb(${n.colour})`}
          >
            <path
              d="M-102 5 Q-92 -43 -39 -50 Q-14 -59 18 -40 Q68 -62 102 -13 Q113 16 69 41 Q47 54 12 45 Q-36 59 -78 37Z"
              fill="#192a23"
            />
            {Array.from({ length: 18 }, (_, i) => (
              <path
                key={i}
                transform={`translate(0,${(i - 9) * 4.5}) scale(${Math.sin((Math.PI * (i + 1)) / 20)} .30)`}
                d="M-104 0 Q-74 -39 -24 -29 Q11 -49 39 -31 Q78 -37 104 0 Q77 48 23 22 Q-17 46 -57 28 Q-89 24 -104 0Z"
                fill="none"
                opacity=".68"
                strokeWidth=".9"
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
const number = new Intl.NumberFormat("en-US");

export default function Topology({
  systems,
  links,
  onSelect,
  onSelectLink,
  selected,
  selectedLink,
  focus,
  focusRevision,
  labels = true,
  controls = true,
  paused = false,
  showTrafficVolume = false,
  ariaLabel = "Business topology. Select a system to inspect its events.",
  unit = "events",
}: TopologyProps) {
  const legendId = useId();
  const [showKey, setShowKey] = useState(false),
    [rovingNode, setRovingNode] = useState<string>(),
    [rovingLink, setRovingLink] = useState<string>();
  const root = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLCanvasElement>(null),
    motion = useRef<HTMLCanvasElement>(null);
  const [spriteRevision, setSpriteRevision] = useState(0);
  const [size, setSize] = useState({ width: 800, height: 360 });
  const [canvasReady, setCanvasReady] = useState(false),
    [visible, setVisible] = useState(false),
    [reduce, setReduce] = useState(true),
    [pageVisible, setPageVisible] = useState(true);
  const [hover, setHover] = useState<string>(),
    [nodeHover, setNodeHover] = useState<string>(),
    [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    view: Camera;
    didMove: boolean;
    node?: string;
  } | null>(null);
  const targetScene = useMemo(
    () => makeScene(systems, links, size.width, size.height),
    [systems, links, size],
  );
  const animate = !paused && !reduce && visible && pageVisible;
  const scene = useSceneTransition(targetScene, animate);
  const {
    view,
    move: moveCamera,
    glide,
    halt,
    live,
    destination,
  } = useCamera(animate);
  const denseNodes = scene.nodes.length > 12,
    denseEdges = scene.routes.length > 20;
  const leading = useMemo(
    () =>
      new Set(
        targetScene.nodes
          .slice()
          .sort((a, b) => b.count - a.count)
          .slice(0, targetScene.width < 540 ? 4 : 8)
          .map((n) => n.key),
      ),
    [targetScene],
  );
  const currentNode = scene.nodes.some((n) => n.key === rovingNode)
    ? rovingNode
    : scene.nodes[0]?.key;
  const currentLink = scene.routes.some((r) => r.key === rovingLink)
    ? rovingLink
    : scene.routes[0]?.key;
  const activeEdge = scene.routes.find(
    (r) => r.key === (hover ?? selectedLink),
  );
  useEffect(() => {
    if (!root.current) return;
    const el = root.current;
    const measure = () => {
      const b = el.getBoundingClientRect(),
        width = Math.max(1, Math.round(b.width)),
        height = Math.max(1, Math.round(b.height));
      setSize((v) =>
        v.width === width && v.height === height ? v : { width, height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io = new IntersectionObserver((entries) =>
      setVisible(entries[0]?.isIntersecting ?? true),
    );
    io.observe(el);
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const media = () => setReduce(mq.matches),
      shown = () => setPageVisible(!document.hidden);
    media();
    shown();
    mq.addEventListener("change", media);
    document.addEventListener("visibilitychange", shown);
    return () => {
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener("change", media);
      document.removeEventListener("visibilitychange", shown);
    };
  }, []);
  useEffect(() => {
    if (visible && pageVisible && canvasReady)
      return observeSprites(targetScene, () => setSpriteRevision((n) => n + 1));
  }, [targetScene, visible, pageVisible, canvasReady]);
  useEffect(() => {
    if (surface.current && visible && pageVisible)
      setCanvasReady(
        paint(surface.current, scene, view, selected, activeEdge?.key),
      );
  }, [
    scene,
    view,
    selected,
    activeEdge?.key,
    visible,
    pageVisible,
    spriteRevision,
  ]);
  const running =
    canvasReady &&
    animate &&
    !dragging &&
    scene.routes.length > 0;
  useEffect(() => {
    const c = motion.current;
    if (!c) return;
    if (!running) {
      const g = c.getContext("2d");
      g?.clearRect(0, 0, c.width, c.height);
      return;
    }
    let raf = 0,
      last = 0;
    const frame = (time: number) => {
      if (time - last >= (scene.routes.length > 50 ? 56 : 31)) {
        travel(c, scene, view, time, selected, activeEdge?.key, showTrafficVolume);
        last = time;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, view, scene, selected, activeEdge?.key, showTrafficVolume]);
  const focusScene = useRef(targetScene);
  focusScene.current = targetScene;
  const focusPresent =
    !!focus &&
    (targetScene.nodes.some((n) => n.key === focus) ||
      targetScene.routes.some((r) => r.key === focus));
  useEffect(() => {
    if (focus && focusPresent) {
      const v = focused(focus, focusScene.current);
      if (v) glide(v);
    }
  }, [focus, focusRevision, size, focusPresent, glide]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const b = el.getBoundingClientRect(),
        point = { x: e.clientX - b.left, y: e.clientY - b.top };
      const v = live.current;
      moveCamera(
        zoomAt(
          v,
          v.zoom * Math.exp(-clamp(e.deltaY, -120, 120) * 0.007),
          point,
          focusScene.current,
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [live, moveCamera]);
  const zoom = (sign: number) => {
    const v = destination.current;
    glide(
      zoomAt(
        v,
        v.zoom * (sign > 0 ? 1.27 : 1 / 1.27),
        { x: scene.width / 2, y: scene.height / 2 },
        scene,
      ),
    );
  };
  const focusItem = (key?: string) => {
    if (key) {
      const v = focused(key, scene);
      if (v) glide(v);
    }
  };
  function keys(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Home" || e.key === "0") {
      e.preventDefault();
      glide(homeCamera);
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      zoom(e.key === "-" ? -1 : 1);
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      glide({
        ...destination.current,
        x:
          destination.current.x +
          (e.key === "ArrowLeft" ? 32 : e.key === "ArrowRight" ? -32 : 0),
        y:
          destination.current.y +
          (e.key === "ArrowUp" ? 32 : e.key === "ArrowDown" ? -32 : 0),
      });
    }
    if (e.key === "Escape") {
      setHover(undefined);
      setShowKey(false);
    }
  }
  function cycle(
    e: KeyboardEvent<HTMLButtonElement>,
    kind: "node" | "link",
    i: number,
  ) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    e.preventDefault();
    e.stopPropagation();
    const list = kind === "node" ? scene.nodes : scene.routes,
      direction = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = list[(i + direction + list.length) % list.length].key;
    const el = root.current?.querySelector<HTMLButtonElement>(
      `[data-field-${kind}="${CSS.escape(next)}"]`,
    );
    el?.focus({ preventScroll: true });
  }
  function point(e: PointerEvent<HTMLDivElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function hit(p: Point) {
    const world = {
      x: (p.x - scene.width / 2 - view.x) / view.zoom + scene.width / 2,
      y: (p.y - scene.height / 2 - view.y) / view.zoom + scene.height / 2,
    };
    const n = scene.nodes.findLast(
      (n) =>
        Math.hypot(
          (world.x - n.x) / (n.radius * 1.08),
          (world.y - n.y) / (n.radius * 0.66),
        ) < 1,
    );
    if (n) return { node: n.key };
    if (!onSelectLink) return {};
    let dist = 8 / view.zoom,
      edge: string | undefined;
    for (const r of scene.routes) {
      for (let i = 0; i < 22; i++) {
        const a = at(r, i / 22),
          b = at(r, (i + 1) / 22),
          dx = b.x - a.x,
          dy = b.y - a.y,
          t = clamp(
            ((world.x - a.x) * dx + (world.y - a.y) * dy) /
              (dx * dx + dy * dy || 1),
            0,
            1,
          );
        const d = Math.hypot(world.x - a.x - t * dx, world.y - a.y - t * dy);
        if (d < dist) {
          dist = d;
          edge = r.key;
        }
      }
    }
    return { edge };
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (
      !e.isPrimary ||
      e.button !== 0 ||
      (e.target as Element).closest("button")
    )
      return;
    halt();
    const p = point(e);
    drag.current = { ...p, view, didMove: false, node: hit(p).node };
    setHover(undefined);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    const p = point(e),
      d = drag.current;
    if (d) {
      const dx = p.x - d.x,
        dy = p.y - d.y;
      if (!d.didMove && Math.hypot(dx, dy) < 4) return;
      d.didMove = true;
      setDragging(true);
      moveCamera({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
    } else if (
      (onSelect || onSelectLink) &&
      e.pointerType === "mouse" &&
      !(e.target as Element).closest("button")
    ) {
      const h = hit(p);
      setHover(h.edge);
      setNodeHover(h.node);
    }
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.didMove && e.type !== "pointercancel") {
      const h = hit(point(e));
      if (h.node) onSelect?.(h.node);
      else if (h.edge) onSelectLink?.(h.edge);
      e.currentTarget.focus({ preventScroll: true });
    }
  }
  const selection = selectedLink ?? selected;
  return (
    <div className={styles.frame}>
      <div
        ref={root}
        className={styles.field}
        role="group"
        tabIndex={0}
        aria-label={ariaLabel}
        data-topology-field=""
        data-zoom={view.zoom.toFixed(3)}
        data-zoomed={view.zoom > 1.01}
        data-dragging={dragging}
        data-hot={!!(nodeHover || hover)}
        onKeyDown={keys}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => {
          setHover(undefined);
          setNodeHover(undefined);
        }}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("button")) return;
          const b = e.currentTarget.getBoundingClientRect(),
            h = hit({ x: e.clientX - b.left, y: e.clientY - b.top });
          focusItem(h.node ?? h.edge);
        }}
      >
        <canvas
          ref={surface}
          data-field-surface=""
          className={styles.surface}
          aria-hidden="true"
        />
        {!canvasReady && <StaticField scene={scene} view={view} />}
        <canvas
          ref={motion}
          data-field-motion=""
          data-running={running}
          className={styles.surface}
          aria-hidden="true"
        />
        {scene.nodes.map((n, i) => {
          const p = screen(n, scene, view),
            dy = n.radius * view.zoom * (n.labelBelow ? 0.67 : -0.7);
          const visibleLabel =
            labels &&
            (!denseNodes ||
              selected === n.key ||
              (leading.has(n.key) && n.radius * view.zoom > 25));
          const side = n.labelBelow ? "below" : "above";
          const position = {
            left: p.x,
            // Labels anchor outside each volume. Retain their full two-line
            // caption when the compact viewport puts that anchor by an edge.
            top:
              p.y >= 0 && p.y <= scene.height
                ? clamp(
                    p.y + dy,
                    n.labelBelow ? 3 : 36,
                    scene.height - (n.labelBelow ? 36 : 3),
                  )
                : p.y + dy,
            "--node-colour": `rgb(${n.colour})`,
          } as CSSProperties;
          const detail = n.detail ?? `${number.format(n.count)} ${unit}`;
          const content = (
            <>
              <span className={styles.leader} />
              <span className={styles.nodeName}>{n.name}</span>
              <span className={styles.nodeDetail}>{detail}</span>
            </>
          );
          const shared = {
            "data-field-node": n.key,
            "data-side": side,
            "data-show": visibleLabel || nodeHover === n.key,
            "data-hovered": nodeHover === n.key,
            className: styles.label,
            style: position,
            title: `${n.name} · ${detail}`,
          };
          return onSelect ? (
            <button
              {...shared}
              key={n.key}
              type="button"
              aria-label={n.name}
              tabIndex={denseNodes && n.key !== currentNode ? -1 : 0}
              onKeyDown={(e) => {
                if (denseNodes) cycle(e, "node", i);
              }}
              aria-description={detail}
              aria-pressed={selected === n.key}
              onFocus={() => {
                if (denseNodes) setRovingNode(n.key);
                if (
                  p.x < 12 ||
                  p.x > scene.width - 12 ||
                  p.y < 10 ||
                  p.y > scene.height - 10
                )
                  focusItem(n.key);
              }}
              onClick={() => onSelect(n.key)}
            >
              {content}
            </button>
          ) : visibleLabel ? (
            <span {...shared} key={n.key}>
              {content}
            </span>
          ) : null;
        })}
        {onSelectLink &&
          scene.routes.map((r, i) => {
            const p = screen(at(r, 0.5), scene, view),
              text =
                r.label ??
                `${r.from.name} → ${r.to.name} · ${number.format(r.count)} handoffs`;
            return (
              <button
                key={r.key}
                type="button"
                data-field-link={r.key}
                className={styles.edgeKey}
                style={{ left: p.x, top: p.y }}
                tabIndex={denseEdges && currentLink !== r.key ? -1 : 0}
                onKeyDown={(e) => {
                  if (denseEdges) cycle(e, "link", i);
                }}
                aria-label={text}
                aria-pressed={selectedLink === r.key}
                onFocus={() => {
                  if (denseEdges) setRovingLink(r.key);
                  setHover(r.key);
                  if (
                    p.x < 12 ||
                    p.x > scene.width - 12 ||
                    p.y < 10 ||
                    p.y > scene.height - 10
                  )
                    focusItem(r.key);
                }}
                onBlur={() => setHover(undefined)}
                onClick={() => onSelectLink(r.key)}
              >
                {text}
              </button>
            );
          })}
        {activeEdge &&
          (() => {
            const p = screen(at(activeEdge, 0.53), scene, view);
            return (
              <span
                className={styles.edgeTip}
                aria-hidden="true"
                style={{
                  left: clamp(p.x, 72, scene.width - 72),
                  top: clamp(p.y - 19, 20, scene.height - 24),
                }}
              >
                {activeEdge.label ??
                  `${activeEdge.from.name} → ${activeEdge.to.name} · ${number.format(activeEdge.count)}`}
              </span>
            );
          })()}
        {!scene.nodes.length && (
          <span className={styles.empty}>No systems in this dataset</span>
        )}
        {controls && scene.nodes.length > 0 && (
          <div
            className={styles.tools}
            role="group"
            aria-label="Field controls"
          >
            <button
              type="button"
              title="Field key"
              aria-label="Field key"
              aria-expanded={showKey}
              aria-controls={legendId}
              onClick={() => setShowKey((open) => !open)}
            >
              <Info />
            </button>
            <button
              type="button"
              title="Zoom out"
              aria-label="Zoom out"
              disabled={view.zoom <= 0.581}
              onClick={() => zoom(-1)}
            >
              <Minus />
            </button>
            <button
              type="button"
              title="Zoom in"
              aria-label="Zoom in"
              disabled={view.zoom >= 3.999}
              onClick={() => zoom(1)}
            >
              <Plus />
            </button>
            {selection && (
              <button
                type="button"
                aria-label="Focus selection"
                title="Focus selection"
                onClick={() => focusItem(selection)}
              >
                <Focus />
              </button>
            )}
            <button
              type="button"
              title="Recenter field"
              aria-label="Recenter field"
              onClick={() => glide(homeCamera)}
            >
              <Crosshair />
            </button>
          </div>
        )}
      </div>
      <AnimatePresence>
        {controls && showKey && (
          <MotionPanel
            as="aside"
            kind="side"
            className={styles.encoding}
            role="region"
            aria-label="Field key"
            id={legendId}
          >
            <p>
              Size follows each node’s count. Folds deepen as inbound and outbound
              totals diverge.
            </p>
            <p>
              Arrows and moving markers trace the direction of aggregated
              observations in this window.
            </p>
            {(scene.nodes.some((n) => n.tone === "pressure") ||
              scene.routes.some((r) => r.tone === "pressure")) && (
              <span className={styles.pressure}>
                Amber marks measured pressure.
              </span>
            )}
            {(scene.nodes.some((n) => n.tone === "investigation") ||
              scene.routes.some((r) => r.tone === "investigation")) && (
              <span className={styles.investigation}>
                Violet marks an investigation.
              </span>
            )}
          </MotionPanel>
        )}
      </AnimatePresence>
    </div>
  );
}
export { Topology };
