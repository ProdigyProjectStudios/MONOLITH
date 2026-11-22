"use client";

import { Canvas, useThree } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Color } from "three";
import styles from "./Topology.module.css";

export type TopologyProps = {
  systems: { name: string; count: number }[];
  links: { source: string; target: string; count: number }[];
  onSelect?: (name: string) => void;
  selected?: string;
};

type Point = [number, number, number];
type Segment = [Point, Point];
type Island = {
  name: string;
  count: number;
  colour: string;
  anchor: Point;
  handle: Point;
  mesh: Segment[];
  contours: Segment[];
  points: Point[];
  beacons: Point[];
};
type Route = {
  source: string;
  target: string;
  count: number;
  lines: Segment[];
  glints: Point[];
};

const width = 1000;
const height = 370;
const colours = [
  "#46d9f2",
  "#a680ff",
  "#efb164",
  "#44d9bd",
  "#7fb1ff",
  "#f48bb6",
];
const home: [number, number][] = [
  [-306, 5],
  [-85, 68],
  [268, 13],
  [47, -70],
];
const TAU = Math.PI * 2;

function randomSequence(text: string) {
  let state = 2166136261;
  for (const c of text) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function centre(index: number, count: number): [number, number] {
  if (count === 1) return [0, 0];
  if (count === 2)
    return [
      [-199, 4],
      [199, -4],
    ][index] as [number, number];
  if (count === 3)
    return [
      [-278, -1],
      [-17, 41],
      [264, -18],
    ][index] as [number, number];
  if (count === 4) return home[index];
  const columns = Math.ceil(Math.sqrt(count * 1.8));
  const rows = Math.ceil(count / columns);
  const row = Math.floor(index / columns);
  const length = Math.min(columns, count - row * columns);
  return [
    (((index % columns) + 0.5) / length - 0.5) * 850,
    (0.5 - (row + 0.5) / rows) * 285,
  ];
}

function islandFor(
  system: TopologyProps["systems"][number],
  index: number,
  total: number,
  maxCount: number,
): Island {
  const rand = randomSequence(system.name);
  const [cx, cy] = centre(index, total);
  const scale =
    (0.72 +
      0.29 * Math.sqrt(Math.max(0, system.count) / Math.max(1, maxCount))) *
    Math.min(1, 2.2 / Math.sqrt(total));
  const colour = colours[index % colours.length];
  const angle = rand() * 1.9 - 0.95;
  const phase = rand() * TAU;
  const mesh: Segment[] = [],
    contours: Segment[] = [],
    points: Point[] = [],
    beacons: Point[] = [];
  const ridge = (x: number, y: number) => Math.exp(-4.5 * (x * x + y * y));
  function project(radius: number, theta: number): Point {
    const edge =
      1 +
      0.13 * Math.sin(3 * theta + phase) +
      0.064 * Math.cos(5 * theta - phase);
    const px = radius * edge * Math.cos(theta),
      py = radius * edge * Math.sin(theta);
    const relief =
      0.61 * ridge(px + 0.28, py - 0.12) + 0.88 * ridge(px - 0.35, py + 0.03);
    const peak =
      scale *
      (62 * relief +
        6 * Math.sin(px * 9 + phase) * Math.cos(py * 6) * (1 - radius));
    const x = px * 140 * scale,
      y = py * 81 * scale;
    return [
      cx + x * Math.cos(angle) - y * Math.sin(angle),
      cy +
        (x * Math.sin(angle) + y * Math.cos(angle)) * 0.44 +
        peak -
        scale * 25,
      peak * 0.08,
    ];
  }
  const rings = 14,
    sectors = 52;
  let previous: Point[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const current: Point[] = [];
    for (let sector = 0; sector < sectors; sector++) {
      const fraction = (ring + (rand() - 0.5) * 0.47) / rings;
      const theta =
        ((sector +
          (rand() - 0.5) * 0.52 +
          0.31 * Math.sin(ring * 0.91 + phase)) /
          sectors) *
        TAU;
      const p = project(Math.max(0.02, fraction), theta);
      current.push(p);
      points.push(p);
      if (rand() > 0.969) beacons.push(p);
      if (ring && rand() > 0.05) mesh.push([p, previous[sector]]);
      if (ring && rand() > 0.33)
        mesh.push([p, previous[(sector + 1) % sectors]]);
    }
    for (let n = 0; n < sectors; n++) {
      (ring % 3 === 0 ? contours : mesh).push([
        current[n],
        current[(n + 1) % sectors],
      ]);
    }
    previous = current;
  }
  const handle = project(0.3, 1.8);
  return {
    ...system,
    colour,
    anchor: [cx, cy, 0],
    handle,
    mesh,
    contours,
    points,
    beacons,
  };
}

function routesFor(links: TopologyProps["links"], islands: Island[]): Route[] {
  const byName = new Map(islands.map((island) => [island.name, island]));
  return links.flatMap(({ source, target, count }) => {
    const from = byName.get(source),
      to = byName.get(target);
    if (!from || !to || from === to || count <= 0) return [];
    const rand = randomSequence(source + "→" + target);
    const lines: Segment[] = [],
      glints: Point[] = [];
    const arc = (rand() * 0.7 + 0.3) * (from.anchor[0] < to.anchor[0] ? -1 : 1);
    const strands = Math.min(5, 1 + Math.ceil(Math.log2(1 + count) / 2));
    for (let strand = 0; strand < strands; strand++) {
      const start = from.points[Math.floor(rand() * from.points.length)];
      const end = to.points[Math.floor(rand() * to.points.length)];
      const bend = arc * (18 + 28 * rand());
      let prev: Point = start;
      for (let step = 1; step <= 56; step++) {
        const t = step / 56;
        const pt: Point = [
          start[0] * (1 - t) + end[0] * t,
          start[1] * (1 - t) + end[1] * t + Math.sin(t * Math.PI) * bend,
          0,
        ];
        lines.push([prev, pt]);
        if (strand === 0 && step % 13 === 0) glints.push(pt);
        prev = pt;
      }
    }
    return [{ source, target, count, lines, glints }];
  });
}

const pointVertex = `
  uniform float pointSize;
  uniform float ratio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    gl_PointSize = pointSize * ratio;
  }`;
const pointFragment = `
  uniform vec3 colour;
  uniform float intensity;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.;
    float alpha = 1. - smoothstep(0.13, 1., r);
    gl_FragColor = vec4(colour, intensity * alpha);
    #include <colorspace_fragment>
  }`;

function Dots({
  points,
  colour,
  size,
  intensity,
}: {
  points: Point[];
  colour: string;
  size: number;
  intensity: number;
}) {
  const pos = useMemo(() => new Float32Array(points.flat()), [points]);
  const ratio = useThree((s) => s.viewport.dpr);
  const uniforms = useMemo(
    () => ({
      colour: { value: new Color(colour) },
      pointSize: { value: size },
      intensity: { value: intensity },
      ratio: { value: ratio },
    }),
    [colour, size, intensity, ratio],
  );
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={pointVertex}
        fragmentShader={pointFragment}
        transparent
        depthWrite={false}
        depthTest={false}
      />
    </points>
  );
}

function Lines({
  lines,
  colour,
  opacity,
}: {
  lines: Segment[];
  colour: string;
  opacity: number;
}) {
  const pos = useMemo(() => new Float32Array(lines.flat(2)), [lines]);
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={colour}
        transparent
        opacity={opacity}
        depthWrite={false}
        depthTest={false}
      />
    </lineSegments>
  );
}

function Field({
  islands,
  routes,
  selected,
}: {
  islands: Island[];
  routes: Route[];
  selected?: string;
}) {
  const viewport = useThree((s) => s.viewport);
  return (
    <group scale={[viewport.width / width, viewport.height / height, 0.01]}>
      {routes.map((r, i) => (
        <group key={i}>
          <Lines
            lines={r.lines}
            colour="#68afc2"
            opacity={
              selected && r.source !== selected && r.target !== selected
                ? 0.08
                : 0.33
            }
          />
          <Dots points={r.glints} colour="#a7ecf2" size={2.2} intensity={0.8} />
        </group>
      ))}
      {islands.map((island) => {
        const emphasis = selected && selected !== island.name ? 0.54 : 1;
        return (
          <group key={island.name}>
            <Lines
              lines={island.mesh}
              colour={island.colour}
              opacity={0.26 * emphasis}
            />
            <Lines
              lines={island.contours}
              colour={island.colour}
              opacity={0.53 * emphasis}
            />
            <Dots
              points={island.points}
              colour={island.colour}
              size={2.25}
              intensity={0.86 * emphasis}
            />
            <Dots
              points={island.beacons}
              colour={island.colour}
              size={7.1}
              intensity={0.24 * emphasis}
            />
            <Dots
              points={island.beacons}
              colour="#e7fcff"
              size={2.35}
              intensity={0.97 * emphasis}
            />
          </group>
        );
      })}
    </group>
  );
}

function segmentPath(lines: Segment[]) {
  return lines
    .map(
      ([a, b]) =>
        `M${a[0].toFixed(1)} ${(-a[1]).toFixed(1)}L${b[0].toFixed(1)} ${(-b[1]).toFixed(1)}`,
    )
    .join("");
}
function dotPath(points: Point[]) {
  return points
    .map((p) => `M${p[0].toFixed(1)} ${(-p[1]).toFixed(1)}h.01`)
    .join("");
}

function Fallback({
  islands,
  routes,
  selected,
}: {
  islands: Island[];
  routes: Route[];
  selected?: string;
}) {
  const shapes = useMemo(
    () =>
      islands.map((i) => ({
        name: i.name,
        colour: i.colour,
        mesh: segmentPath(i.mesh),
        contour: segmentPath(i.contours),
        points: dotPath(i.points),
        beacons: dotPath(i.beacons),
      })),
    [islands],
  );
  const paths = useMemo(
    () => routes.map((r) => ({ ...r, d: segmentPath(r.lines) })),
    [routes],
  );
  return (
    <svg
      className={styles.fallback}
      aria-hidden="true"
      viewBox="-500 -185 1000 370"
      preserveAspectRatio="none"
    >
      <g fill="none" strokeWidth=".8">
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            stroke="#75bacb"
            opacity={
              selected && p.source !== selected && p.target !== selected
                ? ".08"
                : ".34"
            }
          />
        ))}
        {shapes.map((s) => (
          <g
            key={s.name}
            stroke={s.colour}
            opacity={selected && s.name !== selected ? 0.54 : 1}
          >
            <path d={s.mesh} opacity=".31" />
            <path d={s.contour} opacity=".63" />
            <path
              d={s.points}
              strokeWidth="1.8"
              strokeLinecap="round"
              opacity=".87"
            />
            <path
              d={s.beacons}
              strokeWidth="6"
              strokeLinecap="round"
              opacity=".21"
            />
            <path
              d={s.beacons}
              stroke="#ecfcff"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

class CanvasBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function Topology({
  systems,
  links,
  onSelect,
  selected,
}: TopologyProps) {
  const islands = useMemo(() => {
    const max = Math.max(1, ...systems.map((s) => s.count));
    return systems.map((s, i) => islandFor(s, i, systems.length, max));
  }, [systems]);
  const routes = useMemo(() => routesFor(links, islands), [links, islands]);
  const [capable, setCapable] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      if (!probe) return;
      probe.getExtension("WEBGL_lose_context")?.loseContext();
      setCapable(true);
    } catch {
      /* The vector field remains available when graphics contexts are restricted. */
    }
  }, []);

  return (
    <div
      className={styles.map}
      role="group"
      aria-label="Business topology. Select a system to inspect its events."
    >
      {!systems.length && (
        <span className={styles.empty}>No systems in this dataset</span>
      )}
      {!ready && (
        <Fallback islands={islands} routes={routes} selected={selected} />
      )}
      {capable && (
        <div className={styles.layer} aria-hidden="true">
          <CanvasBoundary onError={() => setReady(false)}>
            <Canvas
              orthographic
              frameloop="demand"
              dpr={[1, 1.75]}
              camera={{ position: [0, 0, 100], near: 0.1, far: 200, zoom: 1 }}
              gl={{
                alpha: true,
                antialias: true,
                powerPreference: "low-power",
              }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
                setReady(true);
                gl.domElement.addEventListener(
                  "webglcontextlost",
                  () => {
                    setCapable(false);
                    setReady(false);
                  },
                  { once: true },
                );
              }}
            >
              <Field islands={islands} routes={routes} selected={selected} />
            </Canvas>
          </CanvasBoundary>
        </div>
      )}
      {islands.map((s) => {
        const position = {
          left: `${50 + (s.handle[0] / width) * 100}%`,
          top: `${50 - (s.handle[1] / height) * 100}%`,
          "--system-colour": s.colour,
        } as CSSProperties;
        const text = (
          <>
            <span className={styles.key} aria-hidden="true" />
            {s.name}
          </>
        );
        return onSelect ? (
          <button
            key={s.name}
            type="button"
            style={position}
            className={styles.label}
            onClick={() => onSelect(s.name)}
            aria-pressed={selected === s.name}
            title={`${s.name} · ${s.count.toLocaleString()} events`}
          >
            {text}
          </button>
        ) : (
          <span key={s.name} style={position} className={styles.label}>
            {text}
          </span>
        );
      })}
    </div>
  );
}
export { Topology };
