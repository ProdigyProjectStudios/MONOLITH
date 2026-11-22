"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCheck2,
  FlaskConical,
  GitFork,
  Layers3,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SquareTerminal,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  InvestigationResult,
  InvestigationRun,
  RunEvent,
} from "../lib/investigations";
import { investigationEngine } from "./studioReceipts";
import type { State } from "../lib/types";
import { Evidence } from "./Detail";
import {
  blueprintChoice,
  chapters,
  guideDuration,
  playbackPosition,
  receiptIds,
  roles,
  roleReceipts,
  roleTime,
} from "./guidedPlayback";
import css from "./GuidedDemo.module.css";

const chapterIcons = [
  BookOpen,
  GitFork,
  Boxes,
  FlaskConical,
  FileCheck2,
  Layers3,
];
const nameOf = (v: unknown) =>
  typeof v === "string" ? v.replaceAll("_", " ") : "";
const timecode = (seconds: number) =>
  Math.floor(seconds / 60) +
  ":" +
  String(Math.floor(seconds % 60)).padStart(2, "0");
const hours = (value: number | null) =>
  value === null
    ? "Unavailable"
    : value.toLocaleString("en-GB", { maximumFractionDigits: 2 }) + " h";
const percent = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
const currency = (n: number, unit: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: unit,
    maximumFractionDigits: 2,
  }).format(n);
function Sources({
  ids,
  s,
  pause,
}: {
  ids: string[];
  s: State;
  pause: () => void;
}) {
  if (!ids.length) return null;
  return (
    <div
      className={css.sources}
      onClickCapture={(e) => {
        if (e.target instanceof Element && e.target.closest("summary")) pause();
      }}
    >
      <h4>
        <BookOpen size={14} /> Cited source records
      </h4>
      {ids.map((id) =>
        s.data.events.some((r) => r.id === id) ||
        s.data.docs.some((r) => r.id === id) ? (
          <Evidence key={id} id={id} s={s} />
        ) : (
          <small key={id}>{id} · source unavailable in this view</small>
        ),
      )}
    </div>
  );
}
function Receipt({ event, pause }: { event: RunEvent; pause: () => void }) {
  return (
    <details
      className={css.receipt}
      onToggle={(e) => {
        if (e.currentTarget.open) pause();
      }}
    >
      <summary>
        <SquareTerminal size={14} />
        <code>{String(event.payload.name || "Tool result")}</code>
        <small>#{event.seq}</small>
      </summary>
      <pre>
        {JSON.stringify(
          { input: event.payload.input, result: event.payload.result },
          null,
          2,
        )}
      </pre>
    </details>
  );
}
function Baseline({
  s,
  result,
  run,
  pause,
}: {
  s: State;
  result: InvestigationResult;
  run: InvestigationRun;
  pause: () => void;
}) {
  const b = result.package.baseline;
  const measured = roleReceipts(run, "process").tools.find(
    (t) => t.payload.name === "measure_intervals",
  );
  const refs = measured
    ? receiptIds(measured).slice(0, 2)
    : b.evidence.slice(0, 2);
  const cited = new Set([...refs, ...(b.policy_evidence ?? [])]);
  const sourceIds = new Set(
    [...s.data.events, ...s.data.docs]
      .filter((row) => cited.has(row.id))
      .map((row) => row.source),
  );
  const sources = s.data.sources.filter((src) => sourceIds.has(src.id));
  return (
    <>
      <h2>Where refunds wait</h2>
      <div className={css.bigReading}>
        <span>Median elapsed interval</span>
        <strong>{hours(b.median)}</strong>
      </div>
      <p className={css.lede}>
        From invoice re-entry to refund authorisation across{" "}
        {b.intervals.toLocaleString()} recorded transitions in{" "}
        {b.cases.toLocaleString()} cases.
      </p>
      <div className={css.stats}>
        <span>
          <b>{hours(b.p25)}</b>25th percentile
        </span>
        <span>
          <b>{hours(b.p75)}</b>75th percentile
        </span>
        <span>
          <b>{run.days} days</b>Case window
        </span>
      </div>
      {sources.length > 0 && (
        <details
          className={css.ingestion}
          onToggle={(e) => {
            if (e.currentTarget.open) pause();
          }}
        >
          <summary>
            <FileCheck2 size={14} />
            Ingestion provenance · {sources.length} cited sources
          </summary>
          <ul>
            {sources.map((src) => (
              <li key={src.id}>
                <strong>{src.name}</strong>
                <span>
                  {src.kind} · {src.synthetic ? "Synthetic" : "Imported"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Sources s={s} ids={refs} pause={pause} />
    </>
  );
}
function Specialists({
  run,
  s,
  role,
  choose,
  pause,
}: {
  run: InvestigationRun;
  s: State;
  role: number;
  choose: (i: number) => void;
  pause: () => void;
}) {
  const r = roles[role],
    receipts = roleReceipts(run, r.id);
  const next = roles.find(
    (candidate) => candidate.id === receipts.handoff?.payload.to,
  );
  return (
    <>
      <h2>Specialist handoffs</h2>
      <div className={css.roleGrid} aria-label="Inspect a specialist">
        {roles.map((v, i) => (
          <button
            type="button"
            key={v.id}
            aria-pressed={i === role}
            onClick={() => choose(i)}
          >
            {v.title}
          </button>
        ))}
      </div>
      <div className={css.stageCard}>
        <div className={css.stageHeader}>
          <strong>{r.title}</strong>
          <span>
            {receipts.complete ? "Recorded output" : "Awaiting output"}
          </span>
        </div>
        <p>
          {typeof receipts.complete?.payload.summary === "string"
            ? receipts.complete.payload.summary
            : "No completed stage was recorded."}
        </p>
        {receipts.tools.map((t) => (
          <Receipt key={t.seq} event={t} pause={pause} />
        ))}
        {next && (
          <div className={css.handoff}>
            <GitFork size={13} /> Handed off to {next.title}
          </div>
        )}
      </div>
      <Sources
        ids={receiptIds(receipts.complete).slice(0, 2)}
        s={s}
        pause={pause}
      />
    </>
  );
}
function Proposals({ result }: { result: InvestigationResult }) {
  return (
    <>
      <h2>How should refunds reach a reviewer?</h2>
      <div className={css.proposals}>
        {result.package.approaches.map((plan, i) => (
          <article key={plan.id} className={i ? css.blue : css.green}>
            <Boxes size={19} />
            <h3>{plan.name}</h3>
            <p>{plan.summary}</p>
            <dl>
              <dt>Delivery complexity</dt>
              <dd>{plan.complexity}</dd>
              <dt>Operational risk</dt>
              <dd>{plan.risk}</dd>
            </dl>
          </article>
        ))}
      </div>
      {!result.package.approaches.length && (
        <p className={css.lede}>
          The recorded investigation produced no eligible architecture.
        </p>
      )}
    </>
  );
}
function Trials({ result }: { result: InvestigationResult }) {
  const entries = Object.entries(result.trials);
  return (
    <>
      <h2>What changes under each route?</h2>
      <p className={css.lede}>
        The recorded trials model elapsed intervals and cost using the
        assumptions below. The measured median is{" "}
        {hours(result.package.baseline.median)}.
      </p>
      <div className={css.trials}>
        {entries.map(([key, t]) => (
          <article key={key}>
            <div className={css.trialTitle}>
              <FlaskConical size={15} />
              <h3>
                {result.package.approaches.find((a) => a.id === t.approach)
                  ?.name || t.approach}
              </h3>
              <code>{key}</code>
            </div>
            <div className={css.trialReading}>
              <span>
                <b>{hours(t.projected_median)}</b>Modelled median
              </span>
              <span>
                <b>{currency(t.net_savings, t.currency)}</b>Modelled net savings
              </span>
            </div>
            <p>
              {percent(t.assumptions.coverage)} coverage ·{" "}
              {percent(t.assumptions.reduction)} time reduction on success ·{" "}
              {percent(t.assumptions.failure)} routing failure
            </p>
            <small>
              Sensitivity {hours(t.sensitivity.low)} to{" "}
              {hours(t.sensitivity.high)} · effectiveness varied by ±20%
            </small>
          </article>
        ))}
      </div>
      {!entries.length && <p>No simulation trials were recorded.</p>}
    </>
  );
}
function Verification({ result }: { result: InvestigationResult }) {
  const stage = result.stages.verification;
  return (
    <>
      <h2>Can the recommendation stand?</h2>
      <div className={css.verdict}>
        {result.verified ? (
          <ShieldCheck size={24} />
        ) : (
          <CircleAlert size={24} />
        )}
        <div>
          <strong>
            {result.verified ? "Verification passed" : "Verification withheld"}
          </strong>
          <p>{stage?.summary || result.summary}</p>
        </div>
      </div>
      {result.evaluation && (
        <div className={css.audit}>
          <span>
            <ListChecks size={14} />
            Independent snapshot replay
          </span>
          <strong>
            {result.evaluation.support.passed} checks passed ·{" "}
            {result.evaluation.support.failed} failed ·{" "}
            {result.evaluation.support.review} for review
          </strong>
          <p>
            {result.evaluation.coverage.covered}/
            {result.evaluation.coverage.findings} findings have resolvable
            citations. Review items remain available in Observatory.
          </p>
        </div>
      )}
      <div className={css.checks}>
        {Object.entries(stage?.checks || {}).map(([name, ok]) => (
          <div key={name}>
            {ok ? <Check size={15} /> : <X size={15} />}
            <span>{nameOf(name)}</span>
            <small>{ok ? "Passed" : "Failed"}</small>
          </div>
        ))}
      </div>
      {result.findings.find((f) => f.kind === "hypothesis") && (
        <div className={css.hypothesis}>
          <h4>Hypothesis requiring validation</h4>
          <p>{result.findings.find((f) => f.kind === "hypothesis")!.text}</p>
        </div>
      )}
    </>
  );
}
function Blueprint({
  run,
  pause,
}: {
  run: InvestigationRun;
  pause: () => void;
}) {
  const choice = blueprintChoice(run);
  if (!choice)
    return (
      <>
        <h2>Implementation blueprint</h2>
        <div className={css.verdict}>
          <ShieldCheck />
          <p>The investigation has no verified architecture for a blueprint.</p>
        </div>
      </>
    );
  const { approach, approved } = choice;
  return (
    <>
      <div className={css.blueprintState}>
        <ShieldCheck size={14} />
        {approved
          ? "Recorded architecture approval"
          : "Read-only design preview · awaiting human approval"}
      </div>
      <h2>{approach.name}</h2>
      <p className={css.lede}>{approach.summary}</p>
      <ol className={css.path}>
        {approach.nodes.map((n, i) => (
          <li key={i}>
            {i > 0 && <ChevronRight size={13} />}
            <span>{n}</span>
          </li>
        ))}
      </ol>
      <h4 className={css.artifactTitle}>
        <Code2 size={15} /> Engineering artifacts
      </h4>
      <div className={css.artifacts}>
        {approach.artifacts.map((a) => (
          <details
            key={a.title}
            onToggle={(e) => {
              if (e.currentTarget.open) pause();
            }}
          >
            <summary>{a.title}</summary>
            <pre>{a.body}</pre>
          </details>
        ))}
      </div>
    </>
  );
}
export default function GuidedDemo({
  s,
  run,
  onClose,
  replayLabel,
}: {
  replayLabel?: string;
  s: State;
  run: InvestigationRun;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    sceneRef = useRef<HTMLDivElement>(null),
    clock = useRef(0);
  const [elapsed, setElapsed] = useState(0),
    [playing, setPlaying] = useState(false);
  const titleId = useId(),
    position = playbackPosition(elapsed),
    chapter = chapters[position.index],
    result = run.result;
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dlg.open) dlg.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    clock.current = 0;
    setElapsed(0);
    const pref = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!pref.matches && run.status === "completed" && !!run.result);
    const stopOnPreference = () => {
      if (pref.matches) setPlaying(false);
    };
    const stopWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    pref.addEventListener("change", stopOnPreference);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      pref.removeEventListener("change", stopOnPreference);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      dlg.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [run.id, run.status, !!run.result]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(),
      offset = clock.current;
    const timer = window.setInterval(() => {
      const next = Math.min(
        guideDuration,
        offset + (performance.now() - start) / 1000,
      );
      clock.current = next;
      setElapsed(next);
      if (next === guideDuration) setPlaying(false);
    }, 180);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.scrollTop = 0;
    ref.current
      ?.querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [chapter.id]);
  function seek(t: number) {
    setPlaying(false);
    clock.current = t;
    setElapsed(t);
  }
  function toggle() {
    if (position.ended) {
      clock.current = 0;
      setElapsed(0);
      setPlaying(true);
    } else setPlaying((p) => !p);
  }
  const pause = () => setPlaying(false);
  const scope = run.events.find(
    (e) => e.kind === "tool_result" && e.payload.name === "discover_scope",
  )?.payload.result;
  const synthetic =
    typeof scope === "object" && scope !== null && "synthetic" in scope
      ? scope.synthetic
      : undefined;
  return (
    <dialog
      ref={ref}
      className={css.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={css.frame}>
        <header className={css.header}>
          <div>
            <Timer size={18} />
            <h1 id={titleId}>Guided investigation</h1>
          </div>
          <button
            aria-label="Exit guided investigation"
            type="button"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className={css.context}>
          <span>
            {replayLabel ??
              (run.mode === "live"
                ? investigationEngine(run) + " · replay"
                : "Deterministic run replay")}
          </span>
          <span>
            {synthetic === true
              ? "Synthetic events"
              : synthetic === false
                ? "Imported events in scope"
                : "Recorded workspace data"}
          </span>
          <code>Run {run.id.slice(0, 8)}</code>
        </div>
        {run.status !== "completed" || !result ? (
          <div className={css.unavailable}>
            <ListChecks size={20} />
            <p>
              {run.status === "failed" || run.status === "interrupted"
                ? run.error ||
                  "The run ended before a full replay was available."
                : "A completed investigation is required for the guided replay."}
            </p>
            <button type="button" onClick={onClose}>
              Back to Studio
            </button>
          </div>
        ) : (
          <>
            <p className={css.srOnly} aria-live="polite">
              {chapter.title}
            </p>
            <div className={css.layout}>
              <nav className={css.chapters} aria-label="Replay chapters">
                {chapters.map((c, i) => {
                  const Icon = chapterIcons[i];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-current={i === position.index ? "step" : undefined}
                      onClick={() => seek(c.start)}
                    >
                      <Icon size={16} />
                      <span>{c.title}</span>
                      <small>{timecode(c.start)}</small>
                    </button>
                  );
                })}
              </nav>
              <div
                ref={sceneRef}
                className={css.scene}
                key={chapter.id}
                tabIndex={0}
                role="region"
                aria-label={chapter.title}
              >
                {chapter.id === "evidence" ? (
                  <Baseline s={s} run={run} result={result} pause={pause} />
                ) : chapter.id === "roles" ? (
                  <Specialists
                    s={s}
                    run={run}
                    role={position.role}
                    choose={(i) => seek(roleTime(i))}
                    pause={pause}
                  />
                ) : chapter.id === "architectures" ? (
                  <Proposals result={result} />
                ) : chapter.id === "simulation" ? (
                  <Trials result={result} />
                ) : chapter.id === "verification" ? (
                  <Verification result={result} />
                ) : (
                  <Blueprint run={run} pause={pause} />
                )}
              </div>
            </div>
            <footer className={css.footer}>
              <div className={css.transport}>
                <button className={css.play} type="button" onClick={toggle}>
                  {playing ? (
                    <Pause size={15} />
                  ) : position.ended ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Play size={15} />
                  )}{" "}
                  {playing ? "Pause" : position.ended ? "Replay" : "Play"}
                </button>
                <span className={css.time}>
                  {timecode(position.time)} / {timecode(guideDuration)}
                </span>
                <div className={css.navigation}>
                  <button
                    type="button"
                    aria-label="Previous chapter"
                    disabled={position.index === 0}
                    onClick={() => seek(chapters[position.index - 1].start)}
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={
                      position.index === chapters.length - 1
                        ? "Finish guided replay"
                        : "Next chapter"
                    }
                    onClick={() =>
                      position.index === chapters.length - 1
                        ? onClose()
                        : seek(chapters[position.index + 1].start)
                    }
                  >
                    {position.index === chapters.length - 1 ? (
                      "Finish"
                    ) : (
                      <ArrowRight size={15} />
                    )}
                  </button>
                </div>
              </div>
              <input
                className={css.scrub}
                type="range"
                aria-label="Replay position"
                aria-valuetext={timecode(position.time) + ", " + chapter.title}
                min={0}
                max={guideDuration}
                step={1}
                value={Math.floor(position.time)}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
