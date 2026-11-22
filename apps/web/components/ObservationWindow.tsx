import { useMemo } from "react";
import type { State } from "../lib/types";

const DAY = 86_400_000;
const dateLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Equal-duration bins ending at the report's evidence timestamp. */
export default function ObservationWindow({ state }: { state: State }) {
  const { asof, days } = state.report;
  const window = useMemo(() => {
    const end = Date.parse(asof);
    if (!Number.isFinite(end) || days <= 0) return null;
    const start = end - days * DAY;
    const counts = Array.from({ length: Math.min(30, days) }, () => 0);
    for (const row of state.data.events) {
      const time = Date.parse(row.timestamp);
      if (!Number.isFinite(time) || time <= start || time > end) continue;
      const index = Math.min(
        counts.length - 1,
        Math.floor(((time - start) / (end - start)) * counts.length),
      );
      counts[index]++;
    }
    return { start, end, counts, peak: Math.max(1, ...counts) };
  }, [state.data.events, asof, days]);
  if (!window) return null;
  const { counts, start, end, peak } = window;
  return (
    <figure className="observation-window">
      <figcaption>
        Observed activity <span>{days}d</span>
      </figcaption>
      <svg
        viewBox={"0 0 " + counts.length * 6 + " 26"}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          "Observed events in " +
          counts.length +
          " equal intervals, oldest first: " +
          counts.join(", ")
        }
      >
        {counts.map((count, i) => {
          const height = (count / peak) * 24;
          return (
            <rect
              key={i}
              x={i * 6}
              y={26 - height}
              width="3.5"
              height={height}
              rx=".7"
            >
              <title>
                {dateLabel.format(start + (i * (end - start)) / counts.length)}{" "}
                · {count} events
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="window-dates" aria-hidden="true">
        <span>{dateLabel.format(start)}</span>
        <span>{dateLabel.format(end)}</span>
      </div>
    </figure>
  );
}
