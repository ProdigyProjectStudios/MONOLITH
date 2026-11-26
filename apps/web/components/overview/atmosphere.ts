/* Page atmosphere for the Overview: motes flow along sweeping green and blue
   ribbons behind the header and along the bottom edge.

   The particle set and the ribbon's lit surface are generated once per size and
   cached. Each frame only the motes are redrawn, advanced along their path by
   the animation clock. Nothing is re-randomised per frame, so every mote travels
   in a smooth continuous line instead of reshuffling in place. */

type Particle = {
  /** Where the mote starts along the ribbon, 0..1. */
  u: number;
  /** Its offset across the ribbon width, 0..1 (0.5 is the bright core). */
  lane: number;
  /** Fixed jitter so the field reads as scattered rather than gridded. */
  jitter: number;
  size: number;
  alpha: number;
  /** Path length travelled per second, so motes do not move as one slab. */
  speed: number;
  glow: boolean;
};

type Ribbon = {
  x0: number;
  x1: number;
  /** Centre line as a fraction of height, for u in [0, 1]. */
  base: (u: number) => number;
  /** Thickness of the ribbon as a fraction of height. */
  spread: number;
  amp: number;
  color: [number, number, number];
  alpha: number;
  seed: number;
  /** Extra emphasis along the ribbon, for a brighter crest. */
  focus?: (u: number) => number;
  particles: Particle[];
};

function seededRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const bump = (c: number, w: number) => (u: number) => 0.45 + 1.1 * Math.exp(-Math.pow((u - c) / w, 2));

/* One smooth curve per ribbon, shared by the lit surface and the motes, so
   everything on a ribbon travels along the same line. */
function centre(r: Ribbon, u: number) {
  return r.base(u) + Math.sin(u * 7 + r.seed) * r.amp * 0.0016;
}

function laneOffset(r: Ribbon, u: number, lane: number) {
  const twist = 0.35 + 0.65 * Math.abs(Math.sin(u * 3.1 + r.seed));
  return (lane - 0.5) * r.spread * twist;
}

function buildRibbon(spec: Omit<Ribbon, "particles">, count: number): Ribbon {
  const rand = seededRandom(spec.seed * 7919 + 13);
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const lane = rand();
    const core = 1 - Math.abs(lane - 0.5) * 2;
    particles.push({
      u: rand(),
      lane,
      jitter: (rand() - 0.5) * 0.012,
      size: 0.7 + rand() * 1.1 * (0.4 + core),
      alpha: (0.2 + 0.8 * Math.pow(core, 1.5)) * (0.55 + 0.45 * rand()),
      speed: 0.009 + rand() * 0.013,
      glow: core > 0.55 && rand() > 0.45,
    });
  }
  return { ...spec, particles };
}

function ribbonSpecs(part: "top" | "bottom", narrow: boolean): Omit<Ribbon, "particles">[] {
  return part === "top"
    ? [
        {
          x0: narrow ? -0.1 : 0.34,
          x1: 1.08,
          base: (u) => 0.5 - 0.3 * Math.sin(Math.PI * Math.pow(u, 0.85)) + 0.06 * Math.sin(u * 9),
          spread: 0.3,
          amp: 10,
          color: [96, 238, 196],
          alpha: 1,
          seed: 1.3,
          focus: bump(0.62, 0.2),
        },
        {
          x0: narrow ? -0.1 : 0.5,
          x1: 1.1,
          base: (u) => 0.6 - 0.22 * Math.sin(Math.PI * u + 0.4),
          spread: 0.18,
          amp: 8,
          color: [120, 200, 240],
          alpha: 0.4,
          seed: 4.1,
        },
      ]
    : [
        {
          x0: -0.06,
          x1: 1.06,
          base: (u) => 0.62 - 0.14 * Math.sin(u * Math.PI * 2.1 + 0.5),
          spread: 0.34,
          amp: 9,
          color: [90, 232, 190],
          alpha: 0.9,
          seed: 2.7,
          focus: bump(0.7, 0.16),
        },
        {
          x0: -0.08,
          x1: 0.62,
          base: (u) => 0.48 - 0.1 * Math.sin(u * Math.PI * 1.4),
          spread: 0.2,
          amp: 7,
          color: [96, 238, 196],
          alpha: 0.35,
          seed: 6.2,
        },
      ];
}

/** Soft strokes that make a ribbon read as a lit surface. */
function drawSheen(ctx: CanvasRenderingContext2D, w: number, h: number, r: Ribbon, dpr: number) {
  const [cr, cg, cb] = r.color;
  ctx.lineWidth = 1.6 * dpr;
  for (let j = 0; j < 11; j++) {
    const lane = j / 10;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const x = (r.x0 + (r.x1 - r.x0) * u) * w;
      const y = (centre(r, u) + laneOffset(r, u, lane)) * h;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    const g = ctx.createLinearGradient(r.x0 * w, 0, r.x1 * w, 0);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
    g.addColorStop(0.55, `rgba(${cr},${cg},${cb},${0.11 * r.alpha})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.strokeStyle = g;
    ctx.stroke();
  }
}

function drawMotes(ctx: CanvasRenderingContext2D, w: number, h: number, r: Ribbon, time: number) {
  const [cr, cg, cb] = r.color;
  let fill = "";
  for (const p of r.particles) {
    // Advance along the path; the envelope hides the wrap at either end.
    const u = (p.u + time * p.speed) % 1;
    const env = Math.sin(Math.PI * u);
    const a = r.alpha * env * env * p.alpha * (r.focus ? r.focus(u) : 1);
    if (a < 0.02) continue;
    const x = (r.x0 + (r.x1 - r.x0) * (u + p.jitter)) * w;
    const y = (centre(r, u) + laneOffset(r, u, p.lane)) * h;
    const tint = `rgb(${cr},${cg},${cb})`;
    if (fill !== tint) {
      ctx.fillStyle = tint;
      fill = tint;
    }
    if (p.glow) {
      ctx.globalAlpha = a * 0.3;
      ctx.fillRect(x - p.size, y - p.size, p.size * 3, p.size * 3);
    }
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillRect(x, y, p.size, p.size);
  }
  // A few brighter motes ride the crest, on the same path.
  ctx.fillStyle = "rgb(226,255,245)";
  const step = Math.max(137, Math.floor(r.particles.length / 26));
  for (let i = 0; i < r.particles.length; i += step) {
    const p = r.particles[i];
    const u = (p.u + time * p.speed * 0.85) % 1;
    const env = Math.sin(Math.PI * u);
    const a = r.alpha * env * env * 0.5;
    if (a < 0.03) continue;
    const x = (r.x0 + (r.x1 - r.x0) * u) * w;
    const y = (centre(r, u) + laneOffset(r, u, p.lane)) * h;
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillRect(x, y, p.size * 1.3, p.size * 1.3);
  }
  ctx.globalAlpha = 1;
}

/** Lit surface plus particles, rebuilt only when the size or part changes. */
const scene = new WeakMap<HTMLCanvasElement, { key: string; base: HTMLCanvasElement; ribbons: Ribbon[] }>();

function sceneFor(
  host: HTMLCanvasElement,
  part: "top" | "bottom",
  w: number,
  h: number,
  dpr: number,
) {
  const key = `${part}:${w}x${h}`;
  const cached = scene.get(host);
  if (cached && cached.key === key) return cached;
  const narrow = host.clientWidth < 760;
  const scale = narrow ? 0.6 : 1;
  const ribbons = ribbonSpecs(part, narrow).map((r, i) =>
    buildRibbon(r, Math.round((i === 0 ? 2100 : 1000) * scale)),
  );
  const base = document.createElement("canvas");
  base.width = w;
  base.height = h;
  const ctx = base.getContext("2d");
  if (ctx) {
    ctx.globalCompositeOperation = "lighter";
    for (const r of ribbons) drawSheen(ctx, w, h, r, dpr);
  }
  const entry = { key, base, ribbons };
  scene.set(host, entry);
  return entry;
}

export function paintAtmosphere(canvas: HTMLCanvasElement, part: "top" | "bottom", time = 0) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const { base, ribbons } = sceneFor(canvas, part, w, h, dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  for (const r of ribbons) drawMotes(ctx, w, h, r, time);
  ctx.globalCompositeOperation = "source-over";
}
