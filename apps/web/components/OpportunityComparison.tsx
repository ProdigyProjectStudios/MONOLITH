import { useState } from "react";
import { ArrowUpRight, Crosshair } from "lucide-react";
import type { Rec } from "../lib/types";
import { number } from "./UI";
import OpportunityContours from "./OpportunityContours";
import Membrane from "./Membrane";
import HandoffBackdrop from "./HandoffBackdrop";
import visual from "./OperationalWork.module.css";
import styles from "./WorkAreas.module.css";

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
  const slowest = recs.reduce((max, r) => (r.hours > max.hours ? r : max));
  const active = recs.find((r) => r.id === focus) ?? slowest;
  const xMax = axisMax(recs.map((r) => r.cases)),
    yMax = axisMax(recs.map((r) => r.hours));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <section
      className={styles.panel}
      aria-label="Opportunity measurement comparison"
    >
      <header className={styles.head}>
        <div>
          <div className={styles.eyebrow}>
            <Crosshair size={13} />
            Process evidence
          </div>
          <h2>Opportunity comparison</h2>
        </div>
        <span className={styles.count}>
          {recs.length} measured{" "}
          {recs.length === 1 ? "opportunity" : "opportunities"}
        </span>
      </header>
      <div className={styles.comparisonGrid}>
        <figure
          className={styles.scatter + " " + visual.scatter}
          aria-label="Matched cases versus median preceding interval"
        >
          <HandoffBackdrop warm />
          <figcaption>
            Median preceding interval <span>· hours</span>
          </figcaption>
          <div className={styles.plotWrap}>
            <div className={styles.plot}>
              <OpportunityContours
                recs={recs}
                xMax={xMax}
                yMax={yMax}
                selected={active.id}
              />
              {ticks.map((f) => (
                <span
                  key={f}
                  className={styles.yTick}
                  style={{ bottom: f * 100 + "%" }}
                >
                  {tick(yMax * f)}
                </span>
              ))}
              {ticks.map((f) => (
                <span
                  key={f}
                  className={styles.xTick}
                  style={{ left: f * 100 + "%" }}
                >
                  {tick(xMax * f)}
                </span>
              ))}
              <i
                aria-hidden="true"
                className={styles.guideX}
                style={{
                  height: (active.hours / yMax) * 100 + "%",
                  left: (active.cases / xMax) * 100 + "%",
                }}
              />
              <i
                aria-hidden="true"
                className={styles.guideY}
                style={{
                  width: (active.cases / xMax) * 100 + "%",
                  bottom: (active.hours / yMax) * 100 + "%",
                }}
              />
              {recs.map((r) => {
                const x = r.cases / xMax,
                  y = r.hours / yMax;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={styles.plotPoint}
                    data-selected={r.id === active.id || undefined}
                    data-peak={r.id === slowest.id || undefined}
                    data-left={x > 0.52 || undefined}
                    data-narrow-align={
                      x < 0.18 ? "start" : x > 0.88 ? "end" : "center"
                    }
                    data-below={y > 0.85 || undefined}
                    style={{ left: x * 100 + "%", bottom: y * 100 + "%" }}
                    aria-label={`Open ${r.title} comparison, ${r.cases} cases, median ${r.hours} hours`}
                    onFocus={() => setFocus(r.id)}
                    onMouseEnter={() => setFocus(r.id)}
                    onClick={() => open(r)}
                  >
                    <i aria-hidden="true" />
                    <span>{r.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.xLabel}>
            Matched cases · contour size shows suitability
          </div>
        </figure>
        <aside className={styles.comparisonFocus}>
          <div className={visual.specimen}>
            <Membrane
              identity={active.id}
              tone={
                active.kind === "Human-led"
                  ? "violet"
                  : active.id === slowest.id
                    ? "amber"
                    : "mint"
              }
              strength={active.score / 100}
            />
            <div>
              <b>
                {active.score}
                <small>/100</small>
              </b>
              <span>Suitability</span>
            </div>
          </div>
          <label className={visual.picker}>
            Inspect finding
            <select
              value={active.id}
              onChange={(event) => setFocus(event.target.value)}
            >
              {recs.map((rec) => (
                <option key={rec.id} value={rec.id}>
                  {rec.title}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.focusLabel}>
            {active.id === slowest.id
              ? "Longest median interval"
              : "Focused opportunity"}
          </div>
          <h3>{active.title}</h3>
          <div className={styles.focusTime}>
            {active.hours}
            <span>h</span>
          </div>
          <small>Median preceding interval</small>
          <dl>
            <div>
              <dt>Matching cases</dt>
              <dd>{number(active.cases)}</dd>
            </div>
            <div>
              <dt>Disposition</dt>
              <dd>{active.kind}</dd>
            </div>
          </dl>
          <button
            className={styles.openComparison}
            type="button"
            onClick={() => open(active)}
          >
            Open finding <ArrowUpRight size={14} />
          </button>
        </aside>
      </div>
    </section>
  );
}
