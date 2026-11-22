import type { FieldWindow, ReliefHistory } from "./model";

export type ReliefMode = "flow" | "volume";
export type Point = { x: number; y: number };
export type Anchor = Point & { name: string; warm: boolean; low: boolean };
type Ridge = {
  name: string;
  x: number;
  z: number;
  width: number;
  amplitude: number;
  pressure: number;
  balance: number;
};
type Slice = {
  x: Float32Array;
  y: Float32Array;
  pigment: Uint8Array;
  edge: Uint8Array;
};
export type ReliefMesh = {
  slices: Slice[];
  anchors: Anchor[];
  columns: number;
};

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const paper = [224, 216, 204];
const palette = [
  [10, 13, 27],
  [22, 30, 60],
  [47, 59, 98],
  [104, 116, 150],
  [179, 181, 193],
  paper,
];

function material(shade: number) {
  const index = clamp(shade, 0, 0.9999) * (palette.length - 1);
  const a = Math.floor(index),
    fraction = index - a;
  return palette[a].map((channel, i) =>
    lerp(channel, palette[a + 1][i], fraction),
  );
}

function ridges(
  history: ReliefHistory,
  frame: FieldWindow,
  mode: ReliefMode,
): Ridge[] {
  const n = history.peaks.length;
  return history.peaks.map((name, i) => {
    const system = frame.systems.find((s) => s.name === name)!;
    const x =
      n === 4
        ? [0.098, 0.395, 0.568, 0.849][i]
        : n === 1
          ? 0.65
          : 0.095 + (0.795 * i) / (n - 1);
    const z =
      n === 4 ? [0.63, 0.29, 0.72, 0.24][i] : 0.34 + 0.19 * Math.cos(i * 2.43);
    const pressure = history.maxWait
      ? clamp(system.wait / history.maxWait, 0, 1.42)
      : 0;
    const volume = history.maxRate
      ? clamp(system.rate / history.maxRate, 0, 1.42)
      : 0;
    const crossings = system.count
      ? clamp((system.arrivals + system.departures) / (2 * system.count))
      : 0;
    const amplitude =
      mode === "flow"
        ? 0.495 * Math.pow(pressure, 1.12) +
          0.145 * crossings ** 2 +
          0.034 * Math.sqrt(volume)
        : 0.59 * Math.pow(volume, 0.94) + 0.038 * crossings;
    const transfers = system.arrivals + system.departures;
    const balance = transfers
      ? (system.arrivals - system.departures) / transfers
      : 0;
    return {
      name,
      x,
      z,
      amplitude,
      pressure,
      balance,
      width:
        (0.36 / Math.max(2, n) + 0.046) * (0.91 + 0.18 * Math.sqrt(volume)),
    };
  });
}

// Orthographic section through a relief. Each lobe has a stable location and
// stretches with its measured event rate, handoff share and arriving intervals.
function sample(
  u: number,
  section: number,
  features: Ridge[],
  foldAt?: number,
) {
  const envelope = Math.sin(Math.PI * section);
  // The cut planes crowd together where traffic and delay form the strongest
  // saddle. A shear in depth exposes the underside of the folded surface.
  const saddle =
    foldAt === undefined ? 0 : Math.exp(-(((u - foldAt) / 0.09) ** 2));
  const v =
    section +
    envelope *
      (0.105 * Math.sin(7.8 * section + 7.6 * u + 1.25 * Math.sin(6.7 * u)) +
        0.055 * Math.sin(12.7 * section - 10.2 * u) +
        (0.48 - section) * saddle * 0.89);
  const sv = Math.sin(Math.PI * v);
  const projectedX =
    u +
    0.05 * sv * Math.sin(5.2 * u - 3.6 * v) +
    0.028 * (v - 0.5) * Math.cos(6.1 * u);
  const shelf =
    0.064 +
    0.029 * Math.sin(8.8 * u - 3.2 * v) +
    0.012 * Math.sin(20 * u + 5 * v);
  let height = shelf;
  for (const [i, ridge] of features.entries()) {
    const dv = v - ridge.z;
    const crest =
      ridge.x +
      0.113 * dv * Math.cos(i * 1.63 + 0.32) +
      0.039 * Math.sin(dv * 6 - i) * sv;
    const delta = u - crest;
    const dx = delta / (ridge.width * (delta < 0 ? 0.94 : 1.31));
    const dz = dv / (0.48 + 0.06 * Math.sin(i + 0.9));
    const profile = Math.exp(-1.08 * dx * dx - 0.98 * dz * dz);
    const facet =
      1 +
      0.046 * Math.sin(36 * u + 1.4 * Math.sin(10.5 * u + 1.7 * v) + 3.9 * v) +
      0.023 * Math.sin(62 * u - 3.5 * v + 0.9 * Math.cos(i + v * 9));
    const bentFold =
      ridge.balance * 0.071 * Math.sin((dv + 0.4) * 8.1 - dx * 2) * profile;
    height += ridge.amplitude * profile * facet + bentFold;
  }
  const fold =
    0.023 * Math.sin(28 * u - 7.8 * v + 1.5 * Math.sin(11 * u + 2.3 * v)) +
    0.011 * Math.sin(50 * u + 11.5 * v - 1.6 * Math.cos(8.8 * u));
  height +=
    fold * (0.38 + 1.65 * height) + 0.009 * Math.sin(16.7 * v + 8.6 * u) * sv;
  const lamina =
    Math.PI *
    2 *
    (section * 8.8 +
      0.44 * Math.cos(11.8 * u - 4 * section) +
      0.27 * Math.sin(6 * u + 9 * section));
  height +=
    (0.003 + 0.011 * section ** 1.55) *
    (Math.sin(lamina) + 0.25 * Math.sin(2 * lamina));
  const ground =
    0.656 +
    0.353 * v -
    0.064 * u +
    (0.086 * Math.exp(-(((u - 0.54) / 0.18) ** 2)) +
      0.06 * (1 - u) ** 2 -
      0.052 * u) *
      v ** 2 +
    0.05 * Math.sin(8.4 * u - 1.3 * v + 0.4) +
    0.031 * Math.sin(16.9 * u - 2.1 * v);
  return { x: projectedX, y: ground - height, h: height };
}

export function makeReliefMesh(
  history: ReliefHistory,
  frame: FieldWindow,
  mode: ReliefMode,
  compact: boolean,
): ReliefMesh {
  const features = ridges(history, frame, mode);
  const heat =
    mode === "flow"
      ? features.reduce<Ridge | undefined>(
          (a, b) => (!a || b.pressure > a.pressure ? b : a),
          undefined,
        )
      : undefined;
  const hot = heat && heat.pressure > 0 ? heat : undefined;
  const pin =
    hot &&
    sample(hot.x - hot.width * 0.77, 0.51, features, hot.x - hot.width * 0.82);
  const columns = compact ? 145 : 237,
    rows = compact ? 83 : 105;
  const start = -0.105,
    span = 1.21,
    du = span / (columns - 1),
    dv = 1 / (rows - 1);
  const heights = new Float32Array(rows * columns);
  const slices = Array.from({ length: rows }, (_, row) => {
    const v = row * dv,
      x = new Float32Array(columns),
      y = new Float32Array(columns);
    for (let col = 0; col < columns; col++) {
      const point = sample(
        start + col * du,
        v,
        features,
        hot && hot.x - hot.width * 0.82,
      );
      x[col] = point.x;
      y[col] = point.y;
      heights[row * columns + col] = point.h;
    }
    return {
      x,
      y,
      pigment: new Uint8Array(columns * 3),
      edge: new Uint8Array(columns * 3),
    };
  });
  for (let row = 0; row < rows; row++) {
    const v = row * dv,
      slice = slices[row];
    const near = Math.min(row + 1, rows - 1),
      far = Math.max(0, row - 1);
    for (let col = 0; col < columns; col++) {
      const i = row * columns + col,
        u = start + col * du;
      const left = Math.max(0, col - 1),
        right = Math.min(columns - 1, col + 1);
      const nx =
        (-0.69 *
          (heights[row * columns + right] - heights[row * columns + left])) /
        ((right - left) * du);
      const nz =
        (-1.65 *
          (heights[near * columns + col] - heights[far * columns + col])) /
        ((near - far) * dv);
      const length = Math.hypot(nx, 1, nz);
      const diffuse = clamp((-0.59 * nx + 0.74 + 0.33 * nz) / length);
      const specular = clamp((-0.34 * nx + 0.81 + 0.47 * nz) / length) ** 13;
      const cavity = clamp(heights[i] * 1.65);
      const satin =
        0.046 * Math.sin(v * 22 + u * 6.2 + 3 * Math.sin(8.9 * u - v * 4.3));
      const shade =
        0.022 +
        0.49 * diffuse +
        0.4 * specular +
        0.053 / length +
        satin -
        0.052 * cavity;
      const base = material(shade);
      let warmth = 0;
      if (hot && pin) {
        // Light the visible cut at the pressure sample. Projected distance
        // keeps the copper crease legible where a nearer fold overlaps it.
        const dx = slice.x[col] - pin.x;
        const dy =
          slice.y[col] - (pin.y - 0.62 * dx - 0.025 * Math.sin(25 * dx));
        warmth =
          Math.min(1, hot.pressure) *
          Math.exp(
            -((dx / 0.109) ** 2 + (dy / (0.039 + Math.abs(dx) * 0.17)) ** 2),
          );
      }
      const lip = 0.14 + 0.31 * diffuse + 0.23 * specular;
      const linen = clamp((v - 0.84) / 0.16) ** 1.35;
      for (let c = 0; c < 3; c++) {
        const mineral = clamp(
          0.4 - (0.55 * nx) / length + 0.24 * Math.sin(u * 14 + v * 9),
        );
        const cool = lerp(
          base[c] + [-3, 2, 19][c] * mineral,
          paper[c],
          linen * (0.42 + 0.32 * diffuse),
        );
        const hotBody = [
          164 + 50 * diffuse,
          60 + 38 * diffuse,
          36 + 30 * diffuse,
        ][c];
        const hotEdge = [255, 153 + 42 * diffuse, 98 + 38 * diffuse][c];
        slice.pigment[3 * col + c] = lerp(cool, hotBody, warmth * 0.93);
        slice.edge[3 * col + c] = lerp(
          lerp(cool, [209, 217, 229][c], lip),
          hotEdge,
          warmth,
        );
      }
    }
  }
  const anchors = features.map((ridge, i) => {
    const warm = hot?.name === ridge.name;
    const low = !warm && i > 0 && i % 2 === 0;
    const pos = sample(
      ridge.x - (warm ? ridge.width * 0.77 : 0),
      warm ? 0.51 : low ? 0.94 : ridge.z + 0.12,
      features,
      hot && hot.x - hot.width * 0.82,
    );
    return { name: ridge.name, x: pos.x, y: pos.y, warm, low };
  });
  return { slices, anchors, columns };
}
