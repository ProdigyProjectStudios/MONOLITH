import { useId, useMemo, useRef, useState, type RefObject } from "react";
import {
  ChevronDown,
  Download,
  FileText,
  FileUp,
  Search,
  Table2,
} from "lucide-react";
import {
  attachRuntime,
  can,
  productionRuntime,
  server,
  signOut,
  useBrowserRuntime,
} from "../lib/client";
import type { State } from "../lib/types";
import { Evidence } from "./Detail";
import HubSpotConnection from "./HubSpotConnection";
import RuntimeReadiness from "./RuntimeReadiness";
import { number, Tag } from "./UI";
import css from "./Operations.module.css";

function RuntimeConnection({
  s,
  headingRef,
}: {
  s: State;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className={css.connection} aria-label="Investigation runtime">
      <header>
        <p className={css.kicker}>Execution environment</p>
        <h2 tabIndex={-1} ref={headingRef} className={css.connectionTarget}>
          Investigation runtime
        </h2>
        <Tag color={s.ai ? "lime" : "neutral"}>
          {server
            ? s.ai
              ? "OpenAI configured"
              : "API · deterministic"
            : "Browser · deterministic"}
        </Tag>
      </header>
      <p>
        {server
          ? "Connected to " + server
          : "Connect your API to run server-side specialists and inspect their recorded tool calls."}
      </p>
      {!productionRuntime && (
        <form
          className={css.runtimeForm}
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
        <p className={css.identity}>
          {s.identity.actor} · {s.identity.role}
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

function SourceRecords({
  s,
  id,
  regionId,
}: {
  s: State;
  id: string;
  regionId: string;
}) {
  const [page, setPage] = useState(0);
  const records = useMemo(
    () => [
      ...s.data.docs.filter((d) => d.source === id),
      ...s.data.events.filter((row) => row.source === id),
    ],
    [s.data, id],
  );
  const pageSize = 4;
  const lastPage = Math.max(0, Math.ceil(records.length / pageSize) - 1);
  const current = Math.min(lastPage, page);
  const start = current * pageSize;
  return (
    <div id={regionId} className={"detail-section " + css.sourceDetail}>
      <div className={css.provenance}>
        <span>Source ID</span>
        <code>{id}</code>
      </div>
      {records.slice(start, start + pageSize).map((row) => (
        <Evidence key={row.id} id={row.id} s={s} />
      ))}
      {records.length > pageSize && (
        <div className={css.pager}>
          <span>
            {number(start + 1)}–
            {number(Math.min(start + pageSize, records.length))} of{" "}
            {number(records.length)} records
          </span>
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={current === lastPage}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
      {!records.length && (
        <p>No source rows are available in this workspace.</p>
      )}
    </div>
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
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const regionId = useId();
  const runtimeTarget = useRef<HTMLHeadingElement>(null);
  const mayUpload = can(s, "sources:write");
  const counts = useMemo(() => {
    const index = new Map<string, { events: number; pages: number }>();
    for (const [kind, rows] of [
      ["events", s.data.events],
      ["pages", s.data.docs],
    ] as const) {
      for (const row of rows) {
        const value = index.get(row.source) ?? { events: 0, pages: 0 };
        value[kind]++;
        index.set(row.source, value);
      }
    }
    return index;
  }, [s.data.events, s.data.docs]);
  const key = query.trim().toLowerCase();
  const filtered = s.data.sources.filter(
    (source) =>
      !key ||
      [
        source.name,
        source.kind,
        source.id,
        source.synthetic ? "synthetic" : "imported",
      ].some((text) => text.toLowerCase().includes(key)),
  );
  return (
    <div className={css.workspace}>
      <div className={css.sourcesGrid}>
        <section className={css.registry}>
          <header className={css.registryHead}>
            <p className={css.kicker}>
              {number(s.data.sources.length)} registered sources
            </p>
            <h2>Workspace sources</h2>
            <p>
              {number(s.data.events.length)} event rows ·{" "}
              {number(s.data.docs.length)} document{" "}
              {s.data.docs.length === 1 ? "page" : "pages"}
            </p>
            <div className={css.mobileSourceTools}>
              {mayUpload && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  Import a file
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const target = runtimeTarget.current;
                  target?.focus({ preventScroll: true });
                  target?.scrollIntoView({ block: "start" });
                }}
              >
                Connection settings
              </button>
            </div>
          </header>
          {s.data.sources.length > 0 && (
            <label className={css.sourceSearch}>
              <Search size={15} />
              <input
                type="search"
                aria-label="Find a source"
                placeholder="Find by name, type or origin"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <div className={css.fileList}>
            {filtered.map((source) => {
              const { events, pages } = counts.get(source.id) ?? {
                events: 0,
                pages: 0,
              };
              const open = selected === source.id;
              return (
                <div className={css.fileEntry} key={source.id}>
                  <button
                    type="button"
                    className={"source-row " + css.sourceRow}
                    aria-expanded={open}
                    aria-controls={open ? regionId : undefined}
                    onClick={() => setSelected(open ? "" : source.id)}
                  >
                    <span className={css.fileIcon}>
                      {source.kind === "PDF" ? (
                        <FileText size={19} />
                      ) : (
                        <Table2 size={19} />
                      )}
                    </span>
                    <span className={css.fileName}>
                      <strong>{source.name}</strong>
                      <small>
                        {source.kind} ·{" "}
                        {source.synthetic ? "Synthetic" : "Imported"}
                      </small>
                    </span>
                    <span className={css.fileCount}>
                      {events > 0 || !pages ? number(events) + " events" : ""}
                      {events > 0 && pages > 0 ? " · " : ""}
                      {pages > 0
                        ? number(pages) + (pages === 1 ? " page" : " pages")
                        : ""}
                    </span>
                    <ChevronDown size={15} />
                  </button>
                  {open && (
                    <SourceRecords s={s} id={source.id} regionId={regionId} />
                  )}
                </div>
              );
            })}
            {!filtered.length && (
              <p className={css.empty}>
                {key
                  ? "No sources match this search."
                  : "Import an event log or document to begin."}
              </p>
            )}
          </div>
        </section>
        <section className={css.importPanel} aria-label="File import">
          <div>
            <p className={css.kicker}>
              {server ? "API workspace" : "Browser storage"}
            </p>
            <h2>Import a source</h2>
            <p>
              {server
                ? "Files are processed in your FastAPI workspace."
                : "Files are processed and saved in this browser."}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || !mayUpload}
            className={css.upload}
            data-drag={drag || undefined}
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
            <FileUp size={28} strokeWidth={1.35} />
            <strong>
              {mayUpload
                ? "Choose a file or drop it here"
                : "Source import requires write access"}
            </strong>
            <span>CSV or text PDF · Up to 6 MiB</span>
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
          <a href="/sample-events.csv" download className={css.download}>
            <Download size={14} />
            Download example CSV
          </a>
        </section>
      </div>
      <div className={css.connections}>
        <RuntimeConnection s={s} headingRef={runtimeTarget} />
        <HubSpotConnection s={s} busy={busy} sync={sync} />
      </div>
    </div>
  );
}
