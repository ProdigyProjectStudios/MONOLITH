"use client";

import { Clipboard, Download, ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { Approach, InvestigationRun } from "../lib/investigations";
import { investigationEngine } from "./studioReceipts";
import type { State } from "../lib/types";
import { Evidence } from "./Detail";
import { Flow } from "./Flow";
import styles from "./Journeys.module.css";

const numberFormat = new Intl.NumberFormat("en-GB");

function utc(raw: string) {
  return (
    new Date(raw).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC"
  );
}
function markdown(
  run: InvestigationRun,
  a: Approach,
  evidence: string[],
  s: State,
  engineLabel: string,
) {
  const sections = [
    "# " + a.name,
    "MONOLITH technical blueprint",
    "Workspace: " +
      s.tenant +
      "\nInvestigation: " +
      run.id +
      "\nApproval: " +
      utc(run.approval!.at) +
      "\nInvestigation engine: " +
      engineLabel,
    a.summary,
    "## Proposed system path\n" +
      a.nodes.map((v, i) => i + 1 + ". " + v).join("\n"),
    "## Dependencies\n" + a.dependencies.map((v) => "- " + v).join("\n"),
    "## Complexity\n" + a.complexity,
    "## Operational risk\n" + a.risk,
    ...a.artifacts.map(
      (artifact) => "## " + artifact.title + "\n\n" + artifact.body,
    ),
    "## Evidence\n" +
      evidence
        .map((id) => {
          const event = s.data.events.find((v) => v.id === id),
            doc = s.data.docs.find((v) => v.id === id);
          const source = s.data.sources.find(
            (v) => v.id === (event?.source || doc?.source),
          );
          if (event)
            return (
              "- " +
              id +
              " · " +
              event.case +
              " · " +
              event.activity +
              " · " +
              event.timestamp +
              " · " +
              (source?.name || event.source) +
              " row " +
              event.row
            );
          if (doc)
            return (
              "- " +
              id +
              " · " +
              (source?.name || doc.source) +
              " page " +
              doc.page
            );
          return "- " + id + " · unavailable in the current workspace view";
        })
        .join("\n"),
  ];
  return sections.join("\n\n") + "\n";
}
export default function BlueprintDossier({
  s,
  run,
  replayLabel,
}: {
  replayLabel?: string;
  s: State;
  run: InvestigationRun;
}) {
  const [feedback, setFeedback] = useState("");
  const result = run.result;
  const approach = result?.package?.approaches.find(
    (a) => a.id === run.approval?.approach,
  );
  if (
    !run.approval ||
    run.status !== "completed" ||
    !result?.verified ||
    !approach
  )
    return (
      <div className={styles.empty}>
        <ShieldCheck size={18} /> The dossier becomes available after
        verification and a recorded architecture approval.
      </div>
    );
  const evidence = [
    ...new Set([...(approach.evidence || []), ...result.evidence]),
  ];
  const engineLabel = replayLabel ?? investigationEngine(run);
  const text = markdown(run, approach, evidence, s, engineLabel);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Blueprint copied to clipboard.");
    } catch {
      setFeedback("Clipboard unavailable. Use Download to save the blueprint.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      "monolith-" +
      approach.id +
      "-" +
      run.id.replace(/[^a-z0-9-]/gi, "_") +
      ".md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback("Blueprint download prepared.");
  };
  const plan = approach.artifacts.find(
    (artifact) => artifact.title === "Engineering and rollout sequence",
  );
  const milestones = plan ? plan.body.trim().split(/\n+/) : [];
  const numbered =
    milestones.length > 0 && milestones.every((line) => /^\d+\.\s/.test(line));
  const specifications = approach.artifacts.filter(
    (artifact) => artifact !== plan,
  );
  return (
    <article
      className={styles.dossier}
      aria-label="Approved implementation blueprint"
    >
      <header className={styles.dossierCover}>
        <div>
          <p className={styles.darkEyebrow}>
            <ShieldCheck size={15} /> Approved design
          </p>
          <h2>{approach.name}</h2>
          <p>{approach.summary}</p>
          <dl className={styles.signature}>
            <div>
              <dt>Approval recorded</dt>
              <dd>{utc(run.approval.at)}</dd>
            </div>
            <div>
              <dt>Investigation engine</dt>
              <dd>{engineLabel}</dd>
            </div>
          </dl>
        </div>
        <div className={styles.exports}>
          <button type="button" onClick={download}>
            <Download size={16} /> Download
          </button>
          <button type="button" onClick={copy}>
            <Clipboard size={16} /> Copy
          </button>
        </div>
      </header>
      {feedback && (
        <p className={styles.feedback} role="status">
          {feedback}
        </p>
      )}

      <div className={styles.planGrid}>
        <section className={styles.plan}>
          <p className={styles.kicker}>Implementation plan</p>
          <h3>{plan ? "Rollout sequence" : "Delivery constraints"}</h3>
          {numbered ? (
            <ol>
              {milestones.map((line, i) => (
                <li key={i}>
                  <span className={styles.planOrdinal}>
                    Step {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{line.replace(/^\d+\.\s+/, "")}</span>
                </li>
              ))}
            </ol>
          ) : plan ? (
            <p className={styles.planText}>{plan.body}</p>
          ) : (
            <p>{approach.complexity}</p>
          )}
        </section>
        <section className={styles.prerequisites}>
          <h3>Dependencies</h3>
          <ul>
            {approach.dependencies.map((dep) => (
              <li key={dep}>{dep}</li>
            ))}
          </ul>
          <h3>Operational risk</h3>
          <p>{approach.risk}</p>
        </section>
      </div>
      <section
        className={styles.subsection}
        aria-label="Proposed system architecture"
      >
        <header>
          <div>
            <p className={styles.kicker}>Architecture detail</p>
            <h3>Proposed architecture</h3>
          </div>
          <span className={styles.method}>Proposed sequence</span>
        </header>
        <Flow labels={approach.nodes} />
      </section>
      <div className={styles.dossierGrid}>
        <section className={styles.specifications}>
          <p className={styles.kicker}>Build and verify</p>
          <h3>Engineering specification</h3>
          <p className={styles.complexity}>
            <b>Complexity</b> {approach.complexity}
          </p>
          {specifications.map((artifact) => (
            <details key={artifact.title}>
              <summary>
                {artifact.title}
                <ChevronDown size={16} />
              </summary>
              <pre>{artifact.body}</pre>
            </details>
          ))}
        </section>
        <aside className={styles.sourceArchive}>
          <p className={styles.kicker}>
            {numberFormat.format(evidence.length)} cited records
          </p>
          <h3>Evidence register</h3>
          {evidence.map((id) => (
            <Evidence key={id} s={s} id={id} />
          ))}
        </aside>
      </div>
    </article>
  );
}
