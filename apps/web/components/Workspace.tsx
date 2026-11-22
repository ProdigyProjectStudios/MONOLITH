"use client";
import { Check, Clapperboard, FlaskConical, LoaderCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/client";
import { type Page, pages, type Rec, type State } from "../lib/types";
import { Detail } from "./Detail";
import { Overview } from "./Overview";
import WorkspaceSearch from "./WorkspaceSearch";
import WorkspaceNavigation from "./WorkspaceNavigation";
import AnalysisControls from "./AnalysisControls";
import { useInvestigation } from "../lib/useInvestigation";
import Continuous from "./Continuous";
import { CheckpointTimeline } from "./ContinuousTimeline";
import { useContinuous } from "../lib/useContinuous";
import Studio from "./Studio";
import GuidedDemo from "./GuidedDemo";
import LiveRunArchive from "./LiveRunArchive";
import Twin from "./Twin";
import BlueprintDossier from "./BlueprintDossier";
import {
  Agents,
  Blueprint,
  MapView,
  Opportunities,
  Processes,
  Sources,
} from "./Workspaces";
const copy: Record<Page, [string, string]> = {
  Overview: [
    "Operational field",
    "Inspect the systems and source events behind a measured delay.",
  ],
  "Business map": [
    "Business map",
    "Follow a handoff between systems to the records that connect them.",
  ],
  "Process explorer": [
    "Process explorer",
    "Trace a case through its activities and see where time accumulated.",
  ],
  Opportunities: [
    "Automation opportunities",
    "Compare the reach, delay and evidence behind each proposed change.",
  ],
  "Technical blueprint": [
    "Technical blueprint",
    "Review the proposed change, the rollout and the decision it requires.",
  ],
  "Intelligence studio": [
    "Agent Intelligence Studio",
    "Follow a question through evidence, verification and a design decision.",
  ],
  "Continuous intelligence": [
    "Continuous intelligence",
    "Compare observation periods and inspect the evidence behind a change.",
  ],
  "Agent activity": [
    "Agent activity",
    "Inspect specialist executions and the decisions recorded in this workspace.",
  ],
  "Data sources": [
    "Data sources",
    "Connect a system, import evidence or check the records already here.",
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
    [navOpen, setNavOpen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [system, setSystem] = useState(""),
    [bp, setBp] = useState(""),
    [variant, setVariant] = useState(0),
    [mapMode, setMapMode] = useState<"twin" | "topology">("twin"),
    [blueprintMode, setBlueprintMode] = useState<"register" | "dossier">(
      "dossier",
    ),
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
      setNavOpen(false);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, [reload]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (
          document.querySelector('dialog[open], [role="dialog"]:not(.command)')
        )
          return;
        e.preventDefault();
        setSearch((v) => !v);
      }
      if (e.key === "Escape") {
        setSearch(false);
        setDrawer(null);
        setNavOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!search && !drawer && !navOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      search ? ".command" : drawer ? ".drawer" : ".sidebar.mobile-open",
    );
    if (!dialog) return;
    const background = [
      document.querySelector("main"),
      document.getElementById("workspace-masthead"),
    ];
    const controls = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
        ),
      ).filter((el) => el.checkVisibility({ visibilityProperty: true }));
    const initial = navOpen
      ? dialog.querySelector<HTMLElement>('[aria-current="page"]')
      : undefined;
    (initial || controls()[0])?.focus();
    for (const region of background) if (region) region.inert = true;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = controls();
      const outside = !dialog.contains(document.activeElement);
      if (
        outside ||
        (event.shiftKey
          ? document.activeElement === list[0]
          : document.activeElement === list.at(-1))
      ) {
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
      for (const region of background) if (region) region.inert = false;
      if (previous?.isConnected && previous.checkVisibility())
        previous.focus({ preventScroll: true });
    };
  }, [search, drawer, navOpen]);
  useEffect(() => {
    if (!notice) return;
    const to = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(to);
  }, [notice]);
  const navigate = (p: Page) => {
    setTourId("");
    setPage(p);
    const hash = "#" + p.toLowerCase().replaceAll(" ", "-");
    if (location.hash !== hash) location.hash = hash;
    setNavOpen(false);
    setSearch(false);
    setDrawer(null);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() =>
      document
        .getElementById("workspace-heading")
        ?.focus({ preventScroll: true }),
    );
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
    if (api.can(s, "investigations:run")) void investigation.start();
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
    setSearch(true);
    setDrawer(null);
  };
  const org = !s
    ? "Workspace"
    : s.tenant === "northstar"
      ? "Northstar Commerce"
      : s.tenant;
  const sources = s?.data.sources ?? [];
  const datasetLabel = !sources.length
    ? "No sources"
    : sources.every((source) => source.synthetic)
      ? "Synthetic data"
      : sources.some((source) => source.synthetic)
        ? "Mixed sources"
        : "Imported data";
  const analysisControls = s && (
    <AnalysisControls
      report={s.report}
      busy={busy}
      changeWindow={(days) =>
        void act(
          "Updating window",
          () => api.run(s, days),
          "Analysis window updated",
        )
      }
      run={() =>
        void act(
          "Running analysis",
          () => api.run(s, s.report.days, s.ai),
          "Analysis complete",
        )
      }
    />
  );
  return (
    <div className="shell" data-expanded={expanded} data-workspace={page}>
      <a
        className="skip-link"
        href="#workspace-heading"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("workspace-heading")?.focus();
        }}
      >
        Skip to workspace
      </a>
      <WorkspaceNavigation
        page={page}
        state={s}
        org={org}
        datasetLabel={datasetLabel}
        runtimeLabel={
          api.server
            ? "Connected"
            : datasetLabel === "Synthetic data"
              ? "Demo"
              : "Local"
        }
        opened={navOpen}
        focused={expanded}
        onToggle={setNavOpen}
        onSearch={openSearch}
        onNavigate={navigate}
        onFocus={setExpanded}
        controls={page === "Overview" && analysisControls}
      />
      <main>
        <div className="content">
          {(!s || page !== "Overview") && (
            <div className="screenhead">
              <div>
                <div className="heading-row">
                  <h1 id="workspace-heading" tabIndex={-1}>
                    {copy[page][0]}
                  </h1>
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
                <p>{copy[page][1]}</p>
              </div>
              {s && page === "Intelligence studio" && !selectedRun && (
                <div className="head-actions" style={{ flexWrap: "wrap" }}>
                  <LiveRunArchive key={s.tenant} tenant={s.tenant} />
                  <button
                    className="btn tour-launch"
                    onClick={() => void openTour()}
                    disabled={
                      investigation.busy ||
                      (!investigation.run &&
                        !api.can(s, "investigations:run")) ||
                      (!investigation.run &&
                        !s.report.recommendations.some(
                          (r) => r.id === "refund",
                        ))
                    }
                  >
                    <Clapperboard size={15} />
                    90-second walkthrough
                  </button>
                </div>
              )}
              {page !== "Intelligence studio" &&
                page !== "Continuous intelligence" &&
                analysisControls}
            </div>
          )}
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
              initial={reduced ? false : { opacity: 0.75, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.7, 0.25, 1] }}
              className="page-content"
            >
              {page === "Overview" ? (
                <Overview
                  events={s.data.events}
                  sources={s.data.sources}
                  r={s.report}
                  navigate={(target) => {
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
                  onRepeat={
                    api.can(
                      s,
                      investigation.run?.mode === "live"
                        ? "models:run"
                        : "investigations:run",
                    )
                      ? () => void investigation.repeat()
                      : undefined
                  }
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
                <Opportunities
                  recs={s.report.recommendations}
                  open={setDrawer}
                />
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
                  ? api.server
                    ? "Deterministic analysis"
                    : "Deterministic demo"
                  : s.report.engine}
              </div>
              <span>
                {s.report.asof && (
                  <>
                    Evidence through{" "}
                    <time dateTime={s.report.asof}>
                      {s.report.asof.slice(0, 10)}
                    </time>
                  </>
                )}
              </span>
            </footer>
          )}
        </div>
      </main>
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
        <WorkspaceSearch
          recs={s?.report.recommendations ?? []}
          navigate={navigate}
          close={() => setSearch(false)}
          inspect={(rec) => {
            setSearch(false);
            setDrawer(rec);
          }}
        />
      )}
    </div>
  );
}
