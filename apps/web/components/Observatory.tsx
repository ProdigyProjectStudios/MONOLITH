"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileSearch,
  Fingerprint,
  GitBranch,
  GitCompareArrows,
  Microscope,
  Plus,
  Radar,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  getRun,
  getSnapshot,
  getRunEvaluation,
  type InvestigationRun,
} from "../lib/investigations";
import type { State } from "../lib/types";
import { Evidence } from "./Detail";
import { investigationEngine, modelCalls } from "./studioReceipts";
import { ProviderInspector } from "./StudioTelemetry";
import {
  compareRuns,
  delta,
  display,
  metricLabels,
  names,
  recordedModels,
  runLabel,
  runMetrics,
  selectedName,
  type Check as AuditCheck,
  type EvaluationStage,
  type Metric,
  type Observation,
  type RunEvaluation,
  type Verdict,
} from "./observatoryMetrics";
import style from "./Observatory.module.css";

const tabs = ["Evaluation", "Compare runs", "Trace"] as const;
type Tab = (typeof tabs)[number];
type Props = {
  s: State;
  run: InvestigationRun | null;
  snapshot?: State;
  runs: InvestigationRun[];
  busy: boolean;
  onSelectRun: (id: string) => void;
  onRepeat?: () => void;
  onInvestigation: () => void;
};
const stages = Object.keys(names);
const statusNames = {
  pass: "Passed",
  review: "Review",
  fail: "Failed",
  not_applicable: "Outside scope",
};
const pct = (value: number | null | undefined) =>
  typeof value === "number"
    ? value.toLocaleString("en-GB", { maximumFractionDigits: 1 }) + "%"
    : "Unavailable";
const textValue = (v: unknown) =>
  typeof v === "string"
    ? v
    : v === undefined
      ? "Unavailable"
      : JSON.stringify(v, null, 2);
function Badge({ status }: { status: Verdict | "not_applicable" }) {
  const Icon =
    status === "pass" ? Check : status === "fail" ? AlertTriangle : CircleHelp;
  return (
    <span className={style.badge} data-status={status}>
      <Icon size={12} />
      {statusNames[status]}
    </span>
  );
}
function Cites({ s, ids }: { s?: State; ids: string[] }) {
  const [more, setMore] = useState(false);
  if (!ids.length) return null;
  const unique = [...new Set(ids)];
  if (!s)
    return (
      <p className={style.muted}>
        {unique.length} references. The frozen source snapshot is loading.
      </p>
    );
  return (
    <div className={style.cites}>
      {(more ? unique : unique.slice(0, 3)).map((id) =>
        s.data.events.some((e) => e.id === id) ||
        s.data.docs.some((d) => d.id === id) ? (
          <Evidence key={id} id={id} s={s} />
        ) : (
          <p key={id} className={style.missing}>
            <code>{id}</code> · Missing from snapshot
          </p>
        ),
      )}
      {unique.length > 3 && (
        <button
          className={style.textButton}
          type="button"
          onClick={() => setMore(!more)}
        >
          {more
            ? "Show fewer references"
            : `Inspect all ${unique.length} references`}
        </button>
      )}
    </div>
  );
}
function useAudit(s: State, run: InvestigationRun | null) {
  const [fetched, setFetched] = useState<{
    key: string;
    evaluation?: RunEvaluation;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = s.tenant + "/" + (run?.id || "");
  const available = run?.result?.evaluation;
  const ready = run?.status === "completed" && !!run.result && !available;
  const workspace = useRef(s);
  workspace.current = s;
  useEffect(() => {
    let current = true;
    if (!ready || !run?.id) return;
    getRunEvaluation(workspace.current, run.id)
      .then((evaluation) => {
        if (current) setFetched({ key, evaluation });
      })
      .catch((error) => {
        if (current)
          setFetched({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Evaluation could not be loaded.",
          });
      });
    return () => {
      current = false;
    };
  }, [ready, run?.id, key, attempt]);
  return {
    evaluation:
      available || (fetched?.key === key ? fetched.evaluation : undefined),
    error: fetched?.key === key ? fetched.error : undefined,
    retry: () => {
      setFetched(null);
      setAttempt((n) => n + 1);
    },
  };
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={style.empty}>
      <Radar size={22} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function EvidenceCheck({ check, s }: { check: AuditCheck; s?: State }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={style.check}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <Badge status={check.status} />
        <strong>{check.label}</strong>
        <ChevronDown size={13} />
      </summary>
      {open && (
        <div className={style.checkDetails}>
          <div className={style.expected}>
            <div>
              <h5>Expected</h5>
              <pre>{textValue(check.expected)}</pre>
            </div>
            <div>
              <h5>Recorded</h5>
              <pre>{textValue(check.actual)}</pre>
            </div>
          </div>
          <Cites s={s} ids={check.evidence} />
        </div>
      )}
    </details>
  );
}
function FindingAudit({ stage, s }: { stage: EvaluationStage; s?: State }) {
  const [open, setOpen] = useState(false);
  const audits = stage.finding_audits;
  if (!audits?.length) return null;
  return (
    <details
      className={style.check}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <FileSearch size={14} />
        <strong>Finding citations</strong>
        <span>{audits.length}</span>
        <ChevronDown size={13} />
      </summary>
      {open && (
        <div className={style.claims}>
          {audits.map((claim) => (
            <article key={claim.index}>
              <div>
                <small>{claim.kind || "Finding"}</small>
                <span>
                  {claim.citation_status === "resolved"
                    ? "Citations resolved"
                    : claim.evidence.length || claim.unresolved.length
                      ? "Unresolved citations"
                      : "No citations"}
                </span>
              </div>
              <p>{claim.text}</p>
              <small>{claim.interpretation}</small>
              <Cites ids={[...claim.evidence, ...claim.unresolved]} s={s} />
            </article>
          ))}
        </div>
      )}
    </details>
  );
}
function CheckImpact({ stage }: { stage: EvaluationStage }) {
  const values = [
    ["Passed", stage.checks.filter((e) => e.status === "pass").length],
    ["Review", stage.checks.filter((e) => e.status === "review").length],
    ["Failed", stage.checks.filter((e) => e.status === "fail").length],
  ] as const;
  return (
    <span
      className={style.impact}
      aria-label={values.map(([k, v]) => v + " " + k.toLowerCase()).join(", ")}
    >
      {values.map(
        ([k, v]) =>
          v > 0 && (
            <i
              key={k}
              data-kind={k}
              style={{ flex: v }}
              title={v + " " + k.toLowerCase()}
            />
          ),
      )}
    </span>
  );
}
function Evaluation({
  obs,
  loadingError,
  retry,
}: {
  obs: Observation;
  loadingError?: string;
  retry: () => void;
}) {
  const ev = obs.evaluation;
  const [stageId, setStage] = useState("");
  if (!ev)
    return (
      <Empty
        title={
          loadingError
            ? "Evaluation unavailable"
            : obs.run.status === "completed"
              ? "Evaluating the saved snapshot"
              : "Evaluation pending"
        }
        action={
          loadingError && (
            <button type="button" className="btn" onClick={retry}>
              <RefreshCw size={14} />
              Retry evaluation
            </button>
          )
        }
      >
        {loadingError ||
          (obs.run.status === "completed"
            ? "Replaying the saved evidence against independent checks."
            : "A completed result is required for snapshot evaluation. Recorded activity is available in Trace.")}
      </Empty>
    );
  const stage =
    ev.stages.find((s) => s.id === stageId) ||
    ev.stages.find((s) => s.status === "fail") ||
    ev.stages.find((s) => s.status === "review") ||
    ev.stages[0];
  const checks = ev.support.passed + ev.support.failed + ev.support.review;
  const gradient = {
    "--arc": ev.score === null ? "0deg" : ev.score * 3.6 + "deg",
  } as CSSProperties;
  return (
    <>
      <section
        className={style.summaryGrid}
        aria-label="Independent evaluation summary"
      >
        <div className={style.score}>
          <div className={style.ring} style={gradient}>
            <ClipboardCheck size={23} />
          </div>
          <div>
            <small>Objective checks passed</small>
            <strong>{pct(ev.score)}</strong>
            <span>
              {ev.support.passed} passed · {ev.support.failed} failed ·{" "}
              {ev.support.review} for review
            </span>
          </div>
        </div>
        <div className={style.stat}>
          <FileSearch size={16} />
          <small>Evidence coverage</small>
          <strong>{pct(ev.coverage.percent)}</strong>
          <span>
            {ev.coverage.covered}/{ev.coverage.findings} findings covered
          </span>
        </div>
        <div className={style.stat}>
          <ShieldCheck size={16} />
          <small>Human control</small>
          <strong>{statusNames[ev.human_control.status]}</strong>
          <span>{ev.coverage.unique_evidence} unique source references</span>
        </div>
      </section>
      <section className={style.panel} aria-label="Evaluation stage details">
        <header>
          <div>
            <span className={style.category}>
              <ScanLine size={13} />
              Snapshot replay
            </span>
            <h3>Stage evaluation</h3>
          </div>
          <span className={style.method}>
            {checks} checks · v{ev.version}
          </span>
        </header>
        <div className={style.matrix}>
          <div className={style.stageList}>
            {ev.stages.map((st) => (
              <button
                type="button"
                key={st.id}
                className={style.stage}
                aria-pressed={st.id === stage?.id}
                onClick={() => setStage(st.id)}
              >
                <div>
                  <strong>{names[st.id] || st.id}</strong>
                  <small>{pct(st.score)}</small>
                </div>
                <CheckImpact stage={st} />
              </button>
            ))}
          </div>
          {stage && (
            <div className={style.stageBody}>
              <div className={style.stageHeader}>
                <div>
                  <Badge status={stage.status} />
                  <h4>{names[stage.id] || stage.id}</h4>
                </div>
                <select
                  aria-label="Evaluation stage"
                  value={stage.id}
                  onChange={(e) => setStage(e.target.value)}
                >
                  {ev.stages.map((st) => (
                    <option key={st.id} value={st.id}>
                      {names[st.id] || st.id}
                    </option>
                  ))}
                </select>
              </div>
              <p className={style.scoreMeaning}>
                The score measures objective checks. Items marked for review
                require interpretation.
              </p>
              {stage.weaknesses.length > 0 && (
                <div className={style.weak}>
                  <h5>
                    <AlertTriangle size={13} />
                    Weaknesses
                  </h5>
                  <ul>
                    {stage.weaknesses.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stage.disagreements.length > 0 && (
                <div className={style.weak}>
                  <h5>
                    <GitBranch size={13} />
                    Disagreements
                  </h5>
                  <ul>
                    {stage.disagreements.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stage.checks.map((c) => (
                <EvidenceCheck
                  key={stage.id + c.id}
                  check={c}
                  s={obs.snapshot}
                />
              ))}
              <FindingAudit key={stage.id} stage={stage} s={obs.snapshot} />
              {stage.human_control.status !== "not_applicable" && (
                <div className={style.control}>
                  <h5>
                    <ShieldCheck size={14} />
                    Human decision boundary
                  </h5>
                  <p>{stage.human_control.detail}</p>
                  <Cites ids={stage.human_control.evidence} s={obs.snapshot} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className={style.fingerprint}>
          <Fingerprint size={14} />
          <span>Frozen snapshot</span>
          <code title={ev.snapshot_sha256}>
            {ev.snapshot_sha256.slice(0, 16)}
          </code>
          <small>{ev.method}</small>
        </div>
      </section>
      {(ev.weaknesses.length > 0 || ev.disagreements.length > 0) && (
        <details className={style.issues}>
          <summary>
            <FileSearch size={14} />
            Run-level review notes{" "}
            <span>{ev.weaknesses.length + ev.disagreements.length}</span>
            <ChevronDown size={13} />
          </summary>
          {ev.weaknesses.length > 0 && (
            <div>
              <h4>Weaknesses</h4>
              <ul>
                {ev.weaknesses.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {ev.disagreements.length > 0 && (
            <div>
              <h4>Disagreements</h4>
              <ul>
                {ev.disagreements.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </>
  );
}

async function loadComparison(s: State, id: string): Promise<Observation> {
  const [run, snapshot] = await Promise.all([
    getRun(s, id),
    getSnapshot(s, id),
  ]);
  const observation: Observation = { run, snapshot };
  if (!run.result || run.status !== "completed") return observation;
  if (run.result.evaluation)
    return { ...observation, evaluation: run.result.evaluation };
  try {
    return { ...observation, evaluation: await getRunEvaluation(s, id) };
  } catch (error) {
    return {
      ...observation,
      error: error instanceof Error ? error.message : "Evaluation unavailable",
    };
  }
}
function Differences({
  subject,
  reference,
}: {
  subject: Observation;
  reference: Observation;
}) {
  const d = compareRuns(subject, reference);
  const report =
    d.sameSnapshot === true
      ? "Identical frozen inputs"
      : d.sameSnapshot === false
        ? "Different frozen inputs"
        : "Input equality unavailable";
  return (
    <article className={style.diffCard}>
      <div className={style.diffTitle}>
        <Fingerprint size={15} />
        <strong>{report}</strong>
        <code>{reference.run.id.slice(-7)}</code>
      </div>
      <div className={style.diffFacts}>
        <span>
          <small>Case overlap</small>
          <b>{pct(d.sourceOverlap?.percent)}</b>
        </span>
        <span>
          <small>Citation overlap</small>
          <b>{pct(d.citationOverlap?.percent)}</b>
        </span>
        <span>
          <small>Recommendation</small>
          <b>
            {d.decision === null
              ? "Unavailable"
              : d.decision
                ? "Same design"
                : "Changed design"}
          </b>
        </span>
      </div>
      {d.citationOverlap && (
        <p>
          {d.citationOverlap.shared} shared citations across{" "}
          {d.citationOverlap.total} distinct references.
        </p>
      )}
      {d.sameSnapshot === false && (
        <p>Source differences can contribute to the observed deltas.</p>
      )}
      {d.verified === false && (
        <p>Verification outcomes differ between these runs.</p>
      )}
      {!!d.changedChecks.length && (
        <details>
          <summary>{d.changedChecks.length} check outcomes changed</summary>
          <ul>
            {d.changedChecks.map((c, i) => (
              <li key={i}>
                {names[c.stage] || c.stage} · {c.label} · {c.second} → {c.first}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
function Compare({
  s,
  subject,
  runs,
}: {
  s: State;
  subject: Observation;
  runs: InvestigationRun[];
}) {
  const candidates = runs.filter(
    (r) =>
      r.id !== subject.run.id &&
      r.status !== "running" &&
      r.status !== "queued",
  );
  const original = subject.run.repeat_of;
  const firstRef = candidates.find((c) => c.id === original) || candidates[0];
  const [ids, setIds] = useState<string[]>(firstRef ? [firstRef.id] : []);
  const [loaded, setLoaded] = useState<Record<string, Observation>>({});
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [retry, setRetry] = useState(0);
  const resident = useRef(new Map<string, Observation>());
  const workspace = useRef(s);
  workspace.current = s;
  const refKey = ids.join("|");
  useEffect(() => {
    let keep = true;
    for (const id of ids) {
      if (!id || resident.current.has(id)) continue;
      loadComparison(workspace.current, id)
        .then((value) => {
          if (!keep) return;
          resident.current.set(id, value);
          setLoaded((prev) => ({ ...prev, [id]: value }));
          setErrors((prev) => ({ ...prev, [id]: "" }));
        })
        .catch((err) => {
          if (keep)
            setErrors((prev) => ({
              ...prev,
              [id]:
                err instanceof Error ? err.message : "Comparison unavailable",
            }));
        });
    }
    return () => {
      keep = false;
    };
  }, [refKey, retry]);
  const selected = useMemo(
    () => ids.map((id) => loaded[id]).filter((o): o is Observation => !!o),
    [ids, loaded],
  );
  const metrics = useMemo(
    () => [runMetrics(subject), ...selected.map(runMetrics)],
    [subject, selected],
  );
  if (!candidates.length)
    return (
      <Empty title="A second saved run is needed">
        Repeat the selected investigation on its frozen inputs, or run an
        investigation for a different window, to compare outcomes.
      </Empty>
    );
  return (
    <>
      <section className={style.panel}>
        <header>
          <div>
            <span className={style.category}>
              <GitCompareArrows size={13} />
              Cross-run analysis
            </span>
            <h3>Compare saved runs</h3>
          </div>
          {ids.length < Math.min(3, candidates.length) && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const add = candidates.find((r) => !ids.includes(r.id));
                if (add) setIds([...ids, add.id]);
              }}
            >
              <Plus size={14} />
              Add run
            </button>
          )}
        </header>
        <div className={style.referencePickers}>
          {ids.map((id, i) => (
            <div key={i}>
              <label>
                Comparison {i + 1}
                <select
                  aria-label={
                    i === 0 ? "Comparison run" : "Comparison run " + (i + 1)
                  }
                  value={id}
                  onChange={(e) =>
                    setIds((old) =>
                      old.map((v, n) => (n === i ? e.target.value : v)),
                    )
                  }
                >
                  {candidates
                    .filter((r) => r.id === id || !ids.includes(r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {runLabel(r)}
                      </option>
                    ))}
                </select>
              </label>
              {i > 0 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={"Remove comparison " + (i + 1)}
                  onClick={() => setIds(ids.filter((_, n) => n !== i))}
                >
                  <X size={14} />
                </button>
              )}
              {errors[id] ? (
                <div role="alert">
                  {errors[id]}{" "}
                  <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
                </div>
              ) : (
                !loaded[id] && <small role="status">Loading frozen run…</small>
              )}
            </div>
          ))}
        </div>
        {selected.length > 0 && (
          <div className={style.tableScroll}>
            <table aria-label="Saved run comparison">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>
                    Selected run<code>{subject.run.id.slice(-7)}</code>
                  </th>
                  {selected.map((r) => (
                    <th key={r.run.id}>
                      Comparison<code>{r.run.id.slice(-7)}</code>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Recorded engine</th>
                  <td>{investigationEngine(subject.run)}</td>
                  {selected.map((r) => (
                    <td key={r.run.id}>{investigationEngine(r.run)}</td>
                  ))}
                </tr>
                <tr>
                  <th>Recorded models</th>
                  {[subject, ...selected].map((o) => (
                    <td key={o.run.id}>
                      {recordedModels(o.run).join(", ") ||
                        (o.run.mode === "live"
                          ? "Unavailable"
                          : "No provider execution")}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Selected design</th>
                  <td>{selectedName(subject.run)}</td>
                  {selected.map((r) => (
                    <td key={r.run.id}>{selectedName(r.run)}</td>
                  ))}
                </tr>
                {(Object.keys(metricLabels) as Metric[]).map((k) => (
                  <tr key={k}>
                    <th>{metricLabels[k]}</th>
                    {metrics.map((group, i) => {
                      const m = group[k],
                        diff = i ? delta(metrics[0][k], m) : null;
                      return (
                        <td key={i}>
                          <b>{display(m)}</b>
                          {m.detail && <small>{m.detail}</small>}
                          {diff && <em>{diff}</em>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected.length > 0 && (
          <p className={style.legend}>
            Deltas subtract each comparison from the selected run. Incomplete
            measurements have no delta.
          </p>
        )}
      </section>
      {selected.length > 0 && (
        <div className={style.diffs}>
          {selected.map((ref) => (
            <Differences key={ref.run.id} subject={subject} reference={ref} />
          ))}
        </div>
      )}
      {selected
        .filter((ref) => ref.error)
        .map((r) => (
          <p key={r.run.id} role="alert">
            {r.run.id.slice(-7)} · {r.error}
          </p>
        ))}
    </>
  );
}
function TraceReceipt({
  e,
  snapshot,
}: {
  e: InvestigationRun["events"][number];
  snapshot?: State;
}) {
  const [open, setOpen] = useState(false),
    handoff = e.kind === "handoff";
  const evidence = Array.isArray(e.payload.evidence)
    ? e.payload.evidence.filter((v): v is string => typeof v === "string")
    : [];
  return (
    <details
      className={style.traceItem}
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
    >
      <summary>
        {handoff ? <GitBranch size={14} /> : <SquareTerminal size={14} />}
        <span>
          {handoff
            ? `${names[e.stage] || e.stage} → ${names[String(e.payload.to)] || String(e.payload.to)}`
            : String(e.payload.name || e.kind)}
        </span>
        <code>#{e.seq}</code>
      </summary>
      {open && (
        <div>
          <p>
            {names[e.stage] || e.stage} · {e.kind.replaceAll("_", " ")} ·{" "}
            {new Date(e.at).toLocaleTimeString("en-GB", { timeZone: "UTC" })}{" "}
            UTC
          </p>
          {!handoff && (
            <>
              <h5>Input</h5>
              <pre>{textValue(e.payload.input)}</pre>
            </>
          )}
          <h5>{handoff ? "Handoff" : "Output"}</h5>
          <pre>
            {textValue(e.kind === "tool_result" ? e.payload.result : e.payload)}
          </pre>
          <Cites ids={evidence} s={snapshot} />
        </div>
      )}
    </details>
  );
}

function Trace({ obs }: { obs: Observation }) {
  const [stage, setStage] = useState("all"),
    [limit, setLimit] = useState(16);
  const filtered = obs.run.events.filter(
    (e) => stage === "all" || e.stage === stage,
  );
  const tools = filtered.filter((e) =>
    ["tool_result", "tool_error", "handoff"].includes(e.kind),
  );
  const { calls, pending } = modelCalls(filtered);
  const models = recordedModels(obs.run);
  return (
    <section className={style.panel}>
      <header>
        <div>
          <span className={style.category}>
            <SquareTerminal size={13} />
            Execution receipts
          </span>
          <h3>Tools, models and handoffs</h3>
        </div>
        <select
          aria-label="Trace stage"
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setLimit(16);
          }}
        >
          <option value="all">All stages</option>
          {stages
            .filter((id) => obs.run.events.some((e) => e.stage === id))
            .map((id) => (
              <option key={id} value={id}>
                {names[id]}
              </option>
            ))}
        </select>
      </header>
      <div className={style.traceMeta}>
        <div>
          <small>Configured mode</small>
          <strong>
            {obs.run.mode === "live" ? "Live investigation" : "Deterministic"}
          </strong>
        </div>
        <div>
          <small>Recorded engine</small>
          <strong>{investigationEngine(obs.run)}</strong>
        </div>
        <div>
          <small>Recorded models</small>
          <strong>
            {models.join(", ") ||
              (obs.run.mode === "live"
                ? "Unavailable"
                : "No provider execution")}
          </strong>
        </div>
        <div>
          <small>Frozen window</small>
          <strong>{obs.run.days} days</strong>
        </div>
      </div>
      <div className={style.traceGrid}>
        <div>
          <h4>
            Tool and handoff records <small>{tools.length}</small>
          </h4>
          {tools.slice(0, limit).map((e) => (
            <TraceReceipt key={e.seq} e={e} snapshot={obs.snapshot} />
          ))}
          {!tools.length && (
            <p className={style.muted}>
              No tool or handoff records for this stage.
            </p>
          )}
          {tools.length > limit && (
            <button
              type="button"
              className={style.textButton}
              onClick={() => setLimit((n) => n + 16)}
            >
              Show more receipts
            </button>
          )}
        </div>
        <div>
          <h4>
            Provider receipts <small>{calls.length + pending.length}</small>
          </h4>
          {obs.run.mode === "live" ? (
            <ProviderInspector events={filtered} />
          ) : (
            <p className={style.muted}>
              This investigation used the deterministic engine.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Observatory({
  s,
  run,
  snapshot,
  runs,
  busy,
  onSelectRun,
  onRepeat,
  onInvestigation,
}: Props) {
  const [tab, setTab] = useState<Tab>("Evaluation");
  const audit = useAudit(s, run);
  const obs = useMemo(
    () => (run ? { run, snapshot, evaluation: audit.evaluation } : null),
    [run, snapshot, audit.evaluation],
  );
  const isActive = runs.some(
    (r) => r.status === "queued" || r.status === "running",
  );
  return (
    <section
      className={style.observatory}
      aria-label="AI Engineering Observatory"
    >
      <header className={style.hero}>
        <div>
          <span className={style.category}>
            <Microscope size={14} />
            Engineering evaluation
          </span>
          <h2>AI Engineering Observatory</h2>
          <p>
            Examine evidence quality, reproduce decisions and compare recorded
            execution across saved runs.
          </p>
        </div>
        {run && (
          <label className={style.runPicker}>
            Selected investigation
            <select
              aria-label="Inspect saved run"
              value={run.id}
              onChange={(e) => onSelectRun(e.target.value)}
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(r)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {run && obs ? (
        <>
          <div className={style.toolbar}>
            <div
              className={style.tabs}
              role="group"
              aria-label="Observatory analysis"
            >
              {tabs.map((t) => (
                <button
                  type="button"
                  key={t}
                  aria-pressed={t === tab}
                  onClick={() => setTab(t)}
                >
                  {t === "Evaluation" ? (
                    <ClipboardCheck size={14} />
                  ) : t === "Trace" ? (
                    <SquareTerminal size={14} />
                  ) : (
                    <ArrowLeftRight size={14} />
                  )}{" "}
                  {t}
                </button>
              ))}
            </div>
            {onRepeat && (
              <button
                type="button"
                className="btn"
                disabled={busy || isActive || run.status !== "completed"}
                title={
                  run.mode === "live"
                    ? "Use the frozen snapshot for another provider run. Provider charges may apply."
                    : "Run another deterministic investigation on these frozen inputs."
                }
                onClick={onRepeat}
              >
                <RefreshCw size={13} />
                {run.mode === "live"
                  ? "Repeat live · provider charges apply"
                  : "Repeat on frozen inputs"}
              </button>
            )}
          </div>
          {tab === "Evaluation" ? (
            <Evaluation
              key={run.id}
              obs={obs}
              loadingError={audit.error}
              retry={audit.retry}
            />
          ) : tab === "Compare runs" ? (
            <Compare key={s.tenant + run.id} s={s} subject={obs} runs={runs} />
          ) : (
            <Trace key={run.id} obs={obs} />
          )}
        </>
      ) : (
        <Empty
          title="No investigation selected"
          action={
            <button className="btn" type="button" onClick={onInvestigation}>
              Open investigation
            </button>
          }
        >
          Run a refund investigation to evaluate its evidence and inspect its
          execution.
        </Empty>
      )}
    </section>
  );
}
