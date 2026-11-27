"use client";

import { AnimatePresence, usePanelMotion } from "./WorkspaceMotion";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  FileCheck2,
  LoaderCircle,
  Play,
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  archiveTenant,
  loadLiveArchive,
  type ArchivedCapture,
} from "../lib/liveArchive";
import type { RunEvent } from "../lib/investigations";
import BlueprintDossier from "./BlueprintDossier";
import { Evidence } from "./Detail";
import GuidedDemo from "./GuidedDemo";
import css from "./LiveRunArchive.module.css";

const date = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "UTC" });
const label = (v: string) =>
  v.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());
function receiptTitle(event: RunEvent) {
  const p = event.payload;
  if (event.kind === "model_call")
    return typeof p.model === "string"
      ? p.model + " response"
      : "Provider response";
  if (event.kind === "tool_result" && typeof p.name === "string") return p.name;
  return label(event.kind);
}
function Trace({ capture }: { capture: ArchivedCapture }) {
  const events = capture.run.events;
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      events.findIndex((e) => e.kind === "model_call"),
    ),
  );
  const current = events[index],
    payload = current.payload;
  const ids = Array.isArray(payload.evidence)
    ? payload.evidence.filter((v): v is string => typeof v === "string")
    : [];
  return (
    <section className={css.trace} aria-label="Archived execution trace">
      <div className={css.traceHead}>
        <h3>
          <SquareTerminal size={16} /> Recorded execution
        </h3>
        <span>
          {index + 1} / {events.length}
        </span>
      </div>
      <label className={css.scrub}>
        <input
          type="range"
          min={1}
          max={events.length}
          step={1}
          value={index + 1}
          aria-label="Replay event"
          onChange={(e) => setIndex(Number(e.target.value) - 1)}
        />
      </label>
      <div className={css.transport}>
        <button
          type="button"
          aria-label="Previous event"
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          aria-label="Next event"
          disabled={index === events.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          <ArrowRight size={14} />
        </button>
        <select
          aria-label="Jump to recorded stage"
          value={current.stage}
          onChange={(e) => {
            const next = events.findIndex((v) => v.stage === e.target.value);
            if (next >= 0) setIndex(next);
          }}
        >
          {[...new Set(events.map((v) => v.stage))].map((stage) => (
            <option key={stage} value={stage}>
              {label(stage)}
            </option>
          ))}
        </select>
      </div>
      <div className={css.event} key={current.seq}>
        <div className={css.eventTag}>
          <span>{label(current.kind)}</span>
          <time dateTime={current.at}>{clock(current.at)} UTC</time>
        </div>
        <h4>{receiptTitle(current)}</h4>
        {typeof payload.agent === "string" && <p>{payload.agent}</p>}
        {typeof payload.summary === "string" && <p>{payload.summary}</p>}
        {current.kind === "model_call" && (
          <div className={css.receiptMeta}>
            <span>
              Recorded transport{" "}
              <b>
                {capture.fixture
                  ? "Responses protocol fixture"
                  : "OpenAI Responses"}
              </b>
            </span>
            <span>
              Response alias <code>{String(payload.response_id)}</code>
            </span>
          </div>
        )}
        <details>
          <summary>Inspect recorded payload</summary>
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </details>
      </div>
      {ids.length > 0 && (
        <div className={css.evidence}>
          <h4>
            <BookOpen size={14} /> Cited records
          </h4>
          {ids.map((id) => (
            <Evidence key={id} id={id} s={capture.snapshot} />
          ))}
        </div>
      )}
    </section>
  );
}
function Replay({ capture }: { capture: ArchivedCapture }) {
  const [tab, setTab] = useState<"trace" | "blueprint">("trace"),
    [guided, setGuided] = useState(false);
  return (
    <>
      <section className={css.summary}>
        <div className={css.kicker}>
          <ShieldCheck size={14} />{" "}
          {capture.fixture
            ? "Test fixture · no live provider calls"
            : "Verified capture · synthetic Northstar data"}
        </div>
        <h2>
          {capture.fixture
            ? "Replay contract fixture"
            : "Saved OpenAI investigation"}
        </h2>
        <p>
          Refund routing at Northstar Commerce. Playback reads the saved run and
          uses no provider credits.
        </p>
        <div className={css.meta}>
          <span>
            <Clock3 size={13} />
            {date(capture.capturedAt)}
          </span>
          <span>
            <FileCheck2 size={13} />{" "}
            {capture.fixture ? "Sample approval" : "Human approval recorded"}
          </span>
        </div>
        <div className={css.stats}>
          <div>
            <strong>{capture.modelCalls.toLocaleString()}</strong>
            <span>Saved model calls</span>
          </div>
          <div>
            <strong>{capture.totalTokens.toLocaleString()}</strong>
            <span>Recorded tokens</span>
          </div>
          <div>
            <strong>{capture.run.events.length.toLocaleString()}</strong>
            <span>Trace events</span>
          </div>
          <div>
            <strong>
              {capture.costUsd === null
                ? "Unpriced"
                : new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 6,
                  }).format(capture.costUsd)}
            </strong>
            <span>Historical cost estimate</span>
          </div>
        </div>
        <button
          className={css.guided}
          type="button"
          onClick={() => setGuided(true)}
        >
          <Play size={13} /> Play archived walkthrough
        </button>
      </section>
      <div className={css.tabs} role="group" aria-label="Archived views">
        {[
          ["trace", "Execution trace"],
          ["blueprint", "Approved blueprint"],
        ].map(([key, title]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key as typeof tab)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "trace" ? (
        <Trace capture={capture} />
      ) : (
        <BlueprintDossier
          s={capture.snapshot}
          run={capture.run}
          replayLabel={
            capture.fixture
              ? "Test fixture · no live provider calls"
              : undefined
          }
        />
      )}
      <details className={css.integrity}>
        <summary>
          <Check size={13} /> Capture provenance
        </summary>
        <dl>
          <dt>Run ID</dt>
          <dd>{capture.run.id}</dd>
          <dt>Captured file SHA-256</dt>
          <dd>{capture.sha256}</dd>
          <dt>Verification basis</dt>
          <dd>
            {capture.fixture
              ? "Generated by an isolated protocol test. Its receipts and approval are synthetic."
              : "Authenticated MONOLITH receipts reconciled by the exporter. The browser checks the saved file, source snapshot, provider call totals and approval."}
          </dd>
        </dl>
      </details>
      <AnimatePresence>
        {guided && (
          <GuidedDemo
            s={capture.snapshot}
            run={capture.run}
            replayLabel={
              capture.fixture ? "Test fixture · no live provider calls" : undefined
            }
            onClose={() => setGuided(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
type ArchiveState =
  | { status: "loading" | "absent" }
  | { status: "ready"; capture: ArchivedCapture }
  | { status: "failed"; error: string };
function ArchiveDialog({
  tenant,
  close,
}: {
  tenant: string;
  close: () => void;
}) {
  const motion = usePanelMotion("dialog");
  const [value, setValue] = useState<ArchiveState>({ status: "loading" }),
    [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDialogElement>(null),
    heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = scroll;
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setValue({ status: "loading" });
    void loadLiveArchive(tenant, controller.signal).then(
      (capture) => {
        if (!controller.signal.aborted)
          setValue(
            capture ? { status: "ready", capture } : { status: "absent" },
          );
      },
      (e) => {
        if (!controller.signal.aborted)
          setValue({
            status: "failed",
            error:
              e instanceof Error
                ? e.message
                : "The recording could not be loaded.",
          });
      },
    );
    return () => controller.abort();
  }, [tenant, attempt]);
  return (
    <dialog
      {...motion}
      ref={ref}
      className={css.dialog}
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className={css.frame}>
        <header className={css.header}>
          <div>
            <Archive size={18} />
            <h1 id={heading}>Live run archive</h1>
          </div>
          <button
            type="button"
            aria-label="Close live run archive"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <div className={css.content}>
          {value.status === "ready" ? (
            <Replay capture={value.capture} />
          ) : value.status === "loading" ? (
            <div className={css.empty} role="status">
              <LoaderCircle size={20} />
              <p>Checking the saved recording…</p>
            </div>
          ) : value.status === "absent" ? (
            <div className={css.empty}>
              <Archive size={25} />
              <h2>No verified recording is available</h2>
              <p>
                This archive opens a saved OpenAI investigation after its
                provider receipts, synthetic source records and human design
                approval pass verification.
              </p>
              <button type="button" onClick={close}>
                Back to Studio
              </button>
            </div>
          ) : value.status === "failed" ? (
            <div className={css.empty} role="alert">
              <ShieldCheck size={23} />
              <h2>Unable to open this recording</h2>
              <p>{value.error}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                Check again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
export default function LiveRunArchive({ tenant }: { tenant: string }) {
  const [open, setOpen] = useState(false);
  if (tenant !== archiveTenant) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Archive size={15} /> Live run archive
      </button>
      <AnimatePresence>
        {open && <ArchiveDialog tenant={tenant} close={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
