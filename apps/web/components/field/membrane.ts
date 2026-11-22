import { clamp, hash, sequence } from "./scene";

type Sample = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  fold: number;
};
const tau = Math.PI * 2;
const size = 320,
  cx = 160,
  cy = 120;
export type SpriteSpec = {
  key: string;
  id: string;
  colour: string;
  quality: number;
  foldBand: number;
  pressure: boolean;
};
type Surface = HTMLCanvasElement | OffscreenCanvas;

// A folded, closed surface sampled in three dimensions. Painter-sorted facets
// provide occlusion; the denser surface traces describe the same geometry.
export function* rasterize(
  canvas: Surface,
  spec: SpriteSpec,
): Generator<void, void> {
  const { id, colour, quality, foldBand, pressure } = spec;
  const rand = sequence(hash(id)),
    phase = rand() * tau,
    twist = 0.22 + rand() * 0.36;
  const tilt = -0.4 + rand() * 0.65,
    yaw = rand() * tau,
    pitch = 0.28 + rand() * 0.19;
  const cosTilt = Math.cos(tilt),
    sinTilt = Math.sin(tilt),
    cosPitch = Math.cos(pitch),
    sinPitch = Math.sin(pitch);
  const stretch = 0.92 + rand() * 0.15,
    ridgePhase = rand() * tau;
  const aspect = 0.8 + rand() * 0.33,
    cleft = -0.37 + rand() * 0.7,
    curl = (rand() - 0.5) * 0.78;
  const lobeCount = 2 + Math.floor(rand() * 3);
  // In/out imbalance deepens the existing folds in seven bounded steps. A
  // source-supported pressure annotation adds a localized crease.
  const imbalance = foldBand / 6,
    amplitude = 0.96 + 0.3 * imbalance;

  const vertices = (u: number, v: number) => {
    const cv = Math.cos(v),
      sv = Math.sin(v),
      cs = Math.cos(u),
      sn = Math.sin(u);
    const lobe =
      1 +
      0.22 * Math.cos(lobeCount * u + phase + 1.0 * sv) * cv * cv +
      0.13 * Math.sin(2 * u + phase - 1.4 * sv) * cv +
      0.072 * Math.cos(5 * u - 0.7 * phase) * cv * cv;
    const wrinkle =
      Math.sin(6 * u - 1.4 * sv + phase) * 0.024 * cv +
      0.021 * Math.cos(6 * v + 3 * u) * cv;
    const r = (lobe + wrinkle) * cv;
    const spun = u + yaw + twist * sv;
    const ex = r * Math.cos(spun),
      ez = r * Math.sin(spun);
    // Bend and locally pinch the shell, making folds grow continuously around
    // the volume rather than terminating at its silhouette.
    const groove = Math.exp(-Math.pow((ex - cleft + 0.12 * ez) * 2.6, 2));
    const saddle =
      Math.sin(3.8 * ex + ridgePhase) * 15 +
      20 * Math.sin(3.3 * ez + phase) * Math.cos(1.8 * ex);
    const pinch =
      1 - (0.43 + 0.16 * imbalance + (pressure ? 0.12 : 0)) * groove;
    const x =
      105 * stretch * ex + 11 * Math.sin(2 * v + phase) + curl * 24 * sv * sv;
    const crease = pressure
      ? 13 * Math.exp(-((ex - 0.24 * ez - cleft) ** 2) * 32) * cv * cv
      : 0;
    const y =
      55 * aspect * sv * pinch +
      saddle * amplitude +
      15 * Math.sin(2 * u + phase + 1.7 * sv) * cv * cv +
      11 * ex * ex -
      9 * ez * cv -
      crease;
    const z =
      69 * ez * (1 - 0.3 * groove) + 12 * Math.cos(2.7 * ex + phase) * sv;
    const py = -y * cosPitch + z * sinPitch,
      depth = z * cosPitch + y * sinPitch;
    return {
      x: cx + x * cosTilt - py * sinTilt,
      y: cy + x * sinTilt + py * cosTilt,
      z: depth,
      nx: ex,
      ny: sv * 0.9 - ez * 0.32,
      nz: ez * cosPitch + sv * sinPitch,
      fold: cs * 0.5 + sn * 0.5,
    };
  };
  const scale = quality === 2 ? 1.7 : quality === 1 ? 1.12 : 0.67;
  canvas.width = Math.ceil(size * scale);
  canvas.height = Math.ceil(240 * scale);
  const g = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!g) throw new Error("Canvas2D unavailable");
  g.scale(scale, scale);
  const tint = colour.split(",").map(Number);
  const rgb = (value: number, white = 0) =>
    `rgb(${tint.map((c) => Math.min(255, Math.round(c * value + white))).join(",")})`;
  const inks = Array.from({ length: 64 }, (_, n) =>
    rgb(0.049 + n * 0.0093, 2 + n * 0.031),
  );
  const faces: {
    a: Sample;
    b: Sample;
    c: Sample;
    d: Sample;
    depth: number;
    ink: number;
  }[] = [];
  const lats = quality === 2 ? 50 : quality === 1 ? 32 : 16,
    longs = quality === 2 ? 92 : quality === 1 ? 68 : 35;
  const rows: Sample[][] = [];
  for (let j = 0; j <= lats; j++) {
    const v = -Math.PI * 0.499 + (j / lats) * Math.PI * 0.998;
    const row: Sample[] = [];
    for (let i = 0; i < longs; i++) row.push(vertices((i / longs) * tau, v));
    rows.push(row);
    yield;
  }
  for (let j = 0; j < lats; j++) {
    for (let i = 0; i < longs; i++) {
      const k = (i + 1) % longs,
        a = rows[j][i],
        b = rows[j][k],
        c = rows[j + 1][k],
        d = rows[j + 1][i];
      const dx1 = b.x - a.x,
        dy1 = b.y - a.y,
        dz1 = b.z - a.z,
        dx2 = d.x - a.x,
        dy2 = d.y - a.y,
        dz2 = d.z - a.z;
      let nx = dy1 * dz2 - dz1 * dy2,
        ny = dz1 * dx2 - dx1 * dz2,
        nz = dx1 * dy2 - dy1 * dx2;
      const length = Math.max(0.01, Math.hypot(nx, ny, nz));
      nx /= length;
      ny /= length;
      nz /= length;
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const diffuse = Math.max(0, -0.4 * nx - 0.64 * ny + 0.21 * nz);
      const edge = Math.pow(1 - nz, 2),
        fine = Math.sin(j * 0.9 + (i / longs) * 15 + phase) * 0.04;
      const ink = Math.floor(
        clamp(0.055 + 0.69 * diffuse + 0.27 * edge + fine, 0, 1) * 63,
      );
      faces.push({ a, b, c, d, depth: (a.z + b.z + c.z + d.z) / 4, ink });
    }
    yield;
  }
  faces.sort((a, b) => a.depth - b.depth);
  yield;
  let painted = 0;
  for (const { a, b, c, d, ink } of faces) {
    if (painted++ % 48 === 0) yield;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(c.x, c.y);
    g.lineTo(d.x, d.y);
    g.closePath();
    g.fillStyle = inks[ink];
    g.fill();
    g.lineWidth = 0.56;
    g.strokeStyle = inks[ink];
    g.stroke();
  }
  // Closely spaced field lines reveal the ridges without drawing a wire cage.
  const bands = quality === 2 ? 59 : quality === 1 ? 39 : 22,
    samples = quality === 2 ? 132 : 80;
  g.lineCap = "round";
  for (let j = 0; j < bands; j++) {
    const base = -1.46 + ((j + 0.5) / bands) * 2.93;
    let prior: Sample | undefined;
    for (let i = 0; i <= samples; i++) {
      const u = (i / samples) * tau;
      const v = clamp(
        base +
          Math.cos(base) *
            (0.25 * Math.sin(u * 2 + phase + base * 2) +
              0.17 * Math.cos(u * 3 - 3.2 * base + phase) +
              0.033 * Math.sin(8 * u + ridgePhase + base * 3)),
        -1.55,
        1.55,
      );
      const p = vertices(u, v);
      if (prior && p.nz > -0.07 && prior.nz > -0.07) {
        const glint =
          Math.max(0, -0.37 * p.nx + 0.55 * p.ny) +
          0.7 * Math.pow(1 - clamp(p.nz, 0, 1), 2);
        const brightness = clamp(
          0.21 + glint * 0.78 + 0.1 * Math.sin(3 * u - base + phase),
          0.1,
          1.2,
        );
        g.strokeStyle = `rgba(${colour},${Math.min(0.95, (0.2 + brightness * 0.67) * (j % 4 === 0 ? 1.1 : 0.74))})`;
        g.lineWidth = (j % 4 === 0 ? 0.78 : 0.42) * (0.74 + brightness * 0.38);
        g.beginPath();
        g.moveTo(prior.x, prior.y);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
      prior = p;
    }
    yield;
  }
  const threads = quality === 2 ? 58 : quality === 1 ? 35 : 15;
  for (let i = 0; i < threads; i++) {
    let u = rand() * tau,
      v = (rand() - 0.5) * 2.5;
    g.strokeStyle = `rgba(${colour},${0.11 + rand() * 0.14})`;
    g.lineWidth = 0.38;
    g.beginPath();
    let pen = false;
    for (let k = 0; k < 34; k++) {
      const p = vertices(u, v);
      if (p.nz > 0.04) {
        if (pen) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
        pen = true;
      } else pen = false;
      u += 0.014 * Math.sin(v * 3 + phase) + 0.012;
      v += 0.019;
    }
    g.stroke();
    if (i % 4 === 0) yield;
  }
  const points = quality === 2 ? 13400 : quality === 1 ? 5600 : 1200;
  for (let i = 0; i < points; i++) {
    if (i % 96 === 0) yield;
    const u = rand() * tau,
      v = Math.asin(rand() * 2 - 1),
      p = vertices(u, v);
    if (p.nz < -0.12) continue;
    const rim = Math.pow(1 - clamp(p.nz, 0, 1), 2.4);
    const shine =
      0.1 +
      0.43 * rim +
      0.35 * Math.max(0, -p.nx * 0.43 + p.ny * 0.72) +
      rand() * 0.28;
    const fleck = rand(),
      r = fleck > 0.978 ? 1.26 : fleck > 0.9 ? 0.84 : 0.42 + rand() * 0.42;
    const ridgeBand = Math.pow(
      0.5 + 0.5 * Math.sin(3 * u + 1.7 * v + ridgePhase),
      4,
    );
    const grain = 0.3 + 0.7 * ridgeBand;
    let x = p.x,
      y = p.y;
    if (rim > 0.5 && fleck > 0.83) {
      const spread = 1 + rand() * 0.038;
      x = cx + (x - cx) * spread;
      y = cy + (y - cy) * spread;
    }
    g.fillStyle =
      fleck > 0.95 || (ridgeBand > 0.75 && fleck > 0.68)
        ? `rgba(226,249,231,${Math.min(1, shine * 1.7)})`
        : `rgba(${colour},${Math.min(1, shine * (0.81 + grain))})`;
    g.fillRect(x - r * 0.5, y - r * 0.5, r, r);
  }
}
