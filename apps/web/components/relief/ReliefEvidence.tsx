import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Source } from "../../lib/types";
import type { FieldWindow, SystemMeasure } from "./model";
import styles from "../Overview.module.css";

const formatDate = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export default function ReliefEvidence({
  system,
  frame,
  sources,
  close,
  openMap,
}: {
  system: SystemMeasure;
  frame: FieldWindow;
  sources: Source[];
  close: () => void;
  openMap: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog
      className={styles.evidence}
      ref={dialog}
      aria-label={system.name + " evidence"}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) {
          const box = dialog.current!.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }
      }}
    >
      <header>
        <div>
          <p>Field evidence</p>
          <h2>{system.name}</h2>
        </div>
        <button
          type="button"
          autoFocus
          onClick={close}
          aria-label="Close field evidence"
        >
          <X size={21} />
        </button>
      </header>
      <p className={styles.timeNote}>
        {frame.id === "report" ? "Full report" : "Replay window"} ·{" "}
        {new Date(frame.start).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })}{" "}
        –{" "}
        {new Date(frame.end - 1).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })}{" "}
        UTC
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>Observed events</dt>
          <dd>{system.count.toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt>Linked cases</dt>
          <dd>{system.cases.toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt>Handoffs in / out</dt>
          <dd>
            {system.arrivals} / {system.departures}
          </dd>
        </div>
      </dl>
      {system.interval && (
        <section className={styles.pair}>
          <h3>Longest median interval</h3>
          <p>
            {system.interval.from} → {system.interval.to}
          </p>
          <strong>{system.wait} h</strong> across{" "}
          {system.interval.count.toLocaleString("en-GB")} observed transitions.
        </section>
      )}
      <section className={styles.witness}>
        <h3>
          {system.interval ? "Source rows at the median" : "Source records"}
        </h3>
        {system.witnesses.length === 0 && (
          <p>No source observations in this window.</p>
        )}
        {system.witnesses.map((row) => {
          const source = sources.find((s) => s.id === row.source);
          return (
            <details key={row.id}>
              <summary>
                <span>{row.activity}</span>
                <code>{row.case}</code>
              </summary>
              <p>
                {row.system} · {formatDate.format(new Date(row.timestamp))} UTC
              </p>
              <p>
                {source?.name ?? row.source} · row {row.row} ·{" "}
                {row.synthetic ? "Synthetic" : "Imported"}
              </p>
              <code>{row.id}</code>
            </details>
          );
        })}
      </section>
      <button type="button" className={styles.mapAction} onClick={openMap}>
        Explore {system.name} in Business Map
      </button>
    </dialog>
  );
}
