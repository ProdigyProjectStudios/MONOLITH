import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Rec } from "../lib/types";
import { number } from "./UI";
import styles from "./Journeys.module.css";

type Order = "score" | "cases" | "hours";
export function Register({
  recs,
  open,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
}) {
  const [filter, setFilter] = useState("All signals");
  const [order, setOrder] = useState<Order>("score");
  const rows = recs
    .filter(
      (r) =>
        filter === "All signals" ||
        (filter === "Human-led"
          ? r.kind === "Human-led"
          : r.kind !== "Human-led"),
    )
    .sort((a, b) => b[order] - a[order]);
  return (
    <section className={styles.register} aria-label="Opportunity register">
      <header className={styles.sectionHead}>
        <h2>Opportunity register</h2>
        <div className={styles.sorts}>
          <label className={styles.fieldLabel}>
            Disposition
            <select
              aria-label="Filter opportunities"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {["All signals", "Automation", "Human-led"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            Order by
            <select
              aria-label="Order findings by"
              value={order}
              onChange={(e) => setOrder(e.target.value as Order)}
            >
              <option value="score">Suitability</option>
              <option value="cases">Case volume</option>
              <option value="hours">Median wait</option>
            </select>
          </label>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th scope="col">Finding</th>
            <th scope="col">Disposition</th>
            <th scope="col">Suitability</th>
            <th scope="col">Cases</th>
            <th scope="col">Median wait</th>
            <th scope="col">
              <span className="screen-reader-text">Evidence</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <button className={styles.findingLink} onClick={() => open(r)}>
                  {r.title}
                </button>
                <small>{r.area}</small>
              </th>
              <td data-label="Disposition">{r.kind}</td>
              <td data-label="Suitability">
                <span className={styles.score}>
                  <i aria-hidden="true" style={{ width: r.score + "%" }} />
                </span>
                {r.score}
                <span className={styles.scoreBase}>/100</span>
              </td>
              <td data-label="Cases">{number(r.cases)}</td>
              <td data-label="Median wait">{r.hours} h</td>
              <td>
                <button
                  type="button"
                  aria-label={"Inspect " + r.title}
                  onClick={() => open(r)}
                  className={styles.inspect}
                >
                  Inspect <ChevronRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className={styles.empty}>No opportunities match this filter.</p>
      )}
    </section>
  );
}
