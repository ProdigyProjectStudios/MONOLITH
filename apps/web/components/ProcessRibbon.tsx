"use client";
import { useEffect, useRef } from "react";
import { ribbonSection } from "../lib/processRibbon";
import css from "./ProcessExplorer.module.css";

type Stop = { label: string; hours: number | null };
const pad = 0.07;
const motionRate = 0.72;
const position = (i: number, count: number) =>
  count > 1 ? pad + (i / (count - 1)) * (1 - 2 * pad) : 0.5;

// An ordered strip of fibres. Each station swells in proportion to its median
// incoming interval; all windows of one variant use the same vertical scale.
export default function ProcessRibbon({
  stops,
  start,
  maximum,
  peak,
  selected,
  select,
  paused,
}: {
  stops: Stop[];
  start: number;
  maximum: number;
  peak: number;
  selected: number;
  select: (step: number) => void;
  paused: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 1,
      h = 1,
      raf = 0,
      last = 0,
      visible = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const samples = 155;
    const stations = stops.map((s, i) => ({
      x: position(i, stops.length),
      height: (s.hours ?? 0) / (maximum || 1),
    }));
    const interval = (1 - 2 * pad) / Math.max(stops.length - 1, 1);
    const section = Array.from({ length: samples + 1 }, (_, i) => {
      const x = i / samples;
      let amp = 0;
      for (const station of stations)
        amp +=
          station.height *
          Math.exp(-1.65 * ((x - station.x) / (interval * 0.55)) ** 2);
      return Math.min(1, amp);
    });
    function render() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const time = clock.current;
      const points = section.map((amp, i) => {
        const x = i / samples;
        const wave = Math.sin(x * 10 + time * 0.19);
        const { middle, spread } = ribbonSection(h, amp, wave);
        const twist = x * 9 - time * 0.15;
        return { x: x * w, middle, spread, twist };
      });
      const stroke = ctx.createLinearGradient(0, 0, w, 0);
      const colors = stops.map((_, i) =>
        i + start === peak
          ? "#ffbd77"
          : ["#73d8cc", "#9cc7ec", "#b9a0ea", "#8ce0b5"][(start + i) % 4],
      );
      stops.forEach((_, i) =>
        stroke.addColorStop(position(i, stops.length), colors[i]),
      );
      ctx.strokeStyle = stroke;
      ctx.fillStyle = stroke;
      for (let f = 0; f < 58; f++) {
        const phi = (f * 2 * Math.PI) / 58;
        const front = (1 + Math.cos(phi)) / 2;
        ctx.globalAlpha = 0.24 + front * 0.54;
        ctx.lineWidth = 0.55 + 0.62 * front;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          const fold =
            0.72 * Math.sin(phi + p.twist) +
            0.28 * Math.sin(2 * phi - p.twist * 0.55);
          const y = p.middle + p.spread * fold;
          if (i) ctx.lineTo(p.x, y);
          else ctx.moveTo(p.x, y);
        }
        ctx.stroke();
        // Small signals travel on the same contours as the stationary fibres.
        for (let spark = 0; spark < 2; spark++) {
          const u =
            (f * 0.6180339 + spark * 0.391 + time * (0.034 + (f % 3) * 0.003)) %
            1;
          const left = Math.floor(u * samples);
          const a = points[left],
            b = points[left + 1];
          const mix = u * samples - left;
          const p = {
            x: u * w,
            middle: a.middle + (b.middle - a.middle) * mix,
            spread: a.spread + (b.spread - a.spread) * mix,
            twist: a.twist + (b.twist - a.twist) * mix,
          };
          const y =
            p.middle +
            p.spread *
              (0.72 * Math.sin(phi + p.twist) +
                0.28 * Math.sin(2 * phi - p.twist * 0.55));
          ctx.globalAlpha = 0.45 + front * 0.5;
          ctx.beginPath();
          ctx.arc(p.x, y, 0.65 + front * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function tick(now: number) {
      if (now - last >= 32) {
        clock.current += Math.min((now - last) / 1000, 0.065) * motionRate;
        last = now;
        render();
      }
      raf = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(raf);
      last = performance.now();
      render();
      if (visible && !document.hidden && !paused && !reduced.matches)
        raf = requestAnimationFrame(tick);
    }
    function resize() {
      if (!canvas || !ctx) return;
      w = Math.max(1, canvas.clientWidth);
      h = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      render();
    }
    const ro = new ResizeObserver(resize),
      io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        sync();
      });
    resize();
    ro.observe(canvas);
    io.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, [maximum, paused, peak, start, stops]);
  return (
    <div className={css.plot} role="group" aria-label="Process timing field">
      <canvas
        ref={ref}
        aria-hidden="true"
        onClick={(event) => {
          if (!stops.length) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const fraction =
            ((event.clientX - bounds.left) / bounds.width - pad) /
            (1 - 2 * pad);
          select(
            start +
              Math.round(
                Math.max(0, Math.min(1, fraction)) * (stops.length - 1),
              ),
          );
        }}
      />
      {stops.map((stop, i) => (
        <button
          type="button"
          key={start + i}
          style={{ left: 100 * position(i, stops.length) + "%" }}
          className={css.marker}
          title={stop.label}
          aria-label={"Inspect step " + (start + i + 1) + ", " + stop.label}
          aria-pressed={selected === start + i}
          data-peak={peak === start + i}
          onClick={() => select(start + i)}
        >
          {String(start + i + 1).padStart(2, "0")}
          <span className={css.stageLabel} aria-hidden="true">
            {stop.label}
          </span>
        </button>
      ))}
    </div>
  );
}
