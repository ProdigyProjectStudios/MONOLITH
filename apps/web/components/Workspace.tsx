"use client";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  FlaskConical,
  Focus,
  Layers3,
  LoaderCircle,
  Menu,
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
import { Overview, Register } from "./Overview";
import { Mark, menu } from "./UI";
import { useInvestigation } from "../lib/useInvestigation";
import Studio from "./Studio";
import GuidedDemo from "./GuidedDemo";
import LiveRunArchive from "./LiveRunArchive";
import Twin from "./Twin";
import BlueprintDossier from "./BlueprintDossier";
import { Agents, Blueprint, MapView, Processes, Sources } from "./Workspaces";
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
    [mobile, setMobile] = useState(false),
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
      setMobile(false);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, [reload]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
        setQuery("");
      }
      if (e.key === "Escape") {
        setSearch(false);
        setDrawer(null);
        setMobile(false);
        setRange(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!search && !drawer) return;
    const prev = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "input,button:not(:disabled),summary,select,a[href]",
        ) || [],
      );
    focusables()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0]?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = prior;
      prev?.focus();
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
    setMobile(false);
    setSearch(false);
    setDrawer(null);
    setRange(false);
    window.scrollTo({ top: 0 });
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
    void investigation.start();
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
    <div className="shell">
      {mobile && (
        <button
          aria-label="Close navigation"
          className="navshade"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <button
          className="brand"
          aria-label="MONOLITH overview"
          onClick={() => navigate("Overview")}
        >
          <Mark />
          <b>MONOLITH</b>
        </button>
        <div className="workspace-id">
          <span className="workspace-icon">
            <Compass size={21} />
          </span>
          <div>
            <strong>{org}</strong>
            <small>Intelligence workspace</small>
          </div>
        </div>
        <div className="nav-group">
          <h3>WORKSPACE</h3>
          {menu.slice(0, 6).map((m) => (
            <button
              key={m.page}
              className={"navitem " + (page === m.page ? "active" : "")}
              aria-current={page === m.page ? "page" : undefined}
              onClick={() => navigate(m.page)}
            >
              <m.icon size={17} />
              {m.page}
              {m.page === "Opportunities" && s && (
                <small>{s.report.recommendations.length}</small>
              )}
            </button>
          ))}
        </div>
        <div className="nav-group">
          <h3>SYSTEM</h3>
          {menu.slice(6).map((m) => (
            <button
              key={m.page}
              className={"navitem " + (page === m.page ? "active" : "")}
              onClick={() => navigate(m.page)}
            >
              <m.icon size={17} />
              {m.page}
            </button>
          ))}
        </div>
        <div className="side-bottom">
          <div className="engine">
            <i className="legend-dot" />
            <span>Analysis engine</span>
            <small>
              {s?.report.engine === "OpenAI Agents SDK" ? "SDK" : "LOCAL"}
            </small>
          </div>
          <div className="persona">
            <div className="avatar">
              {org === "Northstar Commerce"
                ? "NC"
                : org.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{org}</strong>
              <small>{datasetLabel}</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="crumb">
            <button
              className="icon-btn mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={19} />
            </button>
            <Layers3 size={15} />
            <span>Workspace</span>
            <i>/</i>
            <b>{page}</b>
          </div>
          <div className="top-actions">
            {s && (
              <span className="dataset-badge">
                <FlaskConical size={12} />
                {datasetLabel}
              </span>
            )}
            <button className="searchbtn" onClick={openSearch}>
              <Search size={14} />
              <span>Search workspace</span>
              <kbd>⌘ K</kbd>
            </button>
          </div>
        </header>
        <div className="content">
          <div className="screenhead">
            <div>
              <div className="eyebrow">
                <i />
                {page === "Overview"
                  ? "EXECUTIVE COCKPIT"
                  : page === "Data sources" || page === "Agent activity"
                    ? "SYSTEM WORKSPACE"
                    : "INTELLIGENCE WORKSPACE"}
              </div>
              <h1>{copy[page][0]}</h1>
              <p>{copy[page][1]}</p>
            </div>
            {s && page === "Intelligence studio" && (
              <div className="head-actions" style={{ flexWrap: "wrap" }}>
                <LiveRunArchive key={s.tenant} tenant={s.tenant} />
                <button
                  className="btn tour-launch"
                  onClick={() => void openTour()}
                  disabled={
                    investigation.busy ||
                    (!investigation.run &&
                      !s.report.recommendations.some((r) => r.id === "refund"))
                  }
                >
                  <Clapperboard size={15} />
                  90-second walkthrough
                </button>
              </div>
            )}
            {s && page !== "Intelligence studio" && (
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
            <div className="loading">
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
                  r={s.report}
                  navigate={navigate}
                  open={setDrawer}
                  openStudio={() => navigate("Intelligence studio")}
                  selectSystem={(name) => {
                    setSystem(name);
                    navigate("Business map");
                  }}
                />
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
                  onRepeat={() => void investigation.repeat()}
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
                  {mapMode === "topology" ? (
                    <MapView s={s} selected={system} select={setSystem} />
                  ) : (
                    <Twin
                      s={s}
                      selected={system}
                      select={setSystem}
                      onProcess={(v) => {
                        setVariant(v);
                        navigate("Process explorer");
                      }}
                      onOpportunity={setDrawer}
                      onInvestigate={() => navigate("Intelligence studio")}
                    />
                  )}
                </>
              ) : page === "Process explorer" ? (
                <Processes s={s} initialVariant={variant} />
              ) : page === "Opportunities" ? (
                <Register recs={s.report.recommendations} open={setDrawer} />
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
                  ? "Deterministic demo"
                  : "OpenAI Agents SDK"}
              </div>
              <span>
                MONOLITH <i>/</i> v1.0
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
            <label>
              <Search size={20} />
              <input
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
            </label>
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
                  <p className="empty">No matching views or opportunities.</p>
                )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
