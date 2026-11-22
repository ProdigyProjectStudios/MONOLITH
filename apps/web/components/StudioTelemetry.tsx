import {
  Activity,
  ChevronDown,
  Cpu,
  Database,
  FileCheck2,
  GitCompareArrows,
  Layers3,
  ShieldCheck,
  SquareTerminal,
  Timer,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { InvestigationRun, RunEvent } from "../lib/investigations";
import styles from "./StudioTelemetry.module.css";

import {
  duration,
  elapsed,
  format,
  latestAssessment,
  metering,
  modelCalls,
  money,
  numeric,
  object,
  str,
  strings,
  type Review,
} from "./studioReceipts";
function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <div className={styles.stat}>
      <div>
        <Icon size={13} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function RunMeasurements({
  events,
  run,
}: {
  events: RunEvent[];
  run: InvestigationRun;
}) {
  const values = useMemo(() => {
    const { calls, pending } = modelCalls(events);
    const meter = metering(calls);
    const end =
      events.find((e) =>
        ["run_completed", "run_failed", "run_interrupted"].includes(e.kind),
      )?.at || events.at(-1)?.at;
    const span = elapsed(
      events.find((e) => e.kind === "run_started")?.at || run.created,
      end,
    );
    const tools = events.filter((e) => e.kind === "tool_result");
    const refs = new Set(events.flatMap((e) => strings(e.payload.evidence)));
    return { calls, pending, meter, span, tools, refs };
  }, [events, run.created]);
  const { calls, pending, meter, span, tools, refs } = values;
  return (
    <section className={styles.stats} aria-label="Recorded run measurements">
      <Stat
        icon={Timer}
        label="Elapsed execution"
        value={span !== null ? duration(span) : "Awaiting event"}
        detail="Recorded wall time"
      />
      <Stat
        icon={SquareTerminal}
        label="Tool results"
        value={format(tools.length)}
        detail={`${refs.size} unique cited records`}
      />
      {run.mode === "live" ? (
        <>
          <Stat
            icon={Cpu}
            label="Provider calls"
            value={
              calls.length || pending.length
                ? format(calls.length + pending.length)
                : "—"
            }
            detail={
              pending.length
                ? `${pending.length} awaiting receipt`
                : calls.length
                  ? `${new Set(calls.map((c) => c.payload.agent).filter(Boolean)).size} attributed specialists`
                  : "No provider receipts recorded"
            }
          />
          <Stat
            icon={Activity}
            label="Reported tokens"
            value={meter.tracked ? format(meter.total) : "—"}
            detail={
              meter.tracked && meter.breakdown === meter.tracked
                ? `${format(meter.input)} input · ${format(meter.output)} output`
                : meter.tracked
                  ? "Input/output split incomplete"
                  : "Usage unavailable"
            }
          />
          {meter.priced > 0 && (
            <Stat
              icon={Database}
              label="Estimated provider cost"
              value={money(meter.cost)}
              detail={`${meter.priced} of ${calls.length} receipts priced`}
            />
          )}
        </>
      ) : (
        <Stat
          icon={Database}
          label="Execution mode"
          value="Deterministic"
          detail="Rules and measured inputs"
        />
      )}
      {run.mode === "live" &&
        meter.tracked > 0 &&
        meter.tracked < calls.length && (
          <p className={styles.partial}>
            Token totals cover {meter.tracked} of {calls.length} provider
            receipts.
          </p>
        )}
    </section>
  );
}

export function ProviderInspector({ events }: { events: RunEvent[] }) {
  const { calls, pending } = modelCalls(events);
  return (
    <div className={styles.receipts}>
      {pending.map((e) => (
        <div key={e.seq} className={styles.pending}>
          <Cpu size={14} />
          <span>
            <strong>{str(e.payload.agent) || "Specialist"}</strong>
            <small>Awaiting provider receipt · {str(e.payload.model)}</small>
          </span>
        </div>
      ))}
      {calls.map((e) => {
        const p = e.payload,
          u = object(p.usage),
          t = numeric(p.duration_ms),
          cost = numeric(p.estimated_cost_usd);
        return (
          <details className={styles.receipt} key={e.seq}>
            <summary>
              <Cpu size={13} />
              <span>
                <strong>{str(p.model) || "Model receipt"}</strong>
                <small>
                  {str(p.agent)} · {str(p.status)}
                </small>
              </span>
              {t !== null && <code>{duration(t)}</code>}
              <ChevronDown size={12} />
            </summary>
            <dl>
              {[
                ["Provider", str(p.provider) || null],
                ["Endpoint", str(p.provider_endpoint) || null],
                ["Transport", str(p.transport) || null],
                ["Response ID", str(p.response_id) || "Unavailable"],
                ["Request ID", str(p.request_id) || null],
                ["Call", numeric(p.call)],
                ["Input tokens", numeric(u.input_tokens)],
                ["Cached input", numeric(u.cached_input_tokens)],
                ["Output tokens", numeric(u.output_tokens)],
                ["Total tokens", numeric(u.total_tokens)],
                ["Estimated cost", cost !== null ? money(cost) : null],
                ["Failure", str(p.error_type) || null],
              ].map(
                ([key, value]) =>
                  value != null && (
                    <div key={String(key)}>
                      <dt>{key}</dt>
                      <dd>
                        {typeof value === "number" ? format(value) : value}
                      </dd>
                    </div>
                  ),
              )}
            </dl>
            {!Object.keys(u).length && (
              <p>Provider usage was unavailable for this call.</p>
            )}
          </details>
        );
      })}
      {!pending.length && !calls.length && (
        <p className={styles.note}>
          No model receipts at this point in the trace.
        </p>
      )}
    </div>
  );
}

type EvidenceRenderer = (ids: string[]) => ReactNode;
function ReviewCard({
  assessment: r,
  name,
  renderEvidence,
}: {
  assessment: Review;
  name: (id: string) => string;
  renderEvidence: EvidenceRenderer;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={styles.review}>
      <header>
        <span>
          {r.reviewer === "reliability" ? (
            <ShieldCheck size={15} />
          ) : (
            <Layers3 size={15} />
          )}
        </span>
        <h4>{r.reviewer} reviewer</h4>
      </header>
      <span className={styles.caption}>Preferred design</span>
      <strong className={styles.preference}>{name(r.preferred)}</strong>
      {r.rationale && <p>{r.rationale}</p>}
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <FileCheck2 size={13} />
          {r.confidence
            ? `${r.confidence} confidence`
            : "Evidence and constraints"}
          <code>{r.evidence.length} cited</code>
          <ChevronDown size={12} />
        </summary>
        {open && (
          <div className={styles.reviewDetails}>
            {r.confidenceBasis && (
              <>
                <h5>Confidence basis</h5>
                <p>{r.confidenceBasis}</p>
              </>
            )}
            {renderEvidence(r.evidence)}
            {!!r.constraints.length && (
              <>
                <h5>Constraints</h5>
                <ul>
                  {r.constraints.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </>
            )}
            {r.tradeoffs.map((t) => (
              <div key={t.approach}>
                <h5>
                  {name(t.approach)}
                  {r.rejected.includes(t.approach)
                    ? " · rejected by reviewer"
                    : ""}
                </h5>
                <p>{t.benefit}</p>
                <p>
                  <b>Risk</b> {t.risk}
                </p>
                {t.rejectionReason && (
                  <p>
                    <b>Reason for rejection</b> {t.rejectionReason}
                  </p>
                )}
                {renderEvidence(t.evidence)}
              </div>
            ))}
          </div>
        )}
      </details>
    </article>
  );
}
export function ArchitectureReview({
  events,
  run,
  renderEvidence,
}: {
  events: RunEvent[];
  run: InvestigationRun;
  renderEvidence: EvidenceRenderer;
}) {
  const { reviews, disagreement, verification } = useMemo(
    () => latestAssessment(events),
    [events],
  );
  if (run.mode !== "live" || !reviews.length) return null;
  const name = (id: string) =>
    run.result?.package.approaches.find((a) => a.id === id)?.name ||
    {
      queue: "Event-driven review queue",
      batch: "Scheduled review digest",
      neither: "Hold both designs",
    }[id] ||
    id;
  const rejected = strings(verification?.rejected_designs);
  return (
    <section
      className={styles.debate}
      aria-label="Independent architecture reviews"
    >
      <header className={styles.debateHeader}>
        <span className={styles.symbol}>
          <GitCompareArrows size={18} />
        </span>
        <div>
          <h3>Architecture review</h3>
          <p>Independent reliability and operations assessments</p>
        </div>
        <span
          className={styles.decision}
          data-decision={disagreement === true ? "disagreed" : "normal"}
        >
          {disagreement === true
            ? "Different preferences"
            : disagreement === false
              ? "Aligned preferences"
              : `${reviews.length} review recorded`}
        </span>
      </header>
      <div className={styles.reviewGrid}>
        {reviews.map((r) => (
          <ReviewCard
            key={r.reviewer}
            assessment={r}
            name={name}
            renderEvidence={renderEvidence}
          />
        ))}
      </div>
      {verification && (
        <div className={styles.verdict}>
          <div>
            <ShieldCheck size={16} />
            <h4>Verifier decision</h4>
            <span>{str(verification.verdict).replaceAll("_", " ")}</span>
          </div>
          {str(verification.reconciliation) && (
            <p>{str(verification.reconciliation)}</p>
          )}
          {!!rejected.length && (
            <p>
              <strong>Rejected designs</strong> {rejected.map(name).join(" · ")}
            </p>
          )}
          {str(verification.challenge) && (
            <p>
              <strong>Challenge</strong> {str(verification.challenge)}
            </p>
          )}
          {str(verification.precondition) && (
            <p>
              <strong>Before approval</strong> {str(verification.precondition)}
            </p>
          )}
          {renderEvidence(strings(verification.evidence))}
        </div>
      )}
    </section>
  );
}
