import { useState } from "react";
import { FileSearch } from "lucide-react";
import type { Rec } from "../lib/types";
import { number } from "./UI";
import { Register } from "./OpportunityRegister";
import styles from "./Comparison.module.css";
import editorial from "./Journeys.module.css";

function axisMax(values: number[]) {
  const rough = Math.max(1, ...values) / 4;
  const order = 10 ** Math.floor(Math.log10(rough));
  const size = [1, 2, 2.5, 5, 10].find((step) => step * order >= rough) ?? 10;
  return Math.ceil(4 * size * order * 1000) / 1000;
}
function tick(value: number) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 2,
    notation: value >= 10000 ? "compact" : "standard",
  }).format(value);
}

export function OpportunityComparison({
  recs,
  open,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  if (!recs.length) return null;
  const slowest = recs.reduce((a, b) => (a.hours >= b.hours ? a : b));
  const active = recs.find((r) => r.id === focus) ?? slowest;
  const xMax = axisMax(recs.map((r) => r.cases));
  const yMax = axisMax(recs.map((r) => r.hours));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const px = (active.cases / xMax) * 100 + "%";
  const py = (active.hours / yMax) * 100 + "%";

  return (
    <section
      className={styles.comparison}
      aria-label="Opportunity measurement comparison"
    >
      <div className={styles.chart}>
        <header>
          <p className={editorial.kicker}>Process evidence</p>
          <h2>Opportunity comparison</h2>
        </header>
        <figure aria-label="Matched cases versus median preceding interval">
          <figcaption>
            Median preceding interval <span>· hours</span>
          </figcaption>
          <div className={styles.axes}>
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden="true"
                className={styles.hRule}
                style={{ bottom: t * 100 + "%" }}
              >
                <span>{tick(yMax * t)}</span>
              </div>
            ))}
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden="true"
                className={styles.vRule}
                style={{ left: t * 100 + "%" }}
              >
                <span>{tick(xMax * t)}</span>
              </div>
            ))}
            <div
              className={styles.yGuide}
              aria-hidden="true"
              style={{ width: px, bottom: py }}
            />
            <div
              className={styles.xGuide}
              aria-hidden="true"
              style={{ left: px, height: py }}
            />
            {recs.map((r) => {
              const x = r.cases / xMax,
                y = r.hours / yMax;
              const activePoint = r.id === active.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-label={`Focus ${r.title}, ${r.cases} cases, median ${r.hours} hours`}
                  aria-pressed={activePoint}
                  className={styles.point}
                  style={{ left: x * 100 + "%", bottom: y * 100 + "%" }}
                  data-left={x >= 0.55 || undefined}
                  data-below={y >= 0.82 || undefined}
                  onClick={() => setFocus(r.id)}
                  onFocus={() => setFocus(r.id)}
                  onMouseEnter={() => setFocus(r.id)}
                >
                  <i aria-hidden="true" />
                  <span aria-hidden="true">
                    <b>{r.title}</b>
                    <em>{r.area}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <div className={styles.abscissa}>Matched cases</div>
        </figure>
      </div>
      <aside className={styles.readout}>
        <div>
          <p className={editorial.darkEyebrow}>
            {active.id === slowest.id
              ? "Longest median interval"
              : "Selected finding"}
          </p>
          <h3>{active.title}</h3>
          <p>{active.action}.</p>
        </div>
        <dl>
          <div>
            <dt>Median wait</dt>
            <dd>
              {active.hours}
              <small> h</small>
            </dd>
          </div>
          <div>
            <dt>Matching cases</dt>
            <dd>{number(active.cases)}</dd>
          </div>
        </dl>
        <div className={styles.readoutFoot}>
          <span>
            {active.kind} · {active.area}
          </span>
          <button type="button" onClick={() => open(active)}>
            <FileSearch size={16} />
            Open finding
          </button>
        </div>
      </aside>
    </section>
  );
}
export function Opportunities({
  recs,
  open,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
}) {
  return (
    <div className={editorial.work}>
      <OpportunityComparison recs={recs} open={open} />
      <Register recs={recs} open={open} />
    </div>
  );
}
