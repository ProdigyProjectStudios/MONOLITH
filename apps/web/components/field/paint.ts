import { cachedSprite, spriteSpec, spriteMode } from "./sprites";
import {
  at,
  clamp,
  sequence,
  type Scene,
  type Route,
  type Camera,
} from "./scene";

export function prepare(canvas: HTMLCanvasElement, scene: Scene) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(scene.width * dpr)),
    height = Math.max(1, Math.round(scene.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  return ctx;
}
function apply(g: CanvasRenderingContext2D, s: Scene, v: Camera) {
  g.translate(s.width / 2 + v.x, s.height / 2 + v.y);
  g.scale(v.zoom, v.zoom);
  g.translate(-s.width / 2, -s.height / 2);
}
function routePath(g: CanvasRenderingContext2D, r: Route) {
  g.beginPath();
  g.moveTo(r.a.x, r.a.y);
  g.bezierCurveTo(r.b.x, r.b.y, r.c.x, r.c.y, r.d.x, r.d.y);
}
function drawRoute(
  g: CanvasRenderingContext2D,
  r: Route,
  scale: number,
  dense: boolean,
  active: boolean,
  dim: boolean,
) {
  const strength = r.strength,
    rand = sequence(r.seed);
  g.save();
  g.globalAlpha = dim ? 0.22 : 1;
  routePath(g, r);
  g.strokeStyle = `rgba(${r.colour},${active ? 0.21 : 0.058})`;
  g.lineWidth = (active ? 10 : 5) * scale;
  g.stroke();
  g.strokeStyle = `rgba(${r.colour},${active ? 0.91 : 0.44})`;
  g.lineWidth = (0.42 + strength * 0.54) * scale;
  g.stroke();
  if (!dense) {
    const strands = Math.round(4 + strength * 8);
    for (let i = 0; i < strands; i++) {
      const j = (i + 0.5) / strands - 0.5,
        fac = (0.94 + rand() * 0.55) * scale;
      const fan = (r.from.radius * 0.27 + r.to.radius * 0.12) * j;
      const wig = (rand() - 0.5) * 0.12,
        phases = rand() * 6.28,
        steps = 42;
      g.beginPath();
      for (let k = 0; k <= steps; k++) {
        const t = k / steps,
          p = at(r, t),
          p2 = at(r, Math.min(1, t + 0.004)),
          dx = p2.x - p.x,
          dy = p2.y - p.y,
          L = Math.max(0.001, Math.hypot(dx, dy));
        const taper = Math.sin(Math.PI * t);
        const separation =
          (fan *
            (0.35 + taper * 0.9) *
            Math.sin(t * Math.PI * (1.25 + wig) + phases * 0.2) +
            Math.sin(t * 12 + phases) * 1.85 * taper) *
          fac;
        const x = p.x - (dy / L) * separation,
          y = p.y + (dx / L) * separation;
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.strokeStyle = `rgba(${r.colour},${(active ? 0.48 : 0.15) + rand() * 0.2})`;
      g.lineWidth = (0.28 + rand() * 0.4) * scale;
      g.stroke();
    }
  }
  const t = 0.46 + (r.seed % 21) / 100,
    p = at(r, t),
    q = at(r, t + 0.008),
    a = Math.atan2(q.y - p.y, q.x - p.x);
  g.translate(p.x, p.y);
  g.rotate(a);
  g.beginPath();
  g.moveTo(-3.3 * scale, -2.1 * scale);
  g.lineTo(1.9 * scale, 0);
  g.lineTo(-3.3 * scale, 2.1 * scale);
  g.lineWidth = 0.86 * scale;
  g.strokeStyle = `rgba(${r.colour},${active ? 0.97 : 0.76})`;
  g.stroke();
  g.restore();
}
// Keep selection and flow inspection available during the first worker batch.
function outline(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: string,
) {
  g.save();
  g.translate(x, y);
  g.scale(w / 320, h / 240);
  g.fillStyle = `rgba(${tint},.10)`;
  g.strokeStyle = `rgba(${tint},.52)`;
  g.lineWidth = 0.85;
  for (let i = 0; i < 7; i++) {
    const k = 1 - i * 0.103;
    g.beginPath();
    g.moveTo(-107 * k, 1 - 3 * i);
    g.bezierCurveTo(
      -110 * k,
      -24 - 3 * i,
      -42 * k,
      -65 + 1.3 * i,
      -13 * k,
      -47 + 1.1 * i,
    );
    g.bezierCurveTo(
      24 * k,
      -27 + 1.5 * i,
      95 * k,
      -45 + 2 * i,
      108 * k,
      -8 - i,
    );
    g.bezierCurveTo(109 * k, 26 - 4 * i, 41 * k, 58 - 6 * i, 9 * k, 48 - 4 * i);
    g.bezierCurveTo(
      -45 * k,
      30 - 3 * i,
      -100 * k,
      42 - 4 * i,
      -107 * k,
      1 - 3 * i,
    );
    if (!i) g.fill();
    g.stroke();
  }
  g.restore();
}
export function paint(
  canvas: HTMLCanvasElement,
  scene: Scene,
  view: Camera,
  selected?: string,
  link?: string,
) {
  const g = prepare(canvas, scene);
  if (!g) return false;
  const { width: w, height: h } = scene;
  g.fillStyle = "#080c0c";
  g.fillRect(0, 0, w, h);
  const ambient = g.createRadialGradient(
    w * 0.48,
    h * 0.54,
    8,
    w * 0.48,
    h * 0.54,
    w * 0.62,
  );
  ambient.addColorStop(0, "rgba(33,48,42,.52)");
  ambient.addColorStop(0.68, "rgba(17,27,23,.26)");
  ambient.addColorStop(1, "rgba(9,12,12,0)");
  g.fillStyle = ambient;
  g.fillRect(0, 0, w, h);
  const spacing = w < 500 ? 21 : 25;
  g.fillStyle = "rgba(151,178,162,.19)";
  for (let y = 12; y < h; y += spacing * 0.69) {
    for (let x = 9 + (y % spacing) * 0.18; x < w; x += spacing)
      g.fillRect(x, y, 0.72, 0.72);
  }
  g.save();
  apply(g, scene, view);
  const dense = scene.routes.length > 68,
    drawingScale = clamp(w / 840, 0.67, 1.5);
  const activeLink = scene.routes.find((r) => r.key === link);
  const activeNode = scene.nodes.some((n) => n.key === selected)
    ? selected
    : undefined;
  const adjacent = (r: Route) =>
    r.from.key === activeNode || r.to.key === activeNode;
  const nodeEndpoints = activeLink
    ? new Set([activeLink.from.key, activeLink.to.key])
    : undefined;
  const connected = new Set<string>();
  scene.routes.forEach((r) => {
    if (adjacent(r)) {
      connected.add(r.from.key);
      connected.add(r.to.key);
    }
  });
  const zNodes = scene.nodes.slice().sort((a, b) => a.y - b.y);
  for (const n of zNodes) {
    const r = n.radius;
    const glow = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 1.55);
    glow.addColorStop(0, `rgba(${n.colour},.115)`);
    glow.addColorStop(0.58, `rgba(${n.colour},.047)`);
    glow.addColorStop(1, `rgba(${n.colour},0)`);
    g.fillStyle = glow;
    g.fillRect(n.x - r * 1.6, n.y - r * 1.6, r * 3.2, r * 3.2);
  }
  const sorted = scene.routes
    .slice()
    .sort(
      (a, b) =>
        Number(a.key === link || adjacent(a)) -
          Number(b.key === link || adjacent(b)) || a.count - b.count,
    );
  for (const r of sorted)
    drawRoute(
      g,
      r,
      drawingScale,
      dense,
      r.key === link || adjacent(r),
      !!((activeLink && r.key !== link) || (activeNode && !adjacent(r))),
    );
  let detailed = 0;
  for (const [i, n] of zNodes.entries()) {
    const dim =
      (activeNode && n.key !== activeNode && !connected.has(n.key)) ||
      (nodeEndpoints && !nodeEndpoints.has(n.key));
    const r = n.radius,
      bodyW = 2.84 * r,
      bodyH = bodyW * 0.75;
    g.globalAlpha = dim ? 0.49 : 1;
    const spec = spriteSpec(n, scene.nodes.length, i),
      sprite = cachedSprite(spec);
    if (sprite) {
      g.drawImage(sprite, n.x - bodyW / 2, n.y - bodyH / 2, bodyW, bodyH);
      detailed++;
    } else outline(g, n.x, n.y, bodyW, bodyH, n.colour);
    g.globalAlpha = 1;
    if (activeNode === n.key || nodeEndpoints?.has(n.key)) {
      const rx = r * 1.16,
        ry = r * 0.71,
        arm = clamp(r * 0.09, 3, 8);
      g.strokeStyle = `rgba(${n.colour},.76)`;
      g.lineWidth = 0.77 / view.zoom;
      g.beginPath();
      for (const dx of [-1, 1])
        for (const dy of [-1, 1]) {
          const x = n.x + dx * rx,
            y = n.y + dy * ry;
          g.moveTo(x - dx * arm, y);
          g.lineTo(x, y);
          g.lineTo(x, y - dy * arm);
        }
      g.stroke();
    }
  }
  g.restore();
  canvas.dataset.fieldSprites = `${detailed}/${scene.nodes.length}`;
  canvas.dataset.fieldEngine = spriteMode();
  return true;
}
export function travel(
  canvas: HTMLCanvasElement,
  s: Scene,
  v: Camera,
  elapsed: number,
  selection?: string,
  link?: string,
) {
  const g = prepare(canvas, s);
  if (!g) return;
  g.save();
  apply(g, s, v);
  const routes =
    s.routes.length > 30
      ? s.routes
          .filter(
            (r) =>
              r.key === link ||
              r.from.key === selection ||
              r.to.key === selection,
          )
          .slice(0, 30)
      : s.routes;
  for (const r of routes) {
    if (
      (link && r.key !== link) ||
      (selection && r.from.key !== selection && r.to.key !== selection)
    )
      continue;
    const f = (elapsed / (6800 + (r.seed % 4300)) + (r.seed % 233) / 233) % 1;
    if (f < 0.245 || f > 0.759) continue;
    const p = at(r, f),
      prev = at(r, f - 0.015),
      alpha = clamp(Math.min((f - 0.245) * 13, (0.759 - f) * 13), 0, 1);
    g.globalAlpha = alpha * 0.76;
    g.strokeStyle = `rgba(${r.colour},.86)`;
    g.lineWidth = 1.35;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(prev.x, prev.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    g.fillStyle = "rgba(224,246,231,.9)";
    g.fillRect(p.x - 0.65, p.y - 0.65, 1.25, 1.25);
  }
  g.restore();
}
