import { useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import type { InvestigationRun } from "../lib/investigations";
import styles from "./OperatingTradeoffs.module.css";

const format = (value: number, unit: string) =>
  unit === "GBP"
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 2,
      }).format(value)
    : value.toLocaleString("en-GB", { maximumFractionDigits: 2 }) + " " + unit;

export default function OperatingTradeoffs({ run }: { run: InvestigationRun }) {
  const [id, setId] = useState("elapsed");
  const comparison = run.result?.comparison;
  if (!comparison || !run.result) return null;
  const designs = run.result.package.approaches;
  const criterion =
    comparison.criteria.find((c) => c.id === id) || comparison.criteria[0];
  if (!criterion) return null;
  const strongest = Math.max(1, ...Object.values(criterion.values));
  const preferred = designs
    .filter((a) => criterion.preferred.includes(a.id))
    .map((a) => a.name);
  return (
    <section
      className={styles.panel}
      aria-label="Reference scenario trade-offs"
    >
      <header>
        <ChartNoAxesCombined size={16} />
        <h3>Operating trade-offs</h3>
        <span>Scenario model</span>
      </header>
      <div
        className={styles.choices}
        role="group"
        aria-label="Compare by objective"
      >
        {comparison.criteria.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === criterion.id}
            onClick={() => setId(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p>{criterion.measure} under each design’s reference assumptions.</p>
      {designs.map((d) => (
        <div key={d.id} className={styles.row}>
          <div>
            <strong>{d.name}</strong>
            <code>{format(criterion.values[d.id], criterion.unit)}</code>
          </div>
          <i>
            <b
              style={{
                width: (100 * criterion.values[d.id]) / strongest + "%",
              }}
            />
          </i>
        </div>
      ))}
      <small>
        {preferred.length === designs.length
          ? "The designs tie on this objective."
          : preferred.join(" and ") + " has the lowest modelled value."}{" "}
        {criterion.spread > 0
          ? "Difference across designs: " +
            format(criterion.spread, criterion.unit) +
            "."
          : ""}
      </small>
    </section>
  );
}
