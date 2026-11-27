"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Braces,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Cpu,
  Database,
  FileSearch,
  Fingerprint,
  GitBranch,
  GitCompareArrows,
  Layers3,
  Monitor,
  Network,
  ScanLine,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { State } from "../lib/types";
import type { InvestigationRun } from "../lib/investigations";
import { server } from "../lib/client";
import { paths, type Path, type Runtime } from "./architectureMap";
import ArchitecturePassage from "./ArchitecturePassage";
import skin from "./Overview.module.css";
import css from "./ArchitectureExplorer.module.css";

const icons = {
  source: FileSearch,
  snapshot: Database,
  stages: Cpu,
  scenario: GitCompareArrows,
  evaluation: ClipboardCheck,
  decision: ShieldCheck,
  revision: Layers3,
  window: ScanLine,
  graph: Network,
  checkpoint: GitBranch,
  memory: Database,
  outcome: Activity,
};
function RunRecord({
  run,
  snapshot,
  id,
  onObservatory,
}: {
  run: InvestigationRun | null;
  snapshot?: State;
  id: string;
  onObservatory: () => void;
}) {
  const result = run?.result,
    audit = result?.evaluation;
  let value = "No selected investigation",
    detail = "A completed or in-progress run supplies its own evidence here.";
  if (run) {
    if (id === "source") {
      value = snapshot
        ? `${snapshot.data.sources.length} frozen sources`
        : "Source snapshot unavailable";
      detail = snapshot
        ? `${snapshot.data.events.length.toLocaleString("en-GB")} event rows and ${snapshot.data.docs.length} extracted pages in the saved input.`
        : "No source counts can be derived from the saved input in this view.";
    }
    if (id === "snapshot") {
      value = run.days + "-day case window";
      detail = audit
        ? "Snapshot fingerprint · " + audit.snapshot_sha256
        : "Run " + run.id + " · " + run.status;
    }
    if (id === "stages") {
      const stages = new Set(
        run.events
          .filter((e) => e.kind === "stage_completed")
          .map((e) => e.stage),
      );
      value = stages.size + " completed stages";
      detail =
        run.events.filter((e) => e.kind === "handoff").length +
        " recorded handoffs · " +
        run.events.filter((e) => e.kind === "model_call").length +
        " model call receipts.";
    }
    if (id === "scenario") {
      const trials = Object.values(result?.trials ?? {});
      value = result ? trials.length + " saved trials" : "Result pending";
      detail = trials.length
        ? trials
            .map(
              (t) =>
                (result?.package.approaches.find((p) => p.id === t.approach)
                  ?.name ?? t.approach) +
                " · " +
                t.projected_median +
                " h projected median",
            )
            .join(" / ")
        : "Trial values appear when reported by the investigation.";
    }
    if (id === "evaluation") {
      value = audit
        ? audit.support.passed + " objective checks passed"
        : "Evaluation unavailable";
      detail = audit
        ? `${audit.support.failed} failed · ${audit.support.review} for review · ${audit.coverage.covered}/${audit.coverage.findings} findings cite available evidence.`
        : "Open Observatory to inspect available checks for this run.";
    }
    if (id === "decision") {
      value = run.approval
        ? "Approved design"
        : result?.verified
          ? "Awaiting human approval"
          : result
            ? "Verification held"
            : "Result pending";
      detail = run.approval
        ? run.approval.approach + " · " + run.approval.at
        : result?.evaluation?.status === "fail"
          ? "Independent checks hold this proposal for review."
          : "The run has no recorded human approval.";
      if (!run.approval && result?.evaluation?.status === "fail")
        value = "Approval held";
    }
  }
  return (
    <aside className={css.proof}>
      <span className={css.kicker}>
        <Fingerprint size={14} />
        Selected run evidence
      </span>
      <strong>{value}</strong>
      <p>{detail}</p>
      {run && (
        <button className={css.link} type="button" onClick={onObservatory}>
          Inspect in Observatory <ArrowRight size={14} />
        </button>
      )}
    </aside>
  );
}
export default function ArchitectureExplorer({
  run,
  snapshot,
  onObservatory,
}: {
  run: InvestigationRun | null;
  snapshot?: State;
  onObservatory: () => void;
}) {
  const [path, setPath] = useState<Path>("refund"),
    [runtime, setRuntime] = useState<Runtime>(server ? "api" : "browser"),
    [index, setIndex] = useState(0);
  const drawer = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]),
    uid = useId();
  const flow = paths[path],
    layer = flow.layers[index],
    Icon = icons[layer.id as keyof typeof icons];
  function pickPath(next: Path) {
    setPath(next);
    setIndex(0);
  }
  function move(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const size = flow.layers.length;
    const next = (
      {
        ArrowRight: (i + 1) % size,
        ArrowDown: (i + 1) % size,
        ArrowLeft: (i + size - 1) % size,
        ArrowUp: (i + size - 1) % size,
        Home: 0,
        End: size - 1,
      } as Record<string, number>
    )[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setIndex(next);
    tabRefs.current[next]?.focus();
  }
  return (
    <section
      className={css.explorer + " " + skin.fieldTheme}
      aria-label="Architecture explorer"
    >
      <header className={css.header}>
        <div>
          <span className={css.kicker}>
            <Network size={14} />
            System design
          </span>
          <h2>Architecture explorer</h2>
          <p>
            Trace the data contracts, execution boundaries and evidence behind
            an investigation.
          </p>
        </div>
        <a className="btn" href="/engineering-case-study/index.html">
          <BookOpen size={15} />
          Read the case study <ArrowRight size={13} />
        </a>
      </header>
      <div className={css.controls}>
        <div className={css.paths} role="group" aria-label="Architecture path">
          {(Object.keys(paths) as Path[]).map((p) => (
            <button
              type="button"
              key={p}
              aria-pressed={p === path}
              onClick={() => pickPath(p)}
            >
              {p === "refund" ? <Workflow size={15} /> : <Activity size={15} />}{" "}
              {paths[p].name}
            </button>
          ))}
        </div>
        <label className={css.runtime}>
          {runtime === "api" ? <Server size={14} /> : <Monitor size={14} />}{" "}
          Runtime design{" "}
          <select
            aria-label="Runtime design"
            value={runtime}
            onChange={(e) => setRuntime(e.target.value as Runtime)}
          >
            <option value="api">API deployment</option>
            <option value="browser">Browser demo</option>
          </select>
        </label>
      </div>
      <ArchitecturePassage
        layer={layer}
        index={index}
        total={flow.layers.length}
        runtime={runtime === "api" ? "API" : "Browser"}
        inspect={() => drawer.current?.focus()}
      >
        <div
          className={css.route}
          role="tablist"
          aria-label="Execution components"
        >
          {flow.layers.map((l, i) => {
            const Glyph = icons[l.id as keyof typeof icons];
            return (
              <button
                type="button"
                key={l.id}
                role="tab"
                id={uid + "-step-" + i}
                tabIndex={index === i ? 0 : -1}
                aria-selected={index === i}
                aria-controls={uid + "-panel"}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                onKeyDown={(e) => move(e, i)}
                onClick={() => setIndex(i)}
              >
                <span>
                  <Glyph size={19} />
                </span>
                <strong>{l.label}</strong>
                <ChevronRight size={13} className={css.connector} />
              </button>
            );
          })}
        </div>
      </ArchitecturePassage>
      <div
        ref={drawer}
        role="tabpanel"
        tabIndex={0}
        id={uid + "-panel"}
        aria-labelledby={uid + "-step-" + index}
        className={css.drawer + " " + skin.field}
      >
        <div className={css.contract}>
          <div className={css.title}>
            <span>
              <Icon size={22} />
            </span>
            <div>
              <span className={css.kicker}>{layer.label}</span>
              <h3>
                {runtime === "api"
                  ? "API implementation"
                  : "Browser implementation"}
              </h3>
            </div>
          </div>
          <p>{layer[runtime]}</p>
        </div>
        <div className={css.asides}>
          {path === "refund" ? (
            <RunRecord
              run={run}
              snapshot={snapshot}
              id={layer.id}
              onObservatory={onObservatory}
            />
          ) : (
            <aside className={css.proof}>
              <span className={css.kicker}>
                <CircleDot size={13} />
                Operational evidence
              </span>
              <strong>Revision history</strong>
              <p>
                Inspect the actual windows, graph epochs, investigation
                checkpoints and reassessments stored for this workspace.
              </p>
              <a className={css.link} href="#continuous-intelligence">
                Open change monitor <ArrowRight size={14} />
              </a>
            </aside>
          )}
          <details className={css.files}>
            <summary>
              <Braces size={14} />
              Implementation references
            </summary>
            <ul>
              {layer.files.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}
