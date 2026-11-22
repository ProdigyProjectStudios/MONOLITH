import { useState } from "react";
import {
  ArrowRight,
  BookMarked,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  GitBranch,
  History,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type {
  ContinuousRun,
  ContinuousView,
  ContinuousStage,
} from "../lib/continuousTypes";
import type { State } from "../lib/types";
import { amount, date, n } from "./ContinuousPeriods";
import { Sources } from "./ContinuousSignals";
import css from "./Continuous.module.css";

const stages = [
  "discovery",
  "process",
  "strategy",
  "architect",
  "simulation",
  "verification",
];
const stageNames: Record<string, string> = {
  discovery: "Discovery",
  process: "Process intelligence",
  strategy: "Automation strategy",
  architect: "Solutions architect",
  simulation: "Simulation",
  verification: "Verification",
};
const friendly = (s: string) => s.replaceAll("_", " ").replaceAll("-", " ");
const title = (s: string) => friendly(s).replace(/^./, (x) => x.toUpperCase());
const detailFields: Record<string, string[]> = {
  discovery: [
    "support",
    "support_period",
    "systems",
    "witnesses",
    "dataset_sha256",
  ],
  process: ["metric", "windows", "method", "test", "caveat"],
  strategy: ["prior_decisions", "operating_mode", "human_authority"],
  architect: ["alternatives", "eligible_designs", "prior_rejections"],
  simulation: ["assumptions", "trials", "limitation"],
  verification: [
    "checks",
    "verdict",
    "selected",
    "eligible_designs",
    "rejected_designs",
    "human_authority",
  ],
};
function StageReceipt({ stage }: { stage: ContinuousStage }) {
  const [open, setOpen] = useState(false);
  const contents: Record<string, unknown> = { ...stage };
  const keys = (detailFields[stage.stage] || []).filter((k) => k in contents);
  if (!keys.length) return null;
  return (
    <details
      className={css.details}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Stage measurements and records <ChevronDown size={14} />
      </summary>
      {open && (
        <dl className={css.stageLedger}>
          {keys.map((k) => (
            <div key={k}>
              <dt>{title(k)}</dt>
              <dd>
                {typeof contents[k] === "string" ? (
                  String(contents[k])
                ) : (
                  <pre>{JSON.stringify(contents[k], null, 2)}</pre>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}
export function CheckpointTimeline({
  run,
  s,
}: {
  run: ContinuousRun;
  s: State;
}) {
  const [selected, setSelected] = useState<string>("");
  const checkpoint =
    run.checkpoints.find((c) => c.stage === selected) ?? run.checkpoints.at(-1);
  const order = [
    ...new Set([...stages, ...run.checkpoints.map((c) => c.stage)]),
  ];
  return (
    <section className={css.timeline} aria-label="Investigation checkpoints">
      <header>
        <span className={css.overline}>
          <Workflow size={13} />
          Deterministic investigation
        </span>
        <span>{n(run.checkpoints.length)} recorded checkpoints</span>
      </header>
      <div className={css.stages}>
        {order.map((id, i) => {
          const found = run.checkpoints.find((c) => c.stage === id);
          return (
            <button
              key={id}
              type="button"
              aria-label={"Inspect checkpoint " + (stageNames[id] ?? title(id))}
              aria-pressed={checkpoint?.stage === id}
              disabled={!found}
              onClick={() => setSelected(id)}
            >
              <span>{found ? <Check size={14} /> : i + 1}</span>
              <strong>{stageNames[id] ?? title(id)}</strong>
            </button>
          );
        })}
      </div>
      {checkpoint && (
        <article className={css.checkpoint} key={checkpoint.stage}>
          <div className={css.checkHead}>
            <h4>{stageNames[checkpoint.stage] ?? title(checkpoint.stage)}</h4>
            <span>{checkpoint.agent}</span>
          </div>
          <p>{checkpoint.summary}</p>
          <StageReceipt stage={checkpoint} />
          {!!checkpoint.findings?.length && (
            <div className={css.findings}>
              {checkpoint.findings.map((f, i) => (
                <details key={i} className={css.details}>
                  <summary>
                    <span>{title(f.kind)} finding</span>
                    <ChevronDown size={13} />
                  </summary>
                  <p>{f.text}</p>
                  <Sources
                    snapshotId={run.snapshot_id}
                    s={s}
                    ids={f.evidence}
                    label="Finding evidence"
                  />
                </details>
              ))}
            </div>
          )}
          <Sources
            snapshotId={run.snapshot_id}
            s={s}
            ids={checkpoint.evidence}
            label="Checkpoint evidence"
          />
        </article>
      )}
      {!checkpoint && (
        <p className={css.note}>
          The first checkpoint will appear when the investigation worker records
          it.
        </p>
      )}
    </section>
  );
}
export function Investigations({
  view,
  s,
  busy,
  onResume,
  onStudio,
  snapshotId,
}: {
  view: ContinuousView;
  s: State;
  busy: boolean;
  onResume: (id: string) => void;
  onStudio: (id?: string) => void;
  snapshotId: string;
}) {
  const [selected, setSelected] = useState("");
  const [scope, setScope] = useState("all");
  const records = view.investigations.filter(
    (r) => scope === "all" || r.snapshot_id === snapshotId,
  );
  const run = records.find((r) => r.id === selected) ?? records[0];
  return (
    <section className={css.panel}>
      <header className={css.panelHead}>
        <div>
          <span className={css.overline}>
            <Workflow size={13} />
            Investigation history
          </span>
          <h2>Recorded investigations</h2>
        </div>
        <label className={css.select}>
          <select
            aria-label="Investigation scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">All revisions</option>
            <option value="selected">Selected revision</option>
          </select>
        </label>
      </header>
      {run ? (
        <div className={css.runGrid}>
          <div className={css.recordList}>
            {records.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={run.id === r.id}
                onClick={() => setSelected(r.id)}
              >
                <span className={css.recordIcon}>
                  <Workflow size={16} />
                </span>
                <span>
                  <strong>
                    {view.decisions.find((d) => d.run_id === r.id)?.title ||
                      view.signals.find((x) => x.id === r.signal_id)?.title ||
                      "Signal investigation"}
                  </strong>
                  <small>
                    {date(r.created_at, true)} UTC · {r.status}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className={css.runDetail}>
            <div className={css.detailHead}>
              <div>
                <span className={css.overline}>
                  <CircleDot size={13} />
                  {run.status}
                </span>
                <h3>
                  {view.decisions.find((d) => d.run_id === run.id)?.title ||
                    view.signals.find((x) => x.id === run.signal_id)?.title ||
                    "Signal investigation"}
                </h3>
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => onStudio(run.id)}
              >
                Open in Studio <ArrowRight size={14} />
              </button>
            </div>
            <small className={css.recordId}>{run.id}</small>
            {run.error && <p role="alert">{run.error}</p>}
            <CheckpointTimeline key={run.id} s={s} run={run} />
            {run.status === "failed" && (
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => onResume(run.id)}
              >
                <RefreshCw size={14} />
                Resume investigation
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={css.empty}>
          <Workflow size={21} />
          <h3>No investigations recorded</h3>
          <p>
            Qualifying signals trigger deterministic investigations. Each
            completed stage is saved here.
          </p>
        </div>
      )}
    </section>
  );
}
function DecisionDetail({
  record,
  snapshotId,
  updates,
  s,
  onStudio,
}: {
  snapshotId?: string;
  record: ContinuousView["decisions"][number];
  updates: ContinuousView["reassessments"];
  s: State;
  onStudio: (id?: string) => void;
}) {
  return (
    <article className={css.runDetail}>
      <div className={css.detailHead}>
        <div>
          <span className={css.overline}>
            <BookMarked size={13} />
            Decision record
          </span>
          <h3>{record.title}</h3>
        </div>
        {record.run_id && (
          <button
            className="btn"
            type="button"
            onClick={() => onStudio(record.run_id)}
          >
            Open in Studio <ArrowRight size={14} />
          </button>
        )}
      </div>
      <p>{record.summary}</p>
      <div className={css.decisionStats}>
        <div>
          <small>Decision</small>
          <strong>{title(record.decision)}</strong>
        </div>
        <div>
          <small>Selected approach</small>
          <strong>{title(record.selected || "Unavailable")}</strong>
        </div>
        <div>
          <small>Recorded</small>
          <strong>{date(record.at)}</strong>
        </div>
      </div>
      {record.human_authority && (
        <div className={css.authority}>
          <ShieldCheck size={16} />
          <div>
            <strong>Human authority</strong>
            <p>{record.human_authority}</p>
            {record.approval && (
              <p>
                Approved {date(record.approval.at, true)} UTC ·{" "}
                {title(record.approval.approach)}
              </p>
            )}
          </div>
        </div>
      )}
      <div className={css.decisionMeasure}>
        <span>
          <History size={14} />
          Measurements at decision
        </span>
        <strong>
          {amount(record.baseline, record.unit)} <ArrowRight size={12} />{" "}
          {amount(record.current, record.unit)}
        </strong>
        <small>
          {record.as_of
            ? "Evidence through " + date(record.as_of)
            : "Recorded in the source dossier"}
        </small>
      </div>
      {!!record.findings.length && (
        <details className={css.details}>
          <summary>
            Recorded findings <span>{record.findings.length}</span>
            <ChevronDown size={14} />
          </summary>
          {record.findings.map((f, i) => (
            <div key={i} className={css.rejected}>
              <strong>{title(f.kind)}</strong>
              <p>{f.text}</p>
              <Sources
                snapshotId={snapshotId}
                studio={record.origin === "refund_studio"}
                s={s}
                ids={f.evidence}
                label="Finding evidence"
              />
            </div>
          ))}
        </details>
      )}
      <Sources
        snapshotId={snapshotId}
        studio={record.origin === "refund_studio"}
        ids={record.evidence}
        s={s}
        label="Decision evidence"
      />
      {!!record.rejected_designs?.length && (
        <details className={css.details}>
          <summary>
            Rejected designs <span>{record.rejected_designs.length}</span>
            <ChevronDown size={14} />
          </summary>
          {record.rejected_designs.map((design, i) => (
            <div key={i} className={css.rejected}>
              <strong>{title(design.id)}</strong>
              <p>{design.reason}</p>
              <Sources
                snapshotId={snapshotId}
                studio={record.origin === "refund_studio"}
                ids={design.evidence}
                s={s}
              />
            </div>
          ))}
        </details>
      )}
      <section className={css.revisions}>
        <h4>
          <History size={16} />
          Reassessment history
        </h4>
        {updates.length ? (
          updates.map((update) => (
            <article key={update.id}>
              <span className={css.recordIcon}>
                <GitBranch size={15} />
              </span>
              <div>
                <div className={css.reassessTitle}>
                  <strong>{title(update.status)}</strong>
                  <small>{date(update.at, true)} UTC</small>
                </div>
                <p>{update.summary}</p>
                <span className={css.valuePair}>
                  {amount(update.from_value, update.unit)}{" "}
                  <ArrowRight size={12} />{" "}
                  {amount(update.to_value, update.unit)} ·{" "}
                  {amount(update.delta, update.unit, true)}
                </span>
                <Sources
                  snapshotId={update.snapshot_id}
                  s={s}
                  ids={update.evidence}
                  label="Reassessment evidence"
                />
              </div>
            </article>
          ))
        ) : (
          <p className={css.note}>
            No later reassessment has been recorded for this decision.
          </p>
        )}
      </section>
    </article>
  );
}
export function DecisionMemory({
  view,
  s,
  onStudio,
}: {
  view: ContinuousView;
  s: State;
  onStudio: (id?: string) => void;
}) {
  const [selected, setSelected] = useState(""),
    [scope, setScope] = useState("all");
  const withUpdates = new Set(view.reassessments.map((r) => r.decision_id));
  const records = view.decisions.filter(
    (d) => scope === "all" || withUpdates.has(d.id),
  );
  const record = records.find((d) => d.id === selected) ?? records[0];
  return (
    <section className={css.panel}>
      <header className={css.panelHead}>
        <div>
          <span className={css.overline}>
            <BookMarked size={13} />
            Organizational memory
          </span>
          <h2>Decision memory</h2>
        </div>
        <label className={css.select}>
          <select
            aria-label="Filter decisions"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">All decisions</option>
            <option value="reassessed">Reassessed decisions</option>
          </select>
        </label>
      </header>
      {record ? (
        <div className={css.runGrid}>
          <div className={css.recordList}>
            {records.map((d) => (
              <button
                type="button"
                key={d.id}
                aria-pressed={d.id === record.id}
                onClick={() => setSelected(d.id)}
              >
                <span className={css.recordIcon}>
                  <Layers3 size={15} />
                </span>
                <span>
                  <strong>{d.title}</strong>
                  <small>
                    {date(d.at)} ·{" "}
                    {withUpdates.has(d.id) ? "Reassessed" : "Decision recorded"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <DecisionDetail
            key={record.id}
            record={record}
            snapshotId={
              record.origin === "refund_studio"
                ? record.run_id
                : view.investigations.find((r) => r.id === record.run_id)
                    ?.snapshot_id
            }
            updates={view.reassessments.filter(
              (r) => r.decision_id === record.id,
            )}
            s={s}
            onStudio={onStudio}
          />
        </div>
      ) : (
        <div className={css.empty}>
          <Clock3 size={21} />
          <h3>
            {scope === "all"
              ? "No decisions recorded"
              : "No reassessed decisions"}
          </h3>
          <p>
            {scope === "all"
              ? "Completed investigations retain their recommendation, source evidence and human decision boundary here."
              : "A later observation must qualify for reassessment before it appears here."}
          </p>
        </div>
      )}
    </section>
  );
}
