/* The featured finding's amber particle stream. Every mote travels along one
   of several curved threads; opacity hides the wrap at either end. */
type Mote = {
  offset: number;
  lane: number;
  radius: number;
  alpha: number;
  speed: number;
};

function randomSource(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const MOTES: Mote[] = (() => {
  const rand = randomSource(7);
  const out: Mote[] = [];
  for (let j = 0; j < 24; j++) {
    const lane = j / 23;
    const core = 1 - Math.abs(lane - 0.5) * 2;
    for (let k = 0; k < 42; k++) {
      out.push({
        offset: (k + rand()) / 42,
        lane,
        radius: 0.35 + rand() * 0.6 * core,
        alpha: (0.15 + 0.85 * core * core) * (0.35 + 0.65 * rand()),
        speed: 0.017 + rand() * 0.012,
      });
    }
  }
  return out;
})();

function point(m: Mote, time: number) {
  const u = (m.offset + time * m.speed) % 1;
  const x = u * 220;
  const y =
    104 -
    70 * Math.pow(u, 1.7) +
    (m.lane - 0.5) * 34 * (0.3 + u) +
    Math.sin(u * 6 + m.lane * 3 + time * 0.22) * 4;
  const alpha = m.alpha * Math.pow(Math.sin(Math.PI * u), 0.75);
  return { x, y, alpha };
}

export function paintFocusStream(canvas: HTMLCanvasElement, time: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(w / 220, 0, 0, h / 120, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  for (const m of MOTES) {
    const p = point(m, time);
    if (p.alpha < 0.025) continue;
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = "rgb(244,176,124)";
    ctx.fillRect(p.x, p.y, m.radius, m.radius);
  }
  // A sparse set of brighter motes gives the stream a living sparkle.
  ctx.fillStyle = "rgb(255,230,202)";
  for (let i = 0; i < MOTES.length; i += 31) {
    const m = MOTES[i];
    const p = point(m, time + 0.4);
    ctx.globalAlpha = p.alpha * (0.45 + 0.5 * Math.sin(time * 1.4 + i));
    ctx.fillRect(p.x, p.y, m.radius * 1.45, m.radius * 1.45);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
