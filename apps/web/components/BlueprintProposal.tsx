import { FileSearch, ShieldCheck } from "lucide-react";
import type { State, Rec } from "../lib/types";
import { Flow } from "./Flow";
import { number } from "./UI";
import styles from "./Journeys.module.css";

export function Blueprint({
  s,
  id,
  pick,
  open,
}: {
  s: State;
  id: string;
  pick: (id: string) => void;
  open: (r: Rec) => void;
}) {
  const rec =
    s.report.recommendations.find((r) => r.id === id) ??
    s.report.recommendations[0];
  if (!rec)
    return (
      <div className={styles.empty}>
        <FileSearch size={18} /> A supported opportunity is needed to generate a
        blueprint.
      </div>
    );
  const design = s.report.blueprints[rec.id];
  const recorded = s.audit.find(
    (entry) =>
      entry.detail === rec.id &&
      ["Approve shadow pilot", "Keep in review"].includes(entry.action),
  );
  return (
    <div className={styles.work}>
      <section className={styles.proposal} aria-label="Proposed change">
        <div className={styles.proposalIntro}>
          <label className={styles.fieldLabel}>
            Opportunity
            <select
              aria-label="Blueprint opportunity"
              value={rec.id}
              onChange={(e) => pick(e.target.value)}
            >
              {s.report.recommendations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.kicker}>Proposed change</p>
          <h2>{rec.action}</h2>
          <p className={styles.proposalData}>
            <strong>{number(rec.cases)}</strong> matching cases <span>·</span>{" "}
            <strong>{rec.hours} h</strong> median preceding interval
          </p>
        </div>
        <aside className={styles.decision}>
          <div className={styles.darkEyebrow}>
            <ShieldCheck size={17} /> Human decision
          </div>
          <h3>
            {recorded
              ? "Review recorded"
              : rec.kind === "Human-led"
                ? "Retain human review"
                : "Review the shadow pilot"}
          </h3>
          <p>
            {recorded
              ? `${recorded.action}. The workspace audit holds the decision.`
              : rec.kind === "Human-led"
                ? "An accountable reviewer retains authority over every dispute decision."
                : "Review the source records and pilot constraints before authorising a shadow run."}
          </p>
          <button type="button" onClick={() => open(rec)}>
            Review proposal
          </button>
        </aside>
      </section>

      <div className={styles.planGrid}>
        <section className={styles.plan}>
          <p className={styles.kicker}>Implementation plan</p>
          <h2>Pilot roadmap</h2>
          <ol>
            {(design?.phases ?? rec.roadmap).map((phase, i) => (
              <li key={i}>
                <span className={styles.planOrdinal}>
                  Phase {String(i + 1).padStart(2, "0")}
                </span>
                <span>{phase}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.prerequisites}>
          <h3>Dependencies</h3>
          <ul>
            {(design?.dependencies ?? rec.dependencies).map((dep, i) => (
              <li key={i}>{dep}</li>
            ))}
          </ul>
          <h3>Decision boundary</h3>
          <p>
            {rec.kind === "Human-led"
              ? "Automation can prepare evidence for the reviewer. The reviewer decides the outcome."
              : "A human authorises rollout after the shadow run and exception review."}
          </p>
        </section>
      </div>
      <section className={styles.subsection} aria-label="Architecture detail">
        <header>
          <div>
            <p className={styles.kicker}>Architecture detail</p>
            <h2>Proposed system path</h2>
          </div>
          <span className={styles.method}>Proposed sequence</span>
        </header>
        <Flow labels={design?.nodes ?? rec.architecture} />
      </section>
    </div>
  );
}
