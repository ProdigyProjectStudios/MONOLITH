"use client";

import { memo, useId, useMemo } from "react";
import styles from "./AgentSignature.module.css";

const profiles = [
  { lobes: 2, turn: 1, tilt: 0.59, offset: -0.25 },
  { lobes: 3, turn: 2, tilt: 0.55, offset: 0.7 },
  { lobes: 3, turn: 1, tilt: 0.77, offset: -0.8 },
  { lobes: 4, turn: 2, tilt: 0.49, offset: 0.35 },
  { lobes: 2, turn: 3, tilt: 0.71, offset: -0.45 },
  { lobes: 4, turn: 1, tilt: 0.68, offset: 1.4 },
];
const accents = [
  "#8fc9ec",
  "#a1ead8",
  "#dca6d4",
  "#edaba0",
  "#8caceb",
  "#c5dab0",
];
const tau = Math.PI * 2;

// Project elliptical cross-sections of a folded torus. Painter order keeps
// the back surface behind the lip. Each role retains the same geometry in
// the work surface and graph, and recorded tool results illuminate its rim.
function contours(role: number, compact: boolean) {
  const { lobes, turn, tilt, offset } = profiles[role];
  const n = compact ? 48 : 136,
    samples = compact ? 16 : 36;
  const incline = Math.sqrt(1 - tilt * tilt);
  return Array.from({ length: n }, (_, i) => {
    const u = (i * tau) / n;
    const a = u + offset,
      twist = turn * u + 0.8 * Math.cos(u + offset);
    const radius = 81 + 10 * Math.sin(lobes * u + offset);
    const width = 30 + 11 * Math.cos(2 * u + 0.5);
    const baseZ = 19 * Math.sin(lobes * u + offset) + 13 * Math.cos(u - 0.65);
    const points = Array.from({ length: samples }, (_, j) => {
      const t = (j * tau) / samples;
      const broad = width * Math.cos(t),
        narrow = 10 * Math.sin(t);
      const r = radius + broad * Math.cos(twist) - narrow * Math.sin(twist);
      const y = r * Math.sin(a),
        z = baseZ + broad * Math.sin(twist) + narrow * Math.cos(twist);
      return [r * Math.cos(a) * 1.1, -tilt * y - incline * z];
    });
    const d =
      points
        .map(([x, y], j) => (j ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2))
        .join("") + "Z";
    const grains = compact
      ? []
      : [4, 11, 19, 26].map((j, k) => {
          const a = points[j],
            b = points[j + 1];
          const mix = 0.5 + 0.48 * Math.sin((i + 1) * (k + 1) * 73.31);
          return [a[0] + mix * (b[0] - a[0]), a[1] + mix * (b[1] - a[1])];
        });
    return {
      i,
      d,
      grains,
      point: points[3],
      depth: tilt * baseZ - incline * radius * Math.sin(a),
      light: (1 + Math.cos(a - 1.95) * 0.74 + Math.sin(twist) * 0.24) / 2,
    };
  }).sort((a, b) => a.depth - b.depth);
}

export default memo(function AgentSignature({
  role,
  color,
  receipts,
  compact = false,
  animated = false,
}: {
  role: number;
  color: string;
  receipts: number;
  compact?: boolean;
  animated?: boolean;
}) {
  const id = "signature" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rings = useMemo(() => contours(role, compact), [role, compact]);
  const count = Math.min(12, receipts);
  const marked = new Set(
    Array.from({ length: count }, (_, i) =>
      Math.floor(((i + 0.34) / count) * rings.length),
    ),
  );
  return (
    <svg
      className={styles.signature}
      viewBox="-145 -110 290 220"
      aria-hidden="true"
      data-motion={animated}
      data-role={role}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2=".85" y2="0">
          <stop stopColor="#0a282a" />
          <stop offset=".32" stopColor={color} stopOpacity=".70" />
          <stop offset=".62" stopColor="#f1fff7" />
          <stop offset="1" stopColor={color} />
        </linearGradient>
        <linearGradient id={id + "surface"} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#061514" />
          <stop offset=".24" stopColor={color} stopOpacity=".70" />
          <stop offset=".36" stopColor="#142e2b" />
          <stop offset=".7" stopColor={accents[role]} stopOpacity=".69" />
          <stop offset="1" stopColor="#102721" />
        </linearGradient>
      </defs>
      <g className={styles.body}>
        {rings.map(({ d, light, i, point, grains }) => (
          <g key={i}>
            <path
              d={d}
              fill={`url(#${id}surface)`}
              stroke={`url(#${id})`}
              strokeOpacity={0.4 + 0.57 * light}
              strokeWidth={compact ? 1.7 : 1.02}
              strokeLinejoin="round"
            />
            {grains.map(([x, y], j) => (
              <circle
                key={j}
                cx={x}
                cy={y}
                r={0.43 + 0.3 * light}
                fill={j % 2 ? color : "#dffff1"}
                opacity={0.36 + light * 0.5}
              />
            ))}
            {marked.has(i) && (
              <circle
                cx={point[0]}
                cy={point[1]}
                r={compact ? 2.6 : 1.9}
                fill="#f5fff6"
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
});
