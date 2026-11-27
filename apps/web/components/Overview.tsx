import {
  Activity,
  ArrowUpRight,
  ArrowRight,
  AudioLines,
  ChevronRight,
  Clock3,
  Crosshair,
  Ellipsis,
  Expand,
  Focus,
  GitFork,
  LayoutGrid,
  Layers3,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./Overview.module.css";
import work from "./WorkAreas.module.css";
import { type EventRow, type Page, type Rec, type Report, type Source } from "../lib/types";
import { number, RecGlyph, Spark, Tag } from "./UI";
import { paintAtmosphere } from "./overview/atmosphere";
import { paintFocusStream } from "./overview/focusStream";
import { buildFieldEvidence, linkId, systemsForEvidence } from "./overview/fieldEvidence";

export const Topology = dynamic(() => import("./Topology"), {
  ssr: false,
  loading: () => (
    <div className="map-load" role="status">
      Rendering business map…
    </div>
  ),
});
const OperationalField = dynamic(() => import("./overview/OperationalField"), {
  ssr: false,
  loading: () => (
    <div className={styles.fieldLoading} role="status">
      Rendering operational field…
    </div>
  ),
});

export function Register({
  recs,
  open,
  variant,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
  variant?: "overview";
}) {
  const [filter, setFilter] = useState("All signals");
  const filtered = recs.filter(
    (r) =>
      filter === "All signals" ||
      (filter === "Automation"
        ? r.kind !== "Human-led"
        : r.kind === "Human-led"),
  );
  const overview = variant === "overview";
  return (
    <section
      className={`panel register ${styles.register} ${work.register} ${overview ? styles.registerOverview : ""}`}
      aria-labelledby={overview ? "opportunity-register-title" : undefined}
    >
      <div className="panel-head">
        <div className={overview ? styles.registerTitle : undefined}>
          {overview && <LayoutGrid size={18} strokeWidth={1.6} aria-hidden="true" />}
          <h2 id={overview ? "opportunity-register-title" : undefined}>Opportunity register</h2>
        </div>
        <label className="select-wrap">
          <SlidersHorizontal size={14} />
          <select
            aria-label="Filter opportunities"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["All signals", "Automation", "Human-led"].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Opportunity</th>
              <th>Disposition</th>
              <th>Suitability</th>
              <th>Cases</th>
              <th>Median interval</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <button className="table-title" onClick={() => open(r)}>
                    <RecGlyph r={r} />
                    <span>
                      <strong>{r.title}</strong>
                      <small>{r.area}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <Tag
                    color={
                      r.kind === "Automate"
                        ? "lime"
                        : r.kind === "Assist"
                          ? "blue"
                          : "orange"
                    }
                  >
                    {r.kind}
                  </Tag>
                </td>
                <td>
                  <div className="score">
                    <i>
                      <b style={{ width: r.score + "%" }} />
                    </i>
                    {r.score}
                    <em>/100</em>
                  </div>
                </td>
                <td className="mono">{number(r.cases)}</td>
                <td className={work.intervalValue}>{r.hours}h</td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={"Inspect " + r.title}
                    onClick={() => open(r)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="empty">No opportunities match this filter.</p>
        )}
      </div>
    </section>
  );
}

function describeSignal(rec: Rec) {
  switch (rec.id) {
    case "refund":
      return {
        label: "Bottleneck",
        title: "Refund approval delays",
        measure: rec.hours + "h median approval interval",
        tone: "copper",
      };
    case "entry":
      return {
        label: "Repeated work",
        title: "Duplicate data entry",
        measure: rec.cases + " cases with manual re-entry",
        tone: "ice",
      };
    case "review":
      return {
        label: "Human boundary",
        title: "Dispute review boundary",
        measure: rec.cases + " cases with human review",
        tone: "violet",
      };
    default:
      return {
        label: rec.kind === "Human-led" ? "Human boundary" : "Opportunity",
        title: rec.title,
        measure: rec.cases + " matched cases",
        tone: "mint",
      };
  }
}

/** The finding card's particles flow rather than merely shimmering in place. */
function FocusStream() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      paintFocusStream(el, reduced ? 0 : (now - started) / 1000);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame(started);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className={styles.focusFilament} aria-hidden="true" />;
}

/** Page-level atmosphere for Overview only, mounted behind the shell:
    ribbons of fine light behind the header and along the bottom edge. */
export function OverviewBackdrop({ variant = "overview", paused = false }: { variant?: "overview" | "map" | "process" | "studio"; paused?: boolean }) {
  const top = useRef<HTMLCanvasElement>(null);
  const bottom = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    const frame = (now: number) => {
      elapsed += Math.min(0.06, Math.max(0, now - last) / 1000);
      last = now;
      if (top.current) paintAtmosphere(top.current, "top", elapsed);
      if (bottom.current) paintAtmosphere(bottom.current, "bottom", elapsed);
      if (!paused && !preference.matches && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (!document.hidden) frame(last);
    };
    sync();
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(raf);
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", sync);
    };
  }, [paused]);
  return (
    <div className={styles.backdrop} data-atmosphere={variant} aria-hidden="true">
      <canvas ref={top} className={styles.aurora} />
      <canvas ref={bottom} className={styles.auroraLow} />
    </div>
  );
}

export function Overview({
  r,
  events = [],
  sources = [],
  navigate,
  open,
  selectSystem,
  openStudio,
}: {
  r: Report;
  events?: EventRow[];
  sources?: Source[];
  navigate: (p: Page) => void;
  open: (r: Rec) => void;
  selectSystem: (s: string) => void;
  openStudio: () => void;
}) {
  const metrics = [
    {
      name: "Observed events",
      value: number(r.events),
      note: number(r.cases) + " linked cases",
      color: "#75e3c2",
      icon: Layers3,
    },
    {
      name: "Process variants",
      value: number(r.variants),
      note: "Distinct paths",
      color: "#c8b5f4",
      icon: GitFork,
    },
    {
      name: "Opportunities",
      value: number(r.auto),
      note: "Automation candidates",
      color: "#f0b27e",
      icon: Crosshair,
    },
    {
      name: "Median cycle time",
      value: r.cases ? number(r.cycle) : "—",
      unit: r.cases ? "h" : undefined,
      note: "First to last event",
      color: "#87d2ea",
      icon: Clock3,
    },
  ];
  const feed = useMemo(
    () =>
      [
        ...["refund", "entry", "review"].flatMap((id) =>
          r.recommendations.filter((rec) => rec.id === id),
        ),
        ...r.recommendations.filter(
          (rec) => !["refund", "entry", "review"].includes(rec.id),
        ),
      ].slice(0, 3),
    [r.recommendations],
  );
  const busiest = r.links.reduce<(typeof r.links)[number] | undefined>(
    (top, route) => (!top || route.count > top.count ? route : top),
    undefined,
  );

  // The feed has one featured finding; choosing another moves it into focus
  // and lights the systems its evidence was recorded in.
  const [featuredId, setFeaturedId] = useState<string>();
  const [chosen, setChosen] = useState(false);
  const primary = feed.find((rec) => rec.id === featuredId) || feed[0];
  const first = primary && describeSignal(primary);
  const others = feed.filter((rec) => rec !== primary);

  const evidence = useMemo(
    () => buildFieldEvidence(r, events, sources),
    [r, events, sources],
  );
  const emphasis = useMemo(
    () => (chosen && primary ? systemsForEvidence(primary.evidence, events) : new Set<string>()),
    [chosen, primary, events],
  );
  const links = useMemo(
    () => r.links.map((link) => ({ ...link, id: linkId(link.source, link.target) })),
    [r.links],
  );
  const legacySystems = useMemo(
    () =>
      r.systems.map((system) =>
        evidence.pressure.has(system.name) ? { ...system, tone: "pressure" as const } : system,
      ),
    [r.systems, evidence.pressure],
  );

  const [webgl, setWebgl] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [menu, setMenu] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);

  return (
    <div className={styles.overview}>
      <section className={styles.field} aria-labelledby="operational-field-title">
        <header className={styles.fieldHeader}>
          <div className={styles.fieldTitle}>
            <span className={styles.fieldIcon} aria-hidden="true">
              <Orbit size={19} strokeWidth={1.5} />
            </span>
            <div>
              <h2 id="operational-field-title">Operational field</h2>
              <p>
                {number(r.systems.length)} systems <span aria-hidden="true">/</span>{" "}
                {number(r.links.length)} directed links
              </p>
            </div>
          </div>
          <div className={styles.fieldTools}>
            <button
              className={styles.tool}
              onClick={() => navigate("Business map")}
              aria-label="Expand business map"
              title="Expand business map"
            >
              <Expand size={15} aria-hidden="true" />
            </button>
            <div className={styles.menuWrap}>
              <button
                className={styles.tool}
                aria-label="Field options"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
              >
                <Ellipsis size={16} aria-hidden="true" />
              </button>
              {menu && (
                <>
                  <button className="menu-dismiss" aria-label="Close field options" onClick={() => setMenu(false)} />
                  <div className={styles.menu} role="menu">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setPlaying((v) => !v);
                        setMenu(false);
                      }}
                    >
                      {playing ? <Pause size={14} /> : <Play size={14} />}
                      {playing ? "Pause motion" : "Resume motion"}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setResetKey((k) => k + 1);
                        setChosen(false);
                        setFeaturedId(undefined);
                        setMenu(false);
                      }}
                    >
                      <RotateCcw size={14} /> Clear selection
                    </button>
                    <button role="menuitem" onClick={() => navigate("Business map")}>
                      <ArrowUpRight size={14} /> Open business map
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <div className={styles.surface}>
          {webgl ? (
            <OperationalField
              evidence={evidence}
              systems={r.systems}
              links={links}
              emphasis={emphasis}
              playing={playing}
              resetKey={resetKey}
              onOpenSystem={selectSystem}
              onUnavailable={() => setWebgl(false)}
            />
          ) : (
            <Topology
              systems={legacySystems}
              links={links}
              onSelect={selectSystem}
              onSelectLink={(id) => {
                const route = links.find((link) => link.id === id);
                if (route) selectSystem(route.target);
              }}
            />
          )}
        </div>
        <footer className={styles.fieldFoot}>
          <div className={styles.legend} role="group" aria-label="Field legend">
            <span>
              <i className={styles.nodeKey} /> System volume
            </span>
            <span>
              <i className={styles.flowKey} /> Handoffs
            </span>
            {evidence.pressure.size > 0 && (
              <span>
                <i className={styles.pressureKey} /> Bottleneck
              </span>
            )}
          </div>
          <span className={styles.hint}>Select a system or route to see its evidence</span>
          <button className={styles.mapLink} onClick={() => navigate("Business map")}>
            Explore map <ArrowUpRight size={14} />
          </button>
        </footer>
      </section>

      <section className={styles.brief} aria-labelledby="intelligence-feed-title">
        <header className={styles.briefHeader}>
          <AudioLines size={18} strokeWidth={1.6} aria-hidden="true" />
          <h2 id="intelligence-feed-title">Intelligence feed</h2>
          {feed.length > 0 && (
            <span className={styles.count}>
              <i aria-hidden="true" />
              {feed.length} findings
            </span>
          )}
        </header>
        {primary && first ? (
          <>
            <div className={styles.focus} data-tone={first.tone} key={primary.id}>
              <FocusStream />
              <div className={styles.kind}>
                <span />
                {first.label}
              </div>
              <button
                className={styles.focusTitle}
                onClick={() => open(primary)}
                aria-label={`${first.label.toUpperCase()} ${first.title} ${first.measure}`}
              >
                {first.title}
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
              <div className={styles.focusValue}>
                <strong>
                  {number(primary.id === "refund" ? primary.hours : primary.cases)}
                  {primary.id === "refund" && <small>h</small>}
                </strong>
                <span>
                  {primary.id === "refund"
                    ? `median interval across ${number(primary.cases)} refund cases`
                    : "matched cases"}
                </span>
              </div>
              {primary.id === "refund" ? (
                <button className={styles.investigate} onClick={openStudio}>
                  Open investigation <ArrowRight size={14} />
                </button>
              ) : (
                <button className={styles.investigate} onClick={() => open(primary)}>
                  Inspect evidence <ArrowRight size={14} />
                </button>
              )}
            </div>
            {others.length > 0 && (
              <div className={styles.findings}>
                {others.map((rec) => {
                  const sig = describeSignal(rec);
                  return (
                    <div className={styles.finding} data-tone={sig.tone} key={rec.id}>
                      <button
                        className={styles.findingMain}
                        onClick={() => {
                          setFeaturedId(rec.id);
                          setChosen(true);
                        }}
                        aria-label={`Focus ${sig.label} finding: ${sig.title}, ${sig.measure}`}
                      >
                        <span className={styles.findingGlyph}>
                          <RecGlyph r={rec} />
                        </span>
                        <span>
                          <strong>{sig.title}</strong>
                          <small>{sig.measure}</small>
                        </span>
                      </button>
                      <button
                        className={styles.findingOpen}
                        onClick={() => open(rec)}
                        aria-label={`Inspect ${sig.title}`}
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className={styles.empty}>
            <Focus size={22} />
            <p>No evidence-supported opportunities in this reporting window.</p>
          </div>
        )}
        <div className={styles.briefFoot}>
          {busiest && (
            <button
              className={styles.handoff}
              onClick={() => selectSystem(busiest.target)}
              aria-label={`Inspect ${busiest.target} in business map. Highest-volume handoff: ${busiest.source} to ${busiest.target}, ${number(busiest.count)} handoffs`}
            >
              <span>
                <small>Highest-volume handoff</small>
                <strong>
                  <span title={busiest.source}>{busiest.source}</span>
                  <ArrowRight size={13} aria-hidden="true" />
                  <span title={busiest.target}>{busiest.target}</span>
                </strong>
              </span>
              <span className={styles.handoffCount}>
                {number(busiest.count)} <ArrowUpRight size={13} />
              </span>
            </button>
          )}
          <button className={styles.trace} onClick={() => navigate("Agent activity")}>
            <Activity size={14} />
            View analysis trace <ChevronRight size={14} />
          </button>
        </div>
      </section>

      <section className={styles.metrics} aria-label="Operational metrics" data-playing={playing}>
        {metrics.map((m, i) => (
          <div
            className={styles.metric}
            key={m.name}
            style={{ "--metric-color": m.color } as CSSProperties}
          >
            <span className={styles.metricIcon} aria-hidden="true">
              <m.icon size={18} strokeWidth={1.5} />
            </span>
            <div className={styles.metricBody}>
              <span className={styles.metricName}>{m.name}</span>
              <strong className={styles.metricValue}>
                {m.value}
                {m.unit && <em>{m.unit}</em>}
              </strong>
              <span className={styles.metricNote}>{m.note}</span>
            </div>
            {r.cases > 0 && r.series[i]?.length > 1 && (
              <Spark values={r.series[i]} color={m.color} id={"spark" + i} metric={m.name} />
            )}
          </div>
        ))}
      </section>

      <div className={styles.registerRow}>
        <Register recs={r.recommendations} open={open} variant="overview" />
      </div>
    </div>
  );
}
