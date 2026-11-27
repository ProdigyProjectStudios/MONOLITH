import { useMemo } from "react";
import type { Rec } from "../lib/types";
import { hash } from "./field/scene";
import css from "./OperationalWork.module.css";

// Draw contours at the same coordinates as the keyboard-accessible chart marks.
// Radius expresses suitability on a fixed 0–100 scale; location stays in case/hour space.
export default function OpportunityContours({
  recs,
  xMax,
  yMax,
  selected,
}: {
  recs: Rec[];
  xMax: number;
  yMax: number;
  selected: string;
}) {
  const shapes = useMemo(
    () =>
      recs.map((rec) => {
        const phase = (hash(rec.id) % 628) / 100;
        const radius = 10 + Math.max(0, Math.min(100, rec.score)) * 0.9;
        const rings = Array.from({ length: 15 }, (_, i) => {
          const depth = (i + 1) / 15;
          const points = Array.from({ length: 65 }, (_, j) => {
            const t = (2 * Math.PI * j) / 64;
            const lobe =
              1 +
              0.14 * Math.sin(3 * t + phase + 0.9 * depth) +
              0.07 * Math.cos(2 * t - phase);
            const x = radius * depth * lobe * Math.cos(t);
            const y =
              radius * depth * 0.57 * lobe * Math.sin(t) +
              0.17 * x * Math.cos(phase) +
              0.07 * radius * depth * Math.sin(2 * t + depth);
            return (j ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
          });
          return points.join(" ") + " Z";
        });
        return {
          id: rec.id,
          x: (1000 * rec.cases) / xMax,
          y: 400 * (1 - rec.hours / yMax),
          rings,
          colour:
            rec.kind === "Human-led"
              ? "#bea5e8"
              : rec.kind === "Assist"
                ? "#9ecbe9"
                : "#a2e6c2",
        };
      }),
    [recs, xMax, yMax],
  );
  return (
    <svg
      aria-hidden="true"
      className={css.contours}
      viewBox="0 0 1000 400"
      preserveAspectRatio="none"
    >
      {shapes.map((s) => (
        <g
          key={s.id}
          transform={"translate(" + s.x + " " + s.y + ")"}
          data-active={s.id === selected}
          color={s.colour}
        >
          {s.rings.map((d, i) => (
            <path
              key={i}
              d={d}
              vectorEffect="non-scaling-stroke"
              fill={i === 0 ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={i === 14 ? 1.1 : 0.7}
              opacity={0.33 + i * 0.032}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
