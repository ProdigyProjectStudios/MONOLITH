"use client";
import { useId, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Analysis } from "./ContinuousPeriods";
import { date, n } from "./ContinuousPeriods";
import css from "./OperationalWork.module.css";

export default function PeriodSignal({
  epochs,
  onInspect,
}: {
  epochs: Analysis["graph"]["epochs"];
  onInspect: (id: string) => void;
}) {
  const [chosen, choose] = useState(""),
    [metric, setMetric] = useState<"events" | "cases">("events");
  const uid = useId(),
    periods = epochs.slice(-24);
  if (!periods.length) return <p className={css.single}>No observed periods</p>;
  const index = periods.findIndex((p) => p.id === chosen),
    current = index < 0 ? periods.length - 1 : index;
  const period = periods[current],
    maximum = Math.max(1, ...periods.map((p) => p[metric]));
  const x = (i: number) =>
    periods.length === 1 ? 50 : 3 + (94 * i) / (periods.length - 1);
  // Each profile intersects the same observed samples. Depth changes only the vertical scale.
  const y = (i: number, k: number) =>
    76 + 1.4 * k - (periods[i][metric] / maximum) * (60 - k * 2.3);
  return (
    <div className={css.periodSignal}>
      <div className={css.signalTitle}>
        <strong>Observation history</strong>
        <div className={css.segment} aria-label="Period measure" role="group">
          {(["events", "cases"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className={css.periodPlot}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id={uid}
              x2="0"
              y2="1"
              gradientUnits="objectBoundingBox"
            >
              <stop stopColor="#a8f1d1" stopOpacity=".32" />
              <stop offset="1" stopColor="#669eb6" stopOpacity=".01" />
            </linearGradient>
          </defs>
          {Array.from({ length: 12 }, (_, k) => {
            const d = periods
              .map((_, i) => (i ? "L" : "M") + x(i) + " " + y(i, k))
              .join(" ");
            return (
              <path
                key={k}
                d={d}
                fill="none"
                stroke={k % 2 ? "#93d8bd" : "#97bad1"}
                strokeOpacity={0.73 - k * 0.035}
                strokeWidth={1.1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <path
            d={
              periods
                .map((_, i) => (i ? "L" : "M") + x(i) + " " + y(i, 0))
                .join(" ") +
              " L " +
              x(periods.length - 1) +
              " 100 L " +
              x(0) +
              " 100 Z"
            }
            fill={"url(#" + uid + ")"}
          />
        </svg>
        <i
          aria-hidden="true"
          style={{ left: x(current) + "%", top: y(current, 0) + "%" }}
        />
        <input
          aria-label="Scrub observed periods"
          aria-valuetext={
            date(period.start) + ", " + period[metric] + " " + metric
          }
          type="range"
          min={0}
          max={periods.length - 1}
          value={current}
          onChange={(e) => choose(periods[Number(e.target.value)].id)}
        />
      </div>
      <div className={css.periodAxis}>
        <span>{date(periods[0].start)}</span>
        <span>
          {periods.length} observed{" "}
          {periods.length === 1 ? "period" : "periods"}
        </span>
        <span>{date(periods.at(-1)!.end)}</span>
      </div>
      <div className={css.periodRead}>
        <div>
          <time>{date(period.start)}</time>
          <strong>
            {n(period[metric])} {metric}
          </strong>
        </div>
        <button
          className="text-btn"
          aria-label="Inspect observed periods"
          onClick={() => onInspect(period.id)}
        >
          Inspect period <ArrowUpRight size={13} />
        </button>
      </div>
    </div>
  );
}
