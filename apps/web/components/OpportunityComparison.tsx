import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Rec } from "../lib/types";
import css from "./OpportunityComparison.module.css";
import styles from "./WorkAreas.module.css";

const measures = [
  { key: "hours", label: "Median interval", unit: "h" },
  { key: "cases", label: "Matched cases", unit: "cases" },
  { key: "score", label: "Suitability", unit: "/100" },
] as const;
type Metric = (typeof measures)[number]["key"];
const format = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export function OpportunityComparison({
  recs,
  open,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
}) {
  const [metric, setMetric] = useState<Metric>("hours");
  const [focus, setFocus] = useState<string | null>(null);
  if (!recs.length) return null;
  const ranked = [...recs].sort(
    (a, b) => b[metric] - a[metric] || a.title.localeCompare(b.title),
  );
  const active = recs.find((r) => r.id === focus) ?? ranked[0];
  const maximum = metric === "score" ? 100 : ranked[0][metric];
  const measure = measures.find((m) => m.key === metric)!;

  return (
    <section
      className={styles.panel}
      aria-label="Opportunity measurement comparison"
    >
      <header className={css.header}>
        <h2>Opportunity comparison</h2>
        <div
          role="group"
          aria-label="Rank opportunities by"
          className={css.sort}
        >
          {measures.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>
      <div className={css.body}>
        <div className={css.chart}>
          <div className={css.legend}>
            <span>Finding</span>
            <span>{measure.label}</span>
          </div>
          <ol aria-label={"Ranked by " + measure.label.toLowerCase()}>
            {ranked.map((rec) => (
              <li key={rec.id}>
                <button
                  type="button"
                  aria-label={"Select " + rec.title}
                  aria-pressed={rec.id === active.id}
                  onClick={() => setFocus(rec.id)}
                  className={css.row}
                >
                  <span className={css.title}>{rec.title}</span>
                  <span className={css.value}>
                    {format.format(rec[metric])}
                    <small>{measure.unit}</small>
                  </span>
                  <span className={css.track} aria-hidden="true">
                    <i
                      style={{
                        width:
                          (maximum ? (100 * rec[metric]) / maximum : 0) + "%",
                      }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <aside aria-label="Selected finding" className={css.inspector}>
          <span className={css.label}>Selected finding</span>
          <h3>{active.title}</h3>
          <p>{active.action}</p>
          <dl>
            <div>
              <dt>Median preceding interval</dt>
              <dd>{format.format(active.hours)} h</dd>
            </div>
            <div>
              <dt>Matched cases</dt>
              <dd>{format.format(active.cases)}</dd>
            </div>
            <div>
              <dt>Suitability</dt>
              <dd>{active.score}/100</dd>
            </div>
            <div>
              <dt>Disposition</dt>
              <dd>{active.kind}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn primary"
            onClick={() => open(active)}
          >
            Open finding <ArrowUpRight size={15} />
          </button>
        </aside>
      </div>
    </section>
  );
}
