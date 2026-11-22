import {
  Activity,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  Focus,
  Expand,
  AudioLines,
  SlidersHorizontal,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState, type CSSProperties } from "react";
import styles from "./Overview.module.css";
import work from "./WorkAreas.module.css";
import { type EventRow, type Page, type Rec, type Report } from "../lib/types";
import { number, RecGlyph, Spark, Tag } from "./UI";
export const Topology = dynamic(() => import("./Topology"), {
  ssr: false,
  loading: () => (
    <div className="map-load" role="status">
      Rendering business map…
    </div>
  ),
});
export function Register({
  recs,
  open,
}: {
  recs: Rec[];
  open: (r: Rec) => void;
}) {
  const [filter, setFilter] = useState("All signals");
  const filtered = recs.filter(
    (r) =>
      filter === "All signals" ||
      (filter === "Automation"
        ? r.kind !== "Human-led"
        : r.kind === "Human-led"),
  );
  return (
    <section className={`panel register ${styles.register} ${work.register}`}>
      <div className="panel-head">
        <div>
          <h2>Opportunity register</h2>
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

export function Overview({
  r,
  events,
  navigate,
  open,
  selectSystem,
  openStudio,
}: {
  r: Report;
  events?: EventRow[];
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
      color: "#75d8ba",
    },
    {
      name: "Process variants",
      value: number(r.variants),
      note: "Distinct paths",
      color: "#c8b5f4",
    },
    {
      name: "Opportunities",
      value: number(r.auto),
      note: "Automation candidates",
      color: "#dca37e",
    },
    {
      name: "Median cycle time",
      value: r.cases ? number(r.cycle) : "—",
      unit: r.cases ? "h" : undefined,
      note: "First to last event",
      color: "#87c9df",
    },
  ];
  const feed = [
    ...["refund", "entry", "review"].flatMap((id) =>
      r.recommendations.filter((rec) => rec.id === id),
    ),
    ...r.recommendations.filter(
      (rec) => !["refund", "entry", "review"].includes(rec.id),
    ),
  ].slice(0, 3);
  const busiest = r.links.reduce<(typeof r.links)[number] | undefined>(
    (top, route) => (!top || route.count > top.count ? route : top),
    undefined,
  );
  const primary = feed[0];
  const first = primary && describeSignal(primary);
  const pressure = useMemo(() => {
    const cited = new Set(r.bottlenecks[0]?.evidence || []);
    const systems = new Set<string>();
    if (events && cited.size) {
      for (const row of events) {
        if (cited.has(row.id)) systems.add(row.system);
      }
    }
    return systems;
  }, [r.bottlenecks, events]);
  const systems = useMemo(
    () =>
      r.systems.map((system) =>
        pressure.has(system.name)
          ? { ...system, tone: "pressure" as const }
          : system,
      ),
    [r.systems, pressure],
  );
  const links = useMemo(
    () =>
      r.links.map((link) => ({
        ...link,
        id: JSON.stringify([link.source, link.target]),
      })),
    [r.links],
  );

  return (
    <>
      <div className={styles.overview}>
        <section className={styles.field} aria-label="Operational map">
          <header className={styles.fieldHeader}>
            <div>
              <h2>Operational field</h2>
              <p>
                {number(r.systems.length)} systems{" "}
                <span aria-hidden="true">/</span> {number(r.links.length)}{" "}
                directed links
              </p>
            </div>
            <button
              className={styles.expand}
              onClick={() => navigate("Business map")}
              aria-label="Expand business map"
              title="Expand business map"
            >
              <Expand size={16} aria-hidden="true" />
            </button>
          </header>
          <div className={styles.surface}>
            <Topology
              systems={systems}
              links={links}
              onSelect={selectSystem}
              onSelectLink={(id) => {
                const route = links.find((link) => link.id === id);
                if (route) selectSystem(route.target);
              }}
            />
          </div>
          <footer className={styles.fieldFoot}>
            <div className={styles.legend} role="group" aria-label="Map legend">
              <span>
                <i className={styles.nodeKey} /> System volume
              </span>
              <span>
                <i className={styles.flowKey} /> Handoffs
              </span>
              {pressure.size > 0 && (
                <span>
                  <i className={styles.pressureKey} /> Bottleneck
                </span>
              )}
            </div>
            <button
              className={styles.mapLink}
              onClick={() => navigate("Business map")}
            >
              Explore map <ArrowUpRight size={14} />
            </button>
          </footer>
        </section>

        <section
          className={styles.brief}
          aria-labelledby="intelligence-feed-title"
        >
          <header className={styles.briefHeader}>
            <AudioLines size={18} strokeWidth={1.6} aria-hidden="true" />
            <h2 id="intelligence-feed-title">Intelligence feed</h2>
          </header>
          {primary && first ? (
            <>
              <div className={styles.focus} data-tone={first.tone}>
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
                    {number(
                      primary.id === "refund" ? primary.hours : primary.cases,
                    )}
                    {primary.id === "refund" && <small>h</small>}
                  </strong>
                  <span>
                    {primary.id === "refund"
                      ? `median interval across ${number(primary.cases)} refund cases`
                      : "matched cases"}
                  </span>
                </div>
                {primary.id === "refund" && (
                  <button className={styles.investigate} onClick={openStudio}>
                    Open investigation <ArrowRight size={14} />
                  </button>
                )}
              </div>
              {feed.length > 1 && (
                <div className={styles.findings}>
                  {feed.slice(1).map((rec) => {
                    const sig = describeSignal(rec);
                    return (
                      <button
                        key={rec.id}
                        className={styles.finding}
                        data-tone={sig.tone}
                        onClick={() => open(rec)}
                        aria-label={`${sig.label.toUpperCase()} ${sig.title} ${sig.measure}`}
                      >
                        <span className={styles.findingGlyph}>
                          <RecGlyph r={rec} />
                        </span>
                        <span>
                          <strong>{sig.title}</strong>
                          <small>{sig.measure}</small>
                        </span>
                        <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className={styles.empty}>
              <Focus size={22} />
              <p>
                No evidence-supported opportunities in this reporting window.
              </p>
            </div>
          )}
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
          <button
            className={styles.trace}
            onClick={() => navigate("Agent activity")}
          >
            <Activity size={15} />
            View analysis trace <ChevronRight size={14} />
          </button>
        </section>

        <section className={styles.metrics} aria-label="Operational metrics">
          {metrics.map((m, i) => (
            <div
              className={styles.metric}
              key={m.name}
              style={{ "--metric-color": m.color } as CSSProperties}
            >
              <span className={styles.metricName}>{m.name}</span>
              <div className={styles.metricValue}>
                <strong>
                  {m.value}
                  {m.unit && <em>{m.unit}</em>}
                </strong>
                {r.cases > 0 && r.series[i]?.length > 1 && (
                  <Spark
                    values={r.series[i]}
                    color={m.color}
                    id={"spark" + i}
                    metric={m.name}
                  />
                )}
              </div>
              <span className={styles.metricNote}>{m.note}</span>
            </div>
          ))}
        </section>
      </div>
      <Register recs={r.recommendations} open={open} />
    </>
  );
}
