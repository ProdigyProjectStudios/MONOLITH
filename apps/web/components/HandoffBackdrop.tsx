"use client";
import { useEffect, useRef } from "react";
import styles from "./HandoffAtlas.module.css";

// A low-resolution fog plate under a sharp, perspective-warped particle sheet.
// Only resize and route pressure repaint it. Slow drift is composited in CSS.
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 1597334677) ^ Math.imul(b, 3812015801);
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
  };
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (1 - v) * (a + u * (b - a)) + v * (c + u * (d - c));
}

function paint(canvas: HTMLCanvasElement, warm: boolean) {
  const { clientWidth: w, clientHeight: h } = canvas;
  const ctx = canvas.getContext("2d");
  if (!w || !h || !ctx) return;
  const density = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * density);
  canvas.height = Math.round(h * density);
  ctx.scale(density, density);

  const fog = document.createElement("canvas");
  fog.width = Math.min(260, Math.ceil(w / 3));
  fog.height = Math.min(140, Math.ceil(h / 3));
  const fogCtx = fog.getContext("2d");
  if (!fogCtx) return;
  const pixels = fogCtx.createImageData(fog.width, fog.height);
  for (let row = 0; row < fog.height; row++) {
    const y = row / fog.height;
    for (let col = 0; col < fog.width; col++) {
      const x = col / fog.width;
      const bend = noise(x * 3 + 7, y * 3);
      const mist = noise(x * 5 - y * 2, y * 4 + bend * 2)
        + 0.35 * noise(x * 11 + bend, y * 9) + 0.12 * noise(x * 20, y * 17);
      const crest = y - 0.50 - 0.17 * Math.sin(x * 7.6 + bend * 2);
      const light = Math.exp(-crest * crest * 17) * (0.3 + 0.85 * mist);
      // Fold a narrow veil of light through the broader haze.
      const veilY = y - 0.51 + 0.25 * Math.sin(x * 6.8 + bend * 1.9) - (mist - 0.7) * 0.2;
      const veil = Math.exp(-veilY * veilY * 69) * (0.2 + 0.8 * bend);
      const offset = (row * fog.width + col) * 4;
      pixels.data[offset] = 11 + mist * 8 + light * (warm ? 25 : 15) + veil * 13;
      pixels.data[offset + 1] = 21 + mist * 11 + light * 24 + veil * 17;
      pixels.data[offset + 2] = 22 + mist * 13 + light * (warm ? 17 : 26) + veil * 15;
      pixels.data[offset + 3] = 255;
    }
  }
  fogCtx.putImageData(pixels, 0, 0);
  ctx.drawImage(fog, 0, 0, w, h);

  const columns = Math.ceil(w / 6);
  for (let row = 0; row < 24; row++) {
    const depth = row / 23;
    for (let col = -5; col <= columns + 5; col++) {
      const u = col / columns;
      const curl = Math.sin(8.4 * u + 0.48 + 0.92 * depth);
      const x = (u + (depth - 0.5) * 0.043 * Math.cos(u * 8)) * w;
      const y = (0.96 - 0.16 * Math.cos(6.35 * u + 0.35) - 0.09 * curl
        + (depth - 0.5) * (0.13 + 0.14 * curl) + 0.065 * depth * depth) * h;
      const grain = noise(col * 2.3, row * 3.4);
      const rim = Math.pow(1 - depth, 2);
      const fold = Math.exp(-Math.pow((depth - 0.27 - curl * 0.10) * 8, 2));
      ctx.fillStyle = 'rgba(137,227,210,' + (0.07 + grain * 0.34 + rim * 0.27 + fold * 0.19) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 0.46 + depth * 0.34 + grain * 0.22, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

export default function HandoffBackdrop({ warm }: { warm: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => paint(canvas, warm));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [warm]);
  return <canvas className={styles.atmosphere} ref={ref} aria-hidden="true" />;
}
