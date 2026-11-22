import {
  Activity,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileText,
  GitBranch,
  Layers3,
  Link2,
  LockKeyhole,
  Network,
  Plug,
  ShieldCheck,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { useRef, useState } from "react";
import { attachRuntime, server, useBrowserRuntime } from "../lib/client";
import { type Rec, type State } from "../lib/types";
import { Evidence } from "./Detail";
import { Flow } from "./Flow";
import { Topology } from "./Overview";
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
export function Processes({
  s,
  initialVariant = 0,
}: {
  s: State;
  initialVariant?: number;
}) {
  const r = s.report,
    [idx, setIdx] = useState(initialVariant),
    [chosen, setChosen] = useState("");
  const path = r.paths[idx] || r.paths[0];
  if (!path)
    return (
      <div className="panel empty">
        Import an event log to discover a process path.
      </div>
    );
  const groups = new Map<string, typeof s.data.events>();
  for (const e of s.data.events) {
    const g = groups.get(e.case) || [];
    g.push(e);
    groups.set(e.case, g);
  }
  const allowed = new Set(r.case_ids);
  const matching = Array.from(groups)
    .filter(([id, rows]) => {
      rows.sort(
        (a, b) =>
          a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
      );
      return (
        allowed.has(id) &&
        JSON.stringify(rows.map((e) => e.activity)) ===
          JSON.stringify(path.steps)
      );
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  const c = matching.find(([id]) => id === chosen) || matching[0];
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="section-eyebrow">
              <GitBranch size={13} /> DISCOVERED PROCESS
            </div>
            <h2>Execution path</h2>
          </div>
          <select
            aria-label="Process variant"
            value={r.paths.indexOf(path)}
            onChange={(e) => {
              setIdx(+e.target.value);
              setChosen("");
            }}
          >
            {r.paths.map((p, i) => (
              <option key={i} value={i}>
                Variant {i + 1} · {p.count} cases
              </option>
            ))}
          </select>
        </div>
        <Flow labels={path.steps} />
        <div className="map-foot">
          <span>{path.steps.length} observed steps</span>
          <span>{r.mining} discovery</span>
        </div>
      </section>
      <div className="two-col">
        <section className="panel block">
          <div className="section-eyebrow">
            <Clock3 size={13} /> TIMELINE
          </div>
          <div className="inline-head">
            <h2>Case events</h2>
            <select
              aria-label="Select case"
              value={c?.[0] || ""}
              onChange={(e) => setChosen(e.target.value)}
            >
              {matching.map(([id]) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </div>
          {c?.[1].map((e) => (
            <Evidence s={s} id={e.id} key={e.id} />
          ))}
        </section>
        <section className="panel block">
          <div className="section-eyebrow">
            <Activity size={13} /> ELAPSED INTERVALS
          </div>
          <h2>Bottlenecks</h2>
          {r.bottlenecks.slice(0, 4).map((b) => (
            <details className="bottleneck" key={b.first + b.last}>
              <summary>
                <span>
                  {b.first} → {b.last}
                </span>
                <b>{b.hours}h</b>
              </summary>
              <p>{b.count} observed transitions · median elapsed time</p>
              {b.evidence.map((id) => (
                <Evidence key={id} s={s} id={id} />
              ))}
            </details>
          ))}
        </section>
      </div>
    </>
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
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="section-eyebrow">
              <Layers3 size={13} /> PROPOSED ARCHITECTURE
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
        </div>
        <Flow labels={b.nodes} blue />
        <div className="map-foot">
          <span>
            <LockKeyhole size={13} /> Explicit approval required before rollout
          </span>
          <button className="text-btn" onClick={() => open(rec)}>
            Inspect evidence <ChevronRight size={14} />
          </button>
        </div>
      </section>
      <div className="two-col">
        <section className="panel block">
          <div className="section-eyebrow">IMPLEMENTATION</div>
          <h2>Pilot roadmap</h2>
          {b.phases.map((v, i) => (
            <div className="road" key={v}>
              <code>0{i + 1}</code>
              <p>{v}</p>
            </div>
          ))}
        </section>
        <section className="panel block">
          <div className="section-eyebrow">PREREQUISITES</div>
          <h2>Dependencies</h2>
          {b.dependencies.map((v) => (
            <div className="road" key={v}>
              <Link2 size={15} />
              <p>{v}</p>
            </div>
          ))}
          <div className="detail-section">
            <h3>Decision boundary</h3>
            <p>
              {rec.kind === "Human-led"
                ? "An accountable human retains authority over every dispute decision."
                : "A human authorises rollout after the shadow run and exception review."}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
export function Agents({ s }: { s: State }) {
  return (
    <>
      <section className="panel block">
        <div className="section-eyebrow">
          <Workflow size={13} /> EXECUTION TRACE
        </div>
        <div className="inline-head">
          <h2>Specialist execution</h2>
          <Tag color="lime">{s.report.engine}</Tag>
        </div>
        {s.report.traces.map((v, i) => (
          <details className="trace" key={v.role}>
            <summary>
              <span className="step">{String(i + 1).padStart(2, "0")}</span>
              <strong>{v.role}</strong>
              <span className="mono">{v.ms.toFixed(2)} ms</span>
              <Check size={16} />
            </summary>
            <p>
              Executed tool <code>{v.tool}</code> · {v.status}
            </p>
            {v.finding && (
              <>
                <p>{v.finding.statement}</p>
                <p>{v.finding.limitation}</p>
                {v.finding.evidence.map((id) => (
                  <Evidence key={id} s={s} id={id} />
                ))}
              </>
            )}
          </details>
        ))}
      </section>
      <section className="panel block">
        <div className="section-eyebrow">
          <ShieldCheck size={13} /> OBSERVABILITY
        </div>
        <h2>Workspace audit trail</h2>
        {s.audit.length ? (
          s.audit.map((a, i) => (
            <div className="audit" key={i}>
              <p>
                {a.action}
                <small>{a.detail}</small>
              </p>
              <code>
                {new Date(a.at).toLocaleString("en-GB", { timeZone: "UTC" })}{" "}
                UTC
              </code>
            </div>
          ))
        ) : (
          <p className="muted">
            Analysis runs, imports and approval decisions will appear here.
          </p>
        )}
      </section>
    </>
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
            setError(err instanceof Error ? err.message : "Connection failed");
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
  sync: () => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    [drag, setDrag] = useState(false),
    [selected, setSelected] = useState("");
  const source = s.data.sources.find((i) => i.id === selected);
  return (
    <>
      <section className="panel block">
        <div className="section-eyebrow">
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
          disabled={busy}
          className={"drop " + (drag ? "drag" : "")}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy && e.dataTransfer.files[0])
              upload(e.dataTransfer.files[0]);
          }}
        >
          <UploadCloud size={25} />
          <strong>Choose a file or drop it here</strong>
          <span>CSV / PDF</span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.pdf"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <a href="/sample-events.csv" download className="text-btn download">
          <Download size={14} /> Download example CSV
        </a>
      </section>
      <section className="panel block">
        <div className="section-eyebrow">SOURCE REGISTRY</div>
        <h2>Workspace sources</h2>
        {s.data.sources.map((v) => (
          <button
            className="source-row"
            key={v.id}
            onClick={() => setSelected(selected === v.id ? "" : v.id)}
          >
            {v.kind === "PDF" ? <FileText size={17} /> : <Database size={17} />}
            <strong>{v.name}</strong>
            <Tag color={v.synthetic ? "neutral" : "blue"}>
              {v.synthetic ? "Synthetic" : "Imported"}
            </Tag>
            <ChevronRight size={14} />
          </button>
        ))}
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
      <section className="panel block">
        <div className="section-eyebrow">
          <Plug size={13} /> READ-ONLY CONNECTOR
        </div>
        <div className="inline-head">
          <h2>HubSpot deals</h2>
          <Tag color={s.hubspot ? "lime" : "neutral"}>
            {s.hubspot ? "Credentials configured" : "Not connected"}
          </Tag>
        </div>
        <p className="muted">
          {s.hubspot
            ? "Sync current deal observations using the saved watermark."
            : "The FastAPI adapter accepts a development access token or OAuth refresh credentials."}
        </p>
        {s.hubspot && (
          <button className="btn" disabled={busy} onClick={sync}>
            Sync deals
          </button>
        )}
      </section>
      <RuntimeConnection s={s} />
    </>
  );
}
