"use client";

import {
  BookOpen,
  Boxes,
  Check,
  Clipboard,
  Download,
  FileCode2,
  FileText,
  Layers3,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { Approach, InvestigationRun } from "../lib/investigations";
import { investigationEngine } from "./studioReceipts";
import type { State } from "../lib/types";
import { Evidence } from "./Detail";
import { Flow } from "./Flow";
import styles from "./FlagshipLab.module.css";

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
      <div className={styles.message}>
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
  return (
    <article
      className={styles.dossier}
      aria-label="Approved implementation blueprint"
    >
      <header className={styles.cover}>
        <div className={styles.coverTop}>
          <span className={styles.coverType}>
            <Layers3 size={15} /> Implementation blueprint
          </span>
          <span className={styles.approved}>
            <Check size={12} /> Approved
          </span>
        </div>
        <div className={styles.coverTitle}>
          <div>
            <h2>{approach.name}</h2>
            <p>{approach.summary}</p>
          </div>
          <div className={styles.export}>
            <button type="button" onClick={copy}>
              <Clipboard size={14} /> Copy
            </button>
            <button type="button" onClick={download}>
              <Download size={14} /> Download
            </button>
          </div>
        </div>
        <div className={styles.meta}>
          <span>
            <ShieldCheck size={13} />
            {utc(run.approval.at)}
          </span>
          <span>{engineLabel}</span>
          <span>{evidence.length} evidence references</span>
        </div>
        {feedback && (
          <p className={styles.feedback} role="status">
            {feedback}
          </p>
        )}
      </header>
      <section
        className={styles.diagram}
        aria-label="Proposed system architecture"
      >
        <h3>
          <Boxes size={16} /> Proposed architecture
        </h3>
        <Flow labels={approach.nodes} blue />
      </section>
      <div className={styles.dossierGrid}>
        <section className={styles.artifacts}>
          <h3>
            <FileCode2 size={16} /> Engineering specification
          </h3>
          {approach.artifacts.map((artifact, index) => (
            <details key={artifact.title} open={index === 0 ? true : undefined}>
              <summary>
                <FileText size={15} />
                {artifact.title}
              </summary>
              <pre>{artifact.body}</pre>
            </details>
          ))}
        </section>
        <aside className={styles.specRail}>
          <section>
            <h3>
              <Link2 size={15} /> Dependencies
            </h3>
            <ul>
              {approach.dependencies.map((dep) => (
                <li key={dep}>{dep}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3>
              <ShieldCheck size={15} /> Delivery constraints
            </h3>
            <dl>
              <dt>Engineering complexity</dt>
              <dd>{approach.complexity}</dd>
              <dt>Operational risk</dt>
              <dd>{approach.risk}</dd>
            </dl>
          </section>
          <section>
            <h3>
              <BookOpen size={15} /> Evidence register
            </h3>
            <div className={styles.evidenceList}>
              {evidence.map((id) => (
                <Evidence key={id} s={s} id={id} />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
