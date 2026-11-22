export type FieldTone = "flow" | "pressure" | "investigation";
export type FieldSystem = {
  id?: string;
  name: string;
  count: number;
  tone?: FieldTone;
  detail?: string;
};
export type FieldLink = {
  id?: string;
  source: string;
  target: string;
  count: number;
  tone?: FieldTone;
  label?: string;
};
export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Node = FieldSystem &
  Point & {
    key: string;
    radius: number;
    colour: string;
    labelBelow: boolean;
    foldBand: number;
  };
export type Route = FieldLink & {
  key: string;
  from: Node;
  to: Node;
  a: Point;
  b: Point;
  c: Point;
  d: Point;
  colour: string;
  strength: number;
  seed: number;
};
export type Scene = {
  width: number;
  height: number;
  nodes: Node[];
  routes: Route[];
};
export const homeCamera: Camera = { x: 0, y: 0, zoom: 1 };
export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function sequence(h: number) {
  return () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
}
const mints = ["111,224,174", "102,216,198", "169,228,160", "117,211,194"];
export function colour(tone: FieldTone | undefined, i: number) {
  if (tone === "pressure") return "246,167,99";
  if (tone === "investigation") return "180,160,245";
  return mints[i % mints.length];
}
function position(index: number, total: number, w: number, h: number): Point {
  const narrow = w < 540;
  const seeds = narrow
    ? [
        [0.27, 0.35],
        [0.7, 0.29],
        [0.72, 0.66],
        [0.27, 0.72],
      ]
    : [
        [0.205, 0.51],
        [0.448, 0.305],
        [0.78, 0.49],
        [0.502, 0.735],
      ];
  if (total === 1) return { x: w * 0.5, y: h * 0.49 };
  if (total === 2) {
    const slot = index === 0 ? [0.28, 0.54] : [0.73, 0.42];
    return { x: w * slot[0], y: h * slot[1] };
  }
  if (total === 3) {
    const slots = narrow
      ? [
          [0.28, 0.33],
          [0.72, 0.46],
          [0.32, 0.72],
        ]
      : [
          [0.22, 0.55],
          [0.49, 0.34],
          [0.77, 0.61],
        ];
    return { x: w * slots[index][0], y: h * slots[index][1] };
  }
  if (total === 4) return { x: w * seeds[index][0], y: h * seeds[index][1] };
  const cols = Math.ceil(Math.sqrt((total * w) / h)),
    rows = Math.ceil(total / cols);
  const row = Math.floor(index / cols),
    span = Math.min(cols, total - row * cols);
  const x = (((index % cols) + 0.5) / span - 0.5) * 0.87 + 0.5;
  const y = ((row + 0.5) / rows - 0.5) * 0.79 + 0.49;
  return {
    x: w * (x + ((row % 2) - 0.5) * 0.023),
    y: h * (y + Math.sin(index * 1.7) * 0.023),
  };
}
export function makeScene(
  systems: FieldSystem[],
  links: FieldLink[],
  width: number,
  height: number,
): Scene {
  const max = systems.reduce((a, n) => Math.max(a, n.count), 1);
  const size = systems.length,
    narrow = width < 540;
  const radius =
    size <= 4
      ? Math.min(
          width * (narrow ? 0.176 : 0.124),
          height * (narrow ? 0.164 : 0.263),
        )
      : Math.min(
          (width / Math.ceil(Math.sqrt((size * width) / height))) * 0.42,
          (height /
            Math.ceil(size / Math.ceil(Math.sqrt((size * width) / height)))) *
            0.48,
        );
  const ids = new Set(systems.map((n) => n.id ?? n.name));
  const traffic = new Map<string, { incoming: number; outgoing: number }>();
  for (const e of links) {
    if (e.count <= 0 || !ids.has(e.source) || !ids.has(e.target)) continue;
    const out = traffic.get(e.source) ?? { incoming: 0, outgoing: 0 };
    out.outgoing += e.count;
    traffic.set(e.source, out);
    const inc = traffic.get(e.target) ?? { incoming: 0, outgoing: 0 };
    inc.incoming += e.count;
    traffic.set(e.target, inc);
  }
  const ordered = systems
    .slice()
    .sort((a, b) => (a.id ?? a.name).localeCompare(b.id ?? b.name, "en"));
  const nodes = ordered.map((n, i) => {
    const pos = position(i, size, width, height),
      key = n.id ?? n.name,
      flow = traffic.get(key);
    const foldBand = flow
      ? Math.round(
          (6 * Math.abs(flow.incoming - flow.outgoing)) /
            (flow.incoming + flow.outgoing),
        )
      : 0;
    return {
      ...n,
      ...pos,
      key,
      foldBand,
      colour: colour(n.tone, hash(key)),
      radius: radius * (0.68 + 0.32 * Math.sqrt(Math.max(0, n.count) / max)),
      labelBelow: pos.y > height * 0.6,
    };
  });
  const byId = new Map(nodes.map((n) => [n.key, n]));
  const maxLinks = links.reduce((a, e) => Math.max(a, e.count), 1);
  const routes: Route[] = [];
  links.forEach((e) => {
    const from = byId.get(e.source),
      to = byId.get(e.target);
    if (!from || !to || e.count <= 0) return;
    const key = e.id ?? e.source + "→" + e.target,
      seed = hash(key);
    const dx = to.x - from.x,
      dy = to.y - from.y,
      len = Math.max(1, Math.hypot(dx, dy));
    const tx = dx / len,
      ty = dy / len,
      nx = -ty,
      ny = tx;
    const a = {
      x: from.x + tx * from.radius * 0.42,
      y: from.y + ty * from.radius * 0.27,
    };
    const d = {
      x: to.x - tx * to.radius * 0.43,
      y: to.y - ty * to.radius * 0.28,
    };
    const bias = (0.09 + (seed % 100) / 580) * Math.min(len, width * 0.48);
    const b = {
      x: a.x + dx * 0.37 + nx * bias,
      y: a.y + dy * 0.12 + ny * bias,
    };
    const c = {
      x: d.x - dx * 0.36 + nx * bias * 0.82,
      y: d.y - dy * 0.13 + ny * bias * 0.82,
    };
    if (from === to) {
      a.x += from.radius * 0.48;
      d.x -= from.radius * 0.4;
      b.x += from.radius * 1.74;
      c.x -= from.radius * 1.45;
      b.y -= from.radius * 1.55;
      c.y -= from.radius * 1.86;
    }
    routes.push({
      ...e,
      key,
      seed,
      from,
      to,
      a,
      b,
      c,
      d,
      colour: colour(e.tone, 1),
      strength: Math.log1p(e.count) / Math.log1p(maxLinks),
    });
  });
  return { width, height, nodes, routes };
}
export function at(r: Route, t: number): Point {
  const s = 1 - t,
    a = s * s * s,
    b = 3 * s * s * t,
    c = 3 * s * t * t,
    d = t * t * t;
  return {
    x: r.a.x * a + r.b.x * b + r.c.x * c + r.d.x * d,
    y: r.a.y * a + r.b.y * b + r.c.y * c + r.d.y * d,
  };
}
export function screen(p: Point, s: Scene, v: Camera): Point {
  return {
    x: (p.x - s.width / 2) * v.zoom + s.width / 2 + v.x,
    y: (p.y - s.height / 2) * v.zoom + s.height / 2 + v.y,
  };
}
export function zoomAt(v: Camera, next: number, p: Point, s: Scene): Camera {
  const zoom = clamp(next, 0.58, 4),
    factor = zoom / v.zoom;
  return {
    zoom,
    x: p.x - s.width / 2 - (p.x - s.width / 2 - v.x) * factor,
    y: p.y - s.height / 2 - (p.y - s.height / 2 - v.y) * factor,
  };
}
export function focused(id: string, s: Scene): Camera | undefined {
  const n = s.nodes.find((n) => n.key === id),
    r = s.routes.find((r) => r.key === id);
  if (!n && !r) return;
  let centre: Point, zoom: number;
  if (n) {
    centre = n;
    zoom = clamp(
      Math.min(s.width / (n.radius * 4.5), s.height / (n.radius * 2.65)),
      1.32,
      3.2,
    );
  } else {
    centre = at(r!, 0.5);
    zoom = clamp(
      Math.min(
        s.width /
          (Math.abs(r!.from.x - r!.to.x) + r!.from.radius + r!.to.radius + 55),
        s.height /
          (Math.abs(r!.from.y - r!.to.y) + r!.from.radius + r!.to.radius + 45),
      ),
      0.75,
      2.6,
    );
  }
  return {
    zoom,
    x: (s.width / 2 - centre.x) * zoom,
    y: (s.height / 2 - centre.y) * zoom,
  };
}
