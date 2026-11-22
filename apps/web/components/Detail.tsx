import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  FileText,
  FlaskConical,
  Rows3,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import type { Rec, State } from "../lib/types";
import ScenarioLab from "./ScenarioLab";
import css from "./Detail.module.css";
import { number } from "./UI";
import { can } from "../lib/client";
export function Evidence({
  id,
  s,
  showTime = false,
}: {
  id: string;
  s: State;
  showTime?: boolean;
}) {
  const e = s.data.events.find((x) => x.id === id),
    d = s.data.docs.find((x) => x.id === id);
  const src = s.data.sources.find((x) => x.id === (e?.source || d?.source));
  return (
    <details className={`evidence ${css.record}`}>
      <summary>
        {d ? <FileText size={15} aria-hidden="true" /> : <Rows3 size={15} aria-hidden="true" />}
        <span>
          {e?.activity || src?.name || "Record"}
          {showTime && e && (
            <small className={css.timestamp}>
              {e.system} ·{" "}
              {new Date(e.timestamp).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "UTC",
              })}{" "}
              UTC
            </small>
          )}
        </span>
        <code>{e ? "row " + e.row : d ? "p. " + d.page : id.slice(0, 11)}</code>
        <ChevronDown size={14} className={css.chevron} aria-hidden="true" />
      </summary>
      <div>
        <p>
          {e
            ? e.case +
              " · " +
              e.system +
              " · " +
              new Date(e.timestamp).toLocaleString("en-GB", {
                timeZone: "UTC",
              }) +
              " UTC"
            : d?.text}
        </p>
        <small>
          {src
            ? [
                src.name,
                e ? "row " + e.row : d ? "page " + d.page : "",
                src.synthetic ? "Synthetic" : "Imported",
              ]
                .filter(Boolean)
                .join(" · ")
            : "Source unavailable in this snapshot"}
        </small>
        <code>{id}</code>
      </div>
    </details>
  );
}
export function Detail({
  r,
  s,
  close,
  approve,
  busy,
  blueprint,
  investigate,
}: {
  r: Rec;
  s: State;
  close: () => void;
  approve: (decision: string) => void;
  busy: boolean;
  blueprint: () => void;
  investigate: () => void;
}) {
  const [tab, setTab] = useState("Finding"),
    [coverage, setCoverage] = useState(50),
    [reduction, setReduction] = useState(25);
  const canInvestigate = can(s, "investigations:run") && (!s.ai || can(s, "models:run"));
  const canApprove = can(s, "decisions:approve");
  const last = s.audit.find(
    (a) =>
      a.detail === r.id &&
      ["Approve shadow pilot", "Keep in review"].includes(a.action),
  );
  return (
    <div
      className={`overlay ${css.backdrop}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={r.title}
        className={`drawer ${css.drawer}`}
        data-wide={tab === "Scenario" && r.id === "refund"}
      >
        <div className={css.top}>
          <span>Opportunity detail <span aria-hidden="true">/</span> {r.area}</span>
          <button
            className="icon-btn"
            aria-label="Close detail"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <header className={css.cover}>
          <span className={css.disposition}>{r.kind}</span>
          <h2>{r.title}</h2>
          <p>{r.action}.</p>
        </header>
        {r.id === "refund" && (
          <div className={css.investigate}>
            <button
              className={css.primary}
              onClick={investigate}
              disabled={busy || !canInvestigate}
            >
              <BrainCircuit size={16} />
              {s.ai ? "Investigate with AI" : "Investigate refund delays"}
            </button>
            <small>
              {canInvestigate
                ? (s.ai ? "Backend AI mode configured" : "Deterministic investigation · no provider calls")
                : (s.ai ? "Live model execution requires a workspace administrator." : "Investigation access is required to start a run.")}
            </small>
          </div>
        )}
        <div className={css.tabs} role="group" aria-label="Opportunity detail view">
          {["Finding", "Evidence", "Scenario"].map((t) => (
            <button aria-pressed={tab === t} key={t} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        {tab === "Finding" ? (
          <>
            <dl className={css.metrics}>
              <div><dt>Linked cases</dt><dd>{number(r.cases)}</dd></div>
              <div><dt>Suitability</dt><dd>{r.score}<small>/100</small></dd></div>
              <div><dt>Rule confidence</dt><dd>{r.confidence}<small>%</small></dd></div>
            </dl>
            {[
              ["Observed fact", r.observed],
              ["Inference", r.inference],
              ["Limitations", r.limitations],
            ].map(([k, v]) => (
              <div key={k} className={css.section}>
                <h3>{k}</h3>
                <p>{v}</p>
              </div>
            ))}
            {r.dependencies.length > 0 && (
              <div className={css.section}>
                <h3>Dependencies</h3>
                <ul>{r.dependencies.map((value) => <li key={value}>{value}</li>)}</ul>
              </div>
            )}
            {r.agent_findings?.map((f, i) => (
              <div key={i} className={css.section}>
                <h3>Agent assessment</h3>
                <p>{f.statement}</p>
                <small>{f.limitation}</small>
                {f.evidence.map((id) => (
                  <Evidence key={id} id={id} s={s} />
                ))}
              </div>
            ))}
            <button className={css.secondary} onClick={blueprint}>
              Technical blueprint <ChevronRight size={15} />
            </button>
          </>
        ) : tab === "Evidence" ? (
          <div className={css.section}>
            <h3>Source records</h3>
            <p>{number(r.evidence.length)} cited {r.evidence.length === 1 ? "record" : "records"}. Open a row or page to inspect its origin.</p>
            {r.evidence.map((id) => (
              <Evidence key={id} id={id} s={s} />
            ))}
          </div>
        ) : r.id === "refund" ? (
          <ScenarioLab s={s} />
        ) : (
          <div className={css.section}>
            <h3>Scenario simulation</h3>
            {r.kind === "Human-led" ? (
              <p>
                Human review is retained. Automated time reduction is excluded
                from this scenario.
              </p>
            ) : (
              <>
                <p>
                  Estimate aggregate elapsed case-hours under two explicit
                  assumptions.
                </p>
                {[
                  ["Coverage", coverage, setCoverage],
                  ["Interval reduction", reduction, setReduction],
                ].map(([label, value, set]) => (
                  <label className={css.range} key={label as string}>
                    {label as string}
                    <b>{value as number}%</b>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={value as number}
                      onChange={(e) =>
                        (set as (v: number) => void)(Number(e.target.value))
                      }
                    />
                  </label>
                ))}
                <div className={css.estimate}>
                  <FlaskConical size={18} />
                  <strong>
                    {(
                      (r.cases * r.hours * coverage * reduction) /
                      10000
                    ).toLocaleString("en-GB", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    h
                  </strong>
                  <span>modelled interval reduction</span>
                </div>
                <p>
                  {r.cases} cases × {r.hours}h median interval × coverage ×
                  reduction. Intervals can overlap. Labour savings are
                  unmeasured.
                </p>
              </>
            )}
          </div>
        )}
        <div className={css.review}>
          <ShieldCheck size={17} />
          <div>
            <b>Human approval</b>
            <p>
              {last
                ? last.action + " · recorded in the audit trail."
                : canApprove
                  ? "Record a review decision. A shadow pilot only evaluates proposed changes."
                  : "A workspace approver can record a decision on this finding."}
            </p>
            <button
              className={css.secondary}
              disabled={busy || !canApprove}
              onClick={() =>
                approve(
                  r.kind === "Human-led"
                    ? "Keep in review"
                    : "Approve shadow pilot",
                )
              }
            >
              {r.kind === "Human-led"
                ? "Keep in review"
                : "Approve shadow pilot"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
