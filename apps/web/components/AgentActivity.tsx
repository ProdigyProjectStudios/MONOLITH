import { ChevronRight, ListFilter } from "lucide-react";
import { useState } from "react";
import type { Report, State } from "../lib/types";
import { Evidence } from "./Detail";
import { number } from "./UI";
import css from "./Operations.module.css";

function duration(ms: number) {
  return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : ms.toFixed(2) + " ms";
}

// The deterministic receipts identify these tools by name. The displayed result
// is read from the same report as the receipt, including after a window change.
function reportOutput(tool: string, r: Report) {
  switch (tool) {
    case "resolve_cases":
      return (
        number(r.events) +
        " events resolved to " +
        number(r.cases) +
        " linked cases."
      );
    case "discover_directly_follows":
      return (
        number(r.variants) +
        " process variants across " +
        number(r.systems.length) +
        " systems."
      );
    case "score_observed_patterns":
      return (
        number(r.recommendations.length) +
        " findings evaluated, including " +
        number(r.auto) +
        " automation candidates."
      );
    case "compile_blueprints":
      return (
        number(Object.keys(r.blueprints).length) +
        " proposed implementation plans."
      );
    case "validate_evidence_references":
      return (
        number(new Set(r.recommendations.flatMap((rec) => rec.evidence)).size) +
        " distinct source references across the findings."
      );
    default:
      return "";
  }
}

export function Agents({ s }: { s: State }) {
  const { traces } = s.report;
  const total = traces.reduce((sum, stage) => sum + stage.ms, 0);
  const peak = Math.max(0, ...traces.map((stage) => stage.ms));
  const [action, setAction] = useState("");
  const entries = s.audit.filter((entry) => !action || entry.action === action);
  return (
    <div className={css.workspace}>
      <section className={css.ledger} aria-label="Latest analysis execution">
        <header className={css.ledgerHead}>
          <div>
            <p className={css.kicker}>Latest analysis · {s.report.engine}</p>
            <h2>Specialist execution</h2>
            <p>
              {number(traces.length)} recorded stages in the {s.report.days}-day
              analysis.
            </p>
          </div>
          {traces.length > 0 && (
            <div className={css.runTime}>
              <strong>{duration(total)}</strong>
              <span>Summed stage time</span>
            </div>
          )}
        </header>
        {traces.length ? (
          <>
            <div className={css.ledgerColumns} aria-hidden="true">
              <span>Stage / tool</span>
              <span>Result</span>
              <span>Duration</span>
            </div>
            {traces.map((stage, index) => {
              const output = reportOutput(stage.tool, s.report);
              return (
                <details className={css.record} key={stage.role + index}>
                  <summary>
                    <span className={css.index}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={css.stageName}>
                      <strong>{stage.role}</strong>
                      <code>{stage.tool}</code>
                    </span>
                    <span className={css.result}>{stage.status}</span>
                    <span className={css.timeCell}>
                      <span aria-hidden="true" className={css.durationRail}>
                        <i
                          style={{
                            width: (peak ? (100 * stage.ms) / peak : 0) + "%",
                          }}
                        />
                      </span>
                      <span>{duration(stage.ms)}</span>
                    </span>
                    <ChevronRight size={15} />
                  </summary>
                  <div className={css.recordDetail}>
                    {stage.finding ? (
                      <>
                        <h3>Recorded finding</h3>
                        <p>{stage.finding.statement}</p>
                        <p className={css.note}>{stage.finding.limitation}</p>
                        {stage.finding.evidence.map((id) => (
                          <Evidence key={id} s={s} id={id} />
                        ))}
                      </>
                    ) : output ? (
                      <>
                        <h3>Report output</h3>
                        <p>{output}</p>
                      </>
                    ) : (
                      <p>
                        {stage.tool} recorded {stage.status.toLowerCase()} in{" "}
                        {duration(stage.ms)}.
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </>
        ) : (
          <p className={css.empty}>
            Run an analysis to record its specialist tools and results.
          </p>
        )}
      </section>
      <section className={css.audit} aria-label="Audit records">
        <header className={css.sectionHead}>
          <h2>Workspace audit trail</h2>
          {s.audit.length > 0 && (
            <label className={css.filter}>
              <ListFilter size={15} />
              <select
                aria-label="Filter audit actions"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                <option value="">All actions</option>
                {[...new Set(s.audit.map((entry) => entry.action))].map(
                  (type) => (
                    <option key={type}>{type}</option>
                  ),
                )}
              </select>
            </label>
          )}
        </header>
        {entries.length ? (
          <ol className={css.auditLog}>
            {entries.map((a, i) => (
              <li key={a.at + a.action + i}>
                <time dateTime={a.at}>
                  {new Date(a.at).toLocaleString("en-GB", { timeZone: "UTC" })}{" "}
                  UTC
                </time>
                <div>
                  <strong>{a.action}</strong>
                  <p>{a.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={css.empty}>
            {s.audit.length
              ? "No audit entries match this action."
              : "Analysis runs, imports and approval decisions will appear here."}
          </p>
        )}
      </section>
    </div>
  );
}
