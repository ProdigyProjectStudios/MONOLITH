import {
  ChevronRight,
  FlaskConical,
  Link2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import type { Rec, State } from "../lib/types";
import ScenarioLab from "./ScenarioLab";
import { BrainCircuit } from "lucide-react";
import { RecGlyph, Tag } from "./UI";
export function Evidence({ id, s }: { id: string; s: State }) {
  const e = s.data.events.find((x) => x.id === id),
    d = s.data.docs.find((x) => x.id === id);
  const src = s.data.sources.find((x) => x.id === (e?.source || d?.source));
  return (
    <details className="evidence">
      <summary>
        <Link2 size={13} />
        <span>{e?.activity || src?.name || "Record"}</span>
        <code>{id.slice(0, 11)}</code>
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
          {src?.name} · {e ? "row " + e.row : "page " + d?.page} ·{" "}
          {src?.synthetic ? "Synthetic" : "Imported"}
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
  const last = s.audit.find(
    (a) =>
      a.detail === r.id &&
      ["Approve shadow pilot", "Keep in review"].includes(a.action),
  );
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={r.title}
        className={
          "drawer" +
          (tab === "Scenario" && r.id === "refund" ? " scenario-wide" : "")
        }
      >
        <div className="drawer-top">
          <span className="section-eyebrow">OPPORTUNITY DETAIL</span>
          <button
            className="icon-btn"
            aria-label="Close detail"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <div className="detail-title">
          <RecGlyph r={r} />
          <Tag color={r.kind === "Human-led" ? "orange" : "lime"}>{r.kind}</Tag>
        </div>
        <h2>{r.title}</h2>
        <p className="lede">{r.action}.</p>
        {r.id === "refund" && (
          <div className="detail-investigate">
            <button
              className="btn primary"
              onClick={investigate}
              disabled={busy}
            >
              <BrainCircuit size={16} />
              {s.ai ? "Investigate with AI" : "Investigate refund delays"}
            </button>
            <small>
              {s.ai
                ? "Backend AI mode configured"
                : "Deterministic investigation · no provider calls"}
            </small>
          </div>
        )}
        <div className="tabs">
          {["Finding", "Evidence", "Scenario"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={tab === t ? "on" : ""}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "Finding" ? (
          <>
            <div className="mini-stats">
              <div>
                <small>Suitability</small>
                <b>{r.score}/100</b>
              </div>
              <div>
                <small>Rule confidence</small>
                <b>{r.confidence}%</b>
              </div>
              <div>
                <small>Linked cases</small>
                <b>{r.cases}</b>
              </div>
            </div>
            {[
              ["Observed fact", r.observed],
              ["Inference", r.inference],
              ["Limitations", r.limitations],
              ["Dependencies", r.dependencies.join(". ") + "."],
            ].map(([k, v]) => (
              <div key={k} className="detail-section">
                <h3>{k}</h3>
                <p>{v}</p>
              </div>
            ))}
            {r.agent_findings?.map((f, i) => (
              <div key={i} className="detail-section">
                <h3>Agent assessment</h3>
                <p>{f.statement}</p>
                <small>{f.limitation}</small>
                {f.evidence.map((id) => (
                  <Evidence key={id} id={id} s={s} />
                ))}
              </div>
            ))}
            <button className="btn" onClick={blueprint}>
              Technical blueprint <ChevronRight size={15} />
            </button>
          </>
        ) : tab === "Evidence" ? (
          <div className="detail-section">
            <h3>Source records</h3>
            <p>Open a record to inspect its source and provenance.</p>
            {r.evidence.map((id) => (
              <Evidence key={id} id={id} s={s} />
            ))}
          </div>
        ) : r.id === "refund" ? (
          <ScenarioLab s={s} />
        ) : (
          <div className="detail-section">
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
                  <label className="range" key={label as string}>
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
                <div className="estimate">
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
        <div className="review-box">
          <ShieldCheck size={17} />
          <div>
            <b>Human approval</b>
            <p>
              {last
                ? last.action + " · recorded in the audit trail."
                : "Record a review decision. A shadow pilot only evaluates proposed changes."}
            </p>
            <button
              className="btn"
              disabled={busy}
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
