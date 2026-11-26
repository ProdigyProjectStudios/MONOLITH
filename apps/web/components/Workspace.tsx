"use client";
import {
  CalendarDays,
  Check,
  ChevronDown,
  FlaskConical,
  Focus,
  LoaderCircle,
  Play,
  Clapperboard,
  Search,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/client";
import { type Page, pages, type Rec, type State } from "../lib/types";
import { Detail } from "./Detail";
import { Overview, OverviewBackdrop } from "./Overview";
import { menu } from "./UI";
import { Dock, TopBar } from "./WorkspaceNav";
import { useInvestigation } from "../lib/useInvestigation";
import Continuous from "./Continuous";
import { CheckpointTimeline } from "./ContinuousTimeline";
import { useContinuous } from "../lib/useContinuous";
import Studio from "./Studio";
import GuidedDemo from "./GuidedDemo";
import LiveRunArchive from "./LiveRunArchive";
import Twin from "./Twin";
import BlueprintDossier from "./BlueprintDossier";
import { Agents, Blueprint, MapView, Opportunities, Processes, Sources } from "./Workspaces";
const copy: Record<Page, [string, string]> = {
  Overview: [
    "Intelligence overview",
    "Operational signals, process patterns and evidence-backed opportunities.",
  ],
  "Business map": [
    "Business map",
    "Explore the observed handoffs between business systems.",
  ],
  "Process explorer": [
    "Process explorer",
    "Trace discovered paths from individual events to operational bottlenecks.",
  ],
  Opportunities: [
    "Automation opportunities",
    "Evaluate measured patterns, suitability and human decision boundaries.",
  ],
  "Technical blueprint": [
    "Technical blueprint",
    "Inspect proposed architectures, dependencies and implementation roadmaps.",
  ],
  "Intelligence studio": [
    "Agent Intelligence Studio",
    "Investigate refund approval delays from source records through to a verified design.",
  ],
  "Continuous intelligence": [
    "Continuous intelligence",
    "Follow changes in observed workflows and inspect the investigations they trigger.",
  ],
  "Agent activity": [
    "Agent activity",
    "Inspect specialist tool executions and workspace decisions.",
  ],
  "Data sources": [
    "Data sources",
    "Manage source records, provenance and read-only integrations.",
  ],
};
function initialPage(): Page {
  const p = decodeURIComponent(location.hash.slice(1)).replaceAll("-", " ");
  return pages.find((x) => x.toLowerCase() === p) || "Overview";
}
export default function Workspace() {
  const [s, setS] = useState<State | null>(null),
    [page, setPage] = useState<Page>("Overview"),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [drawer, setDrawer] = useState<Rec | null>(null),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [system, setSystem] = useState(""),
    [bp, setBp] = useState(""),
    [variant, setVariant] = useState(0),
    [mapMode, setMapMode] = useState<"twin" | "topology">("twin"),
    [blueprintMode, setBlueprintMode] = useState<"register" | "dossier">(
      "dossier",
    ),
    [range, setRange] = useState(false),
    [tourId, setTourId] = useState("");
  const investigation = useInvestigation(s, setErr);
  const continuous = useContinuous(
    s,
    setS,
    [
      investigation.run?.id,
      investigation.run?.status,
      investigation.run?.approval?.at,
    ].join("/"),
  );
  const [selectedSignal, setSelectedSignal] = useState<string>();
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>();
  const [monitorRun, setMonitorRun] = useState<string>();
  const selectedRun = continuous.view?.investigations.find(
    (r) => r.id === monitorRun,
  );
  function openMonitor(signalId?: string, snapshotId?: string) {
    setSelectedSignal(signalId);
    setSelectedSnapshot(snapshotId);
    navigate("Continuous intelligence");
  }
  function openStudio(id?: string) {
    const triggered = continuous.view?.investigations.some((r) => r.id === id);
    setMonitorRun(triggered ? id : undefined);
    if (id && !triggered) investigation.choose(id);
    navigate("Intelligence studio");
  }
  const reduced = useReducedMotion(),
    lock = useRef(false);
  const reload = useCallback(() => {
    setErr("");
    api
      .load()
      .then(setS)
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    reload();
    setPage(initialPage());
    const fn = () => {
      setPage(initialPage());
      setDrawer(null);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, [reload]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (document.querySelector('dialog[open], [role="dialog"]:not(.command)')) return;
        e.preventDefault();
        setSearch((v) => !v);
        setQuery("");
      }
      if (e.key === "Escape") {
        setSearch(false);
        setDrawer(null);
        setRange(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!search && !drawer) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(search ? ".command" : ".drawer");
    if (!dialog) return;
    const main = document.querySelector("main"), dock = document.querySelector<HTMLElement>("nav[aria-label='Primary sections']");
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
    )).filter(el => el.checkVisibility({ visibilityProperty: true }));
    controls()[0]?.focus();
    if (main) main.inert = true;
    if (dock) dock.inert = true;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = controls();
      const outside = !dialog.contains(document.activeElement);
      if (outside || (event.shiftKey ? document.activeElement === list[0] : document.activeElement === list.at(-1))) {
        event.preventDefault();
        (event.shiftKey ? list.at(-1) : list[0])?.focus();
      }
    };
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = priorOverflow;
      if (main) main.inert = false;
      if (dock) dock.inert = false;
      if (previous?.isConnected && previous.checkVisibility()) previous.focus({preventScroll:true});
    };
  }, [search, drawer]);
  useEffect(() => {
    if (!notice) return;
    const to = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(to);
  }, [notice]);
  const navigate = (p: Page) => {
    setTourId("");
    setPage(p);
    location.hash = p.toLowerCase().replaceAll(" ", "-");
    setSearch(false);
    setDrawer(null);
    setRange(false);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => document.getElementById("workspace-heading")?.focus({preventScroll:true}));
  };
  const act = async (
    label: string,
    fn: () => Promise<State>,
    message: string,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setErr("");
    try {
      const next = await fn();
      setS(next);
      setNotice(message);
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "Operation failed. Please retry.",
      );
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const startInvestigation = () => {
    navigate("Intelligence studio");
    setErr("");
    if(api.can(s,"investigations:run"))void investigation.start();
  };
  const openTour = async () => {
    setErr("");
    const existing = investigation.run;
    if (
      existing &&
      ["queued", "running", "completed"].includes(existing.status)
    ) {
      setTourId(existing.id);
      return;
    }
    const next = await investigation.start("deterministic");
    if (next) setTourId(next.id);
  };
  const tourRun = investigation.run?.id === tourId ? investigation.run : null;
  const openSearch = () => {
    setQuery("");
    setSearch(true);
    setDrawer(null);
  };
  const org = s && s.tenant !== "northstar" ? s.tenant : "Northstar Commerce";
  const sources = s?.data.sources ?? [];
  const datasetLabel = !sources.length
    ? "No sources"
    : sources.every((source) => source.synthetic)
      ? "Synthetic data"
      : sources.some((source) => source.synthetic)
        ? "Mixed sources"
        : "Imported data";
  return (
    <div className="shell" data-workspace={page}>
      {page === "Overview" && <OverviewBackdrop />}
      <a className="skip-link" href="#workspace-heading" onClick={event => {
        event.preventDefault(); document.getElementById("workspace-heading")?.focus();
      }}>Skip to workspace</a>
      <main>
        <TopBar
          page={page}
          navigate={navigate}
          recs={s?.report.recommendations ?? []}
          openRec={(r) => { setSearch(false); setDrawer(r); }}
          datasetLabel={s ? datasetLabel : undefined}
          org={org}
          openSearch={openSearch}
        />
        <div className="content">
          <div className="screenhead">
            <div>
              <div className="crumb-row">
                <nav className="crumb" aria-label="Breadcrumb">
                  <span>{org}</span>
                  <i aria-hidden="true">/</i>
                  <b aria-current="page">{page}</b>
                </nav>
                {s?.report.asof && <div className="eyebrow report-stamp">
                  <span className="stamp-line" aria-hidden="true" />
                  Evidence through <time dateTime={s.report.asof}>{s.report.asof.slice(0, 10)}</time>
                </div>}
              </div>
              <div className="heading-row">
                <h1 id="workspace-heading" tabIndex={-1}>{copy[page][0]}</h1>
                {page === "Business map" && s && (
                  <div
                    className="blueprint-switch"
                    role="group"
                    aria-label="Map view"
                  >
                    <button
                      aria-pressed={mapMode === "twin"}
                      onClick={() => setMapMode("twin")}
                    >
                      Operational twin
                    </button>
                    <button
                      aria-pressed={mapMode === "topology"}
                      onClick={() => setMapMode("topology")}
                    >
                      System topology
                    </button>
                  </div>
                )}
              </div>
              {page !== "Business map" && <p>{copy[page][1]}</p>}
            </div>
            {s && page === "Intelligence studio" && !selectedRun && (
              <div className="head-actions" style={{ flexWrap: "wrap" }}>
                <LiveRunArchive key={s.tenant} tenant={s.tenant} />
                <button
                  className="btn tour-launch"
                  onClick={() => void openTour()}
                  disabled={
                    investigation.busy ||
                    (!investigation.run && !api.can(s,"investigations:run")) ||
                    (!investigation.run &&
                      !s.report.recommendations.some((r) => r.id === "refund"))
                  }
                >
                  <Clapperboard size={15} />
                  90-second walkthrough
                </button>
              </div>
            )}
            {s &&
              page !== "Intelligence studio" &&
              page !== "Continuous intelligence" && (
                <div className="head-actions">
                  <div className="range-wrap">
                    <button
                      className="btn range-btn"
                      disabled={!!busy}
                      aria-expanded={range}
                      onClick={() => setRange(!range)}
                    >
                      <CalendarDays size={15} /> Last {s.report.days} days{" "}
                      <ChevronDown size={13} />
                    </button>
                    {range && (
                      <>
                        <button
                          className="menu-dismiss"
                          aria-label="Dismiss time range menu"
                          onClick={() => setRange(false)}
                        />
                        <div className="popover">
                          <small>
                            Through{" "}
                            {s.report.asof?.slice(0, 10) || "latest event"}
                          </small>
                          {[7, 14, 30, 90].map((n) => (
                            <button
                              key={n}
                              onClick={() => {
                                setRange(false);
                                void act(
                                  "Updating window",
                                  () => api.run(s, n),
                                  "Analysis window updated",
                                );
                              }}
                            >
                              Last {n} days{" "}
                              {n === s.report.days && <Check size={14} />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    className="btn primary"
                    disabled={!!busy}
                    onClick={() =>
                      void act(
                        "Running analysis",
                        () => api.run(s, s.report.days, s.ai),
                        "Analysis complete",
                      )
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Play size={13} fill="currentColor" />
                    )}
                    {busy || "Run analysis"}
                  </button>
                </div>
              )}
          </div>
          {tourRun &&
            page === "Intelligence studio" &&
            (!tourRun.result || !investigation.snapshot) && (
              <div className="tour-preparing" role="status">
                {tourRun.status === "failed" || tourRun.status === "interrupted"
                  ? "The run ended before the walkthrough was ready. Inspect its trace below."
                  : "Preparing the walkthrough from this investigation’s recorded events…"}{" "}
                <button onClick={() => setTourId("")}>Dismiss</button>
              </div>
            )}
          {err && (
            <section className="error" role="alert">
              <span>{err}</span>
              {!s && api.server && err.includes("access token") && (
                <form
                  className="auth"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    api.setAccessToken(
                      String(new FormData(f).get("token") || ""),
                    );
                    f.reset();
                    reload();
                  }}
                >
                  <input
                    autoComplete="off"
                    aria-label="Workspace access token"
                    name="token"
                    type="password"
                    required
                    placeholder="Workspace access token"
                  />
                  <button>Connect</button>
                </form>
              )}
              {!s && api.server && (
                <button onClick={api.useBrowserRuntime}>
                  Use browser workspace
                </button>
              )}
              <button onClick={() => (s ? setErr("") : reload())}>
                {s ? "Dismiss" : "Retry"}
              </button>
            </section>
          )}
          {!s && !err && (
            <div className="loading" role="status">
              <LoaderCircle className="spin" /> Loading workspace…
            </div>
          )}
          {s && (
            <motion.div
              key={page}
              initial={reduced ? false : { opacity: 0.4, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="page-content"
            >
              {page === "Overview" ? (
                <Overview
                  events={s.data.events}
                  sources={s.data.sources}
                  r={s.report}
                  navigate={target => {
                    if (target === "Business map") setMapMode("topology");
                    navigate(target);
                  }}
                  open={setDrawer}
                  openStudio={() => openStudio()}
                  selectSystem={(name) => {
                    setMapMode("topology");
                    setSystem(name);
                    navigate("Business map");
                  }}
                />
              ) : page === "Continuous intelligence" ? (
                <Continuous
                  s={s}
                  continuous={continuous}
                  selectedSignal={selectedSignal}
                  selectedSnapshot={selectedSnapshot}
                  onOpenStudio={openStudio}
                  onOpenMap={(id, snap) => {
                    setSelectedSignal(id);
                    setSelectedSnapshot(snap);
                    setMapMode("twin");
                    navigate("Business map");
                  }}
                />
              ) : page === "Intelligence studio" && selectedRun ? (
                <section>
                  <div
                    className="head-actions"
                    style={{ marginBottom: 16, flexWrap: "wrap" }}
                  >
                    <button
                      className="btn"
                      onClick={() =>
                        openMonitor(
                          selectedRun.signal_id,
                          selectedRun.snapshot_id,
                        )
                      }
                    >
                      View triggering signal
                    </button>
                    <button
                      className="btn"
                      onClick={() => setMonitorRun(undefined)}
                    >
                      Open refund investigation
                    </button>
                  </div>
                  <CheckpointTimeline run={selectedRun} s={s} />
                </section>
              ) : page === "Intelligence studio" ? (
                <Studio
                  snapshot={investigation.snapshot}
                  s={s}
                  run={investigation.run}
                  runs={investigation.runs}
                  busy={investigation.busy}
                  onStart={startInvestigation}
                  onDeterministic={() =>
                    void investigation.start("deterministic")
                  }
                  onRepeat={api.can(s,investigation.run?.mode==="live"?"models:run":"investigations:run") ? ()=>void investigation.repeat() : undefined}
                  onResume={() => void investigation.resume()}
                  onSelectRun={investigation.choose}
                  onApprove={(approach) => void investigation.approve(approach)}
                  onBlueprint={() => {
                    setBlueprintMode("dossier");
                    navigate("Technical blueprint");
                  }}
                />
              ) : page === "Business map" ? (
                <>

                  {mapMode === "topology" ? (
                    <MapView s={s} selected={system} select={setSystem} />
                  ) : (
                    <Twin
                      continuous={continuous}
                      selectedSignal={selectedSignal}
                      selectedSnapshot={selectedSnapshot}
                      onOpenContinuous={openMonitor}
                      onOpenInvestigation={openStudio}
                      s={s}
                      selected={system}
                      select={setSystem}
                      onProcess={(v) => {
                        setVariant(v);
                        navigate("Process explorer");
                      }}
                      onOpportunity={setDrawer}
                      onInvestigate={() => openStudio()}
                    />
                  )}
                </>
              ) : page === "Process explorer" ? (
                <Processes s={s} initialVariant={variant} />
              ) : page === "Opportunities" ? (
                <Opportunities recs={s.report.recommendations} open={setDrawer} />
              ) : page === "Technical blueprint" ? (
                <>
                  {investigation.run?.approval && (
                    <div
                      className="blueprint-switch"
                      aria-label="Blueprint view"
                    >
                      <button
                        aria-pressed={blueprintMode === "dossier"}
                        onClick={() => setBlueprintMode("dossier")}
                      >
                        Approved investigation
                      </button>
                      <button
                        aria-pressed={blueprintMode === "register"}
                        onClick={() => setBlueprintMode("register")}
                      >
                        Opportunity blueprints
                      </button>
                    </div>
                  )}
                  {blueprintMode === "dossier" &&
                  investigation.run?.approval ? (
                    <BlueprintDossier
                      s={investigation.snapshot || s}
                      run={investigation.run}
                    />
                  ) : (
                    <Blueprint s={s} id={bp} pick={setBp} open={setDrawer} />
                  )}
                </>
              ) : page === "Agent activity" ? (
                <Agents s={s} />
              ) : (
                <Sources
                  s={s}
                  busy={!!busy}
                  upload={(f) =>
                    void act(
                      "Importing source",
                      () => api.ingest(s, f),
                      "Source processed",
                    )
                  }
                  sync={() =>
                    act(
                      "Syncing deals",
                      () => api.syncHubSpot(s),
                      "HubSpot sync checkpoint saved",
                    )
                  }
                />
              )}
            </motion.div>
          )}
          {s && (
            <footer className="page-foot">
              <div>
                <FlaskConical size={13} />
                {datasetLabel}
                <i> / </i>
                {s.report.engine === "Deterministic"
                  ? (api.server ? "Deterministic analysis" : "Deterministic demo")
                  : "OpenAI Agents SDK"}
              </div>
              <span>
                MONOLITH <i>/</i> v1.0
              </span>
            </footer>
          )}
        </div>
      </main>
      <Dock page={page} navigate={navigate} />
      {page === "Intelligence studio" &&
        tourRun?.result &&
        investigation.snapshot && (
          <GuidedDemo
            s={investigation.snapshot}
            run={tourRun}
            onClose={() => setTourId("")}
          />
        )}
      {drawer && s && (
        <Detail
          key={drawer.id}
          r={drawer}
          s={s}
          close={() => setDrawer(null)}
          busy={!!busy}
          approve={(dec) =>
            void act(
              "Saving decision",
              () => api.review(s, drawer.id, dec),
              "Review decision recorded",
            )
          }
          investigate={startInvestigation}
          blueprint={() => {
            setBlueprintMode("register");
            setBp(drawer.id);
            navigate("Technical blueprint");
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {search && (
        <div
          className="overlay search-layer"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearch(false);
          }}
        >
          <section
            className="command"
            role="dialog"
            aria-label="Search workspace"
            aria-modal="true"
          >
            <div className="command-input">
              <Search size={20} aria-hidden="true" />
              <input
                aria-label="Search views and opportunities"
                placeholder="Search views and opportunities…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="icon-btn"
                aria-label="Close search"
                onClick={() => setSearch(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="command-results">
              {menu
                .filter((m) =>
                  m.page.toLowerCase().includes(query.toLowerCase()),
                )
                .map((m) => (
                  <button key={m.page} onClick={() => navigate(m.page)}>
                    <m.icon size={15} />
                    {m.page}
                    <small>View</small>
                  </button>
                ))}
              {s?.report.recommendations
                .filter((r) =>
                  r.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setSearch(false);
                      setDrawer(r);
                    }}
                  >
                    <Focus size={15} />
                    {r.title}
                    <small>Opportunity</small>
                  </button>
                ))}
              {!menu.some((m) =>
                m.page.toLowerCase().includes(query.toLowerCase()),
              ) &&
                !s?.report.recommendations.some((r) =>
                  r.title.toLowerCase().includes(query.toLowerCase()),
                ) && (
                  <p className="empty" role="status">No matching views or opportunities.</p>
                )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
