import styles from "./Journeys.module.css";

/** A proposed order of operations, read as a continuous implementation path. */
export function Flow({ labels }: { labels: string[] }) {
  return (
    <div
      role="group"
      aria-label="Proposed architecture flow"
      className={styles.systemPath}
    >
      <ol>
        {labels.map((label, i) => (
          <li key={i}>
            <span className={styles.pathMark} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
