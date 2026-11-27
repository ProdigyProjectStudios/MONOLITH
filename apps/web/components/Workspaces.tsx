import SourceCoverage from "./SourceCoverage";
import visual from "./OperationalWork.module.css";
import AgentProfile from "./AgentProfile";
import RuntimeReadiness from "./RuntimeReadiness";
import styles from "./WorkAreas.module.css";
import {
  Check,
  ChevronRight,
  Database,
  Download,
  FileText,
  Layers3,
  Link2,
  LockKeyhole,
  Network,
  ShieldCheck,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  can,
  productionRuntime,
  signOut,
  attachRuntime,
  server,
  useBrowserRuntime,
} from "../lib/client";
import { type Rec, type State } from "../lib/types";
import { Evidence } from "./Detail";
import HubSpotConnection from "./HubSpotConnection";
import BlueprintSequence from "./BlueprintSequence";
import { Register, Topology } from "./Overview";
import { OpportunityComparison } from "./OpportunityComparison";
import { number, Tag } from "./UI";
export function MapView({
  s,
  selected,
  select,
}: {
  s: State;
  selected: string;
  select: (s: string) => void;
}) {
  const r = s.report,
    system = r.systems.find((x) => x.name === selected) || r.systems[0];
  if (!system)
    return (
      <div className="panel empty">
        Import an event log to discover system relationships.
      </div>
    );
  const routes = r.links.filter(
    (l) => l.source === system.name || l.target === system.name,
  );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="section-eyebrow">
              <Network size={13} /> KNOWLEDGE GRAPH
            </div>
            <h2>System topology</h2>
          </div>
          <Tag>{r.systems.length} systems</Tag>
        </div>
        <div className="large-map">
          <Topology
            systems={r.systems}
            links={r.links}
            selected={system.name}
            onSelect={select}
          />
        </div>
      </section>
      <section className="panel block">
        <div className="section-eyebrow">SYSTEM INSPECTOR</div>
        <h2>{system.name}</h2>
        <p className="muted">
          {number(system.count)} observed events · {routes.length} directed
          relationships
        </p>
        <div className="rows">
          {routes.map((l) => (
            <div key={l.source + l.target}>
              <span>
                {l.source} <ChevronRight size={13} /> {l.target}
              </span>
              <code>{number(l.count)} handoffs</code>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
export function Opportunities({
  recs,
  open,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
}) {
  return (
    <div className={styles.work}>
      <OpportunityComparison recs={recs} open={open} />
      <Register recs={recs} open={open} />
    </div>
  );
}
export function Blueprint({
  s,
  id,
  pick,
  open,
}: {
  s: State;
  id: string;
  pick: (id: string) => void;
  open: (r: Rec) => void;
}) {
  const rec =
    s.report.recommendations.find((r) => r.id === id) ||
    s.report.recommendations[0];
  if (!rec)
    return (
      <div className="panel empty">
        A supported opportunity is needed to generate a blueprint.
      </div>
    );
  const b = s.report.blueprints[rec.id];
  return (
    <div className={styles.work}>
      <section className={styles.panel}>
        <header className={styles.head}>
          <div>
            <div className={styles.eyebrow + " " + styles.blueprintLabel}>
              <Layers3 size={13} />
              Proposed architecture
            </div>
            <h2>{rec.title}</h2>
          </div>
          <select
            aria-label="Blueprint opportunity"
            value={rec.id}
            onChange={(e) => pick(e.target.value)}
          >
            {s.report.recommendations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </header>
        <dl className={styles.stats}>
          <div>
            <dt>Measured cases</dt>
            <dd>{number(rec.cases)}</dd>
          </div>
          <div>
            <dt>Median preceding interval</dt>
            <dd>{rec.hours}h</dd>
          </div>
        </dl>
        <BlueprintSequence key={rec.id} nodes={b.nodes} />
        <div className={styles.foot}>
          <span className={styles.legend + " " + styles.proposed}>
            Proposed sequence
          </span>
          <span>
            <LockKeyhole size={13} />
            Explicit approval required before rollout
          </span>
          <button className="text-btn" onClick={() => open(rec)}>
            Inspect evidence <ChevronRight size={14} />
          </button>
        </div>
      </section>
      <div className={styles.columns}>
        <section className={styles.panel}>
          <header className={styles.sectionHead}>
            <div className={styles.eyebrow}>Implementation</div>
            <h2>Pilot roadmap</h2>
          </header>
          <ol className={styles.sectionContent + " " + styles.stepList}>
            {b.phases.map((v, i) => (
              <li key={v}>
                <code>{String(i + 1).padStart(2, "0")}</code>
                <span>{v}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.panel}>
          <header className={styles.sectionHead}>
            <div className={styles.eyebrow}>Prerequisites</div>
            <h2>Dependencies</h2>
          </header>
          <div className={styles.sectionContent}>
            <ul className={styles.list + " " + styles.stepList}>
              {b.dependencies.map((v) => (
                <li key={v}>
                  <Link2 size={14} />
                  <span>{v}</span>
                </li>
              ))}
            </ul>
            <p className={styles.control}>
              <strong>Decision boundary</strong>
              {rec.kind === "Human-led"
                ? "An accountable human retains authority over every dispute decision."
                : "A human authorises rollout after the shadow run and exception review."}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
export function Agents({ s }: { s: State }) {
  const rows = useRef<(HTMLDetailsElement | null)[]>([]);
  const traces = s.report.traces;
  const peak = Math.max(0, ...traces.map((v) => v.ms));
  const total = traces.reduce((t, v) => t + v.ms, 0);
  return (
    <div className={styles.work}>
      <section className={styles.panel}>
        <header className={styles.head}>
          <div>
            <div className={styles.eyebrow}>
              <Workflow size={13} />
              Execution trace
            </div>
            <h2>Specialist execution</h2>
          </div>
          <Tag color="lime">{s.report.engine}</Tag>
        </header>
        {traces.length > 0 && (
          <dl className={styles.stats}>
            <div>
              <dt>Recorded stages</dt>
              <dd>{traces.length}</dd>
            </div>
            <div>
              <dt>Summed stage time</dt>
              <dd>
                {total >= 1000
                  ? (total / 1000).toFixed(2) + "s"
                  : total.toFixed(2) + " ms"}
              </dd>
            </div>
          </dl>
        )}
        <AgentProfile
          traces={traces}
          inspect={(i) => {
            const row = rows.current[i];
            if (row) {
              row.open = true;
              row.querySelector("summary")?.focus();
            }
          }}
        />
        <div className={styles.traceBody}>
          {!traces.length && (
            <p className={styles.bodyText}>
              Recorded tool executions appear here after an analysis run.
            </p>
          )}
          {traces.map((v, i) => (
            <details
              className={styles.traceRow}
              key={i}
              ref={(el) => {
                rows.current[i] = el;
              }}
            >
              <summary>
                <span className={styles.traceIndex}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={styles.traceName}>
                  <strong>{v.role}</strong>
                  <small>{v.tool}</small>
                </span>
                <span className={styles.latencyBar} aria-hidden="true">
                  <i
                    style={{ width: (peak ? (100 * v.ms) / peak : 0) + "%" }}
                  />
                </span>
                <span className={styles.ms}>{v.ms.toFixed(2)} ms</span>
                <ChevronRight size={13} />
              </summary>
              <div className={styles.traceDetail}>
                <span>
                  <Check size={13} />
                  {v.status}
                </span>
                {v.finding && (
                  <>
                    <p>{v.finding.statement}</p>
                    <p>{v.finding.limitation}</p>
                    {v.finding.evidence.map((id) => (
                      <Evidence key={id} s={s} id={id} />
                    ))}
                  </>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <header className={styles.head}>
          <div>
            <div className={styles.eyebrow}>
              <ShieldCheck size={13} />
              Observability
            </div>
            <h2>Workspace audit trail</h2>
          </div>
        </header>
        <div className={styles.auditBody}>
          {s.audit.length ? (
            s.audit.map((a, i) => (
              <div className={styles.auditRow} key={i}>
                <span>
                  <strong>{a.action}</strong>
                  <small>{a.detail}</small>
                </span>
                <time dateTime={a.at}>
                  {new Date(a.at).toLocaleString("en-GB", { timeZone: "UTC" })}{" "}
                  UTC
                </time>
              </div>
            ))
          ) : (
            <p className={styles.bodyText}>
              Analysis runs, imports and approval decisions will appear here.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
function RuntimeConnection({ s }: { s: State }) {
  const [connecting, setConnecting] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel block">
      <div className="inline-head">
        <h2>Investigation runtime</h2>
        <Tag color={s.ai ? "lime" : "neutral"}>
          {server
            ? s.ai
              ? "OpenAI configured"
              : "API · deterministic"
            : "Browser · deterministic"}
        </Tag>
      </div>
      <p className="muted">
        {server
          ? "Connected to " + server
          : "Connect a MONOLITH API to run server-side specialists and stream their tool calls."}
      </p>
      {!productionRuntime && (
        <form
          className="runtime-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setConnecting(true);
            try {
              await attachRuntime(
                String(new FormData(e.currentTarget).get("endpoint") || ""),
              );
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Connection failed",
              );
            } finally {
              setConnecting(false);
            }
          }}
        >
          <label>
            MONOLITH API URL
            <input
              name="endpoint"
              type="url"
              defaultValue={server || ""}
              placeholder="https://your-api.example"
              required
            />
          </label>
          <button disabled={connecting} className="btn">
            {connecting ? "Connecting…" : "Connect API"}
          </button>
          {server && (
            <button type="button" className="btn" onClick={useBrowserRuntime}>
              Use browser workspace
            </button>
          )}
        </form>
      )}
      {server && s.identity && (
        <p className="muted">
          {s.identity.actor} · {s.identity.role}{" "}
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </p>
      )}
      {(!s.identity ||
        s.identity.permissions.includes("operations:manage")) && (
        <RuntimeReadiness tenant={s.tenant} />
      )}
      {error && (
        <p className="runtime-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function Sources({
  s,
  busy,
  upload,
  sync,
}: {
  s: State;
  busy: boolean;
  upload: (f: File) => void;
  sync: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null),
    [drag, setDrag] = useState(false),
    [selected, setSelected] = useState("");
  const mayUpload = can(s, "sources:write");
  const source = s.data.sources.find((i) => i.id === selected);
  const counts = new Map<string, { events: number; pages: number }>();
  for (const [kind, rows] of [
    ["events", s.data.events],
    ["pages", s.data.docs],
  ] as const) {
    for (const row of rows) {
      const value = counts.get(row.source) || { events: 0, pages: 0 };
      value[kind]++;
      counts.set(row.source, value);
    }
  }
  return (
    <div className={styles.work}>
      <div className={visual.sourceGrid}>
        <SourceCoverage s={s} id={selected} onSource={setSelected} />
        <section className={styles.panel + " " + styles.importPanel}>
          <div className={styles.eyebrow}>
            <Database size={13} /> INGESTION
          </div>
          <h2>Import a source</h2>
          <p className="muted">
            {server
              ? "Files are processed in your FastAPI workspace."
              : "Files are processed and saved in this browser."}{" "}
            CSV event logs and text-based PDFs up to 6 MB.
          </p>
          <button
            disabled={busy || !mayUpload}
            className={
              "drop " + styles.upload + (drag ? " drag " + styles.drag : "")
            }
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (mayUpload && !busy && e.dataTransfer.files[0])
                upload(e.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={25} />
            <strong>
              {mayUpload
                ? "Choose a file or drop it here"
                : "Source import requires write access"}
            </strong>
            <span>CSV / PDF</span>
          </button>
          <input
            ref={input}
            disabled={busy || !mayUpload}
            aria-label="Import CSV or PDF source"
            type="file"
            accept=".csv,.pdf"
            hidden
            onChange={(e) => {
              if (mayUpload && e.target.files?.[0]) upload(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <a href="/sample-events.csv" download className="text-btn download">
            <Download size={14} /> Download example CSV
          </a>
        </section>
      </div>
      <section className={styles.panel + " " + styles.registry}>
        <header className={styles.head}>
          <div>
            <div className={styles.eyebrow}>Source registry</div>
            <h2>Workspace sources</h2>
          </div>
          <span className={styles.count}>
            {number(s.data.sources.length)} sources
          </span>
        </header>
        {!s.data.sources.length && (
          <p className="empty">
            No sources have been imported into this workspace.
          </p>
        )}
        {s.data.sources.map((v) => {
          const { events, pages } = counts.get(v.id) || {
            events: 0,
            pages: 0,
          };
          return (
            <button
              className={"source-row " + styles.sourceRow}
              aria-expanded={selected === v.id}
              key={v.id}
              onClick={() => setSelected(selected === v.id ? "" : v.id)}
            >
              <span className={styles.fileIcon}>
                {v.kind === "PDF" ? (
                  <FileText size={15} />
                ) : (
                  <Database size={15} />
                )}
              </span>
              <span className={styles.sourceName}>
                <strong>{v.name}</strong>
                <small>
                  {v.kind} · {v.synthetic ? "Synthetic" : "Imported"}
                </small>
              </span>
              <span className={styles.recordCount}>
                {events > 0 || !pages ? number(events) + " events" : ""}
                {events > 0 && pages > 0 ? " · " : ""}
                {pages > 0
                  ? number(pages) + (pages === 1 ? " page" : " pages")
                  : ""}
              </span>
              <ChevronRight size={13} />
            </button>
          );
        })}
        {source && (
          <div className="detail-section">
            <h3>{source.name}</h3>
            <code>{source.id}</code>
            <p>
              {s.data.events.filter((e) => e.source === source.id).length}{" "}
              events ·{" "}
              {s.data.docs.filter((d) => d.source === source.id).length}{" "}
              document pages
            </p>
            {s.data.docs
              .filter((d) => d.source === source.id)
              .map((d) => (
                <Evidence key={d.id} id={d.id} s={s} />
              ))}
          </div>
        )}
      </section>
      <HubSpotConnection s={s} busy={busy} sync={sync} />
      <RuntimeConnection s={s} />
    </div>
  );
}
