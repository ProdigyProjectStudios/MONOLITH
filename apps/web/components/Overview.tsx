import {
  Activity,
  ChevronRight,
  Clock3,
  Expand,
  GitFork,
  Orbit,
  Radio,
  ScanLine,
  SlidersHorizontal,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { type Page, type Rec, type Report } from "../lib/types";
import { number, RecGlyph, Spark, Tag } from "./UI";
export const Topology = dynamic(() => import("./Topology"), {
  ssr: false,
  loading: () => <div className="map-load">Rendering business map…</div>,
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
    <section className="panel register">
      <div className="panel-head">
        <div>
          <div className="section-eyebrow">
            <ScanLine size={13} /> OPPORTUNITY INTELLIGENCE
          </div>
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
export function Overview({
  r,
  navigate,
  open,
  selectSystem,
}: {
  r: Report;
  navigate: (p: Page) => void;
  open: (r: Rec) => void;
  selectSystem: (s: string) => void;
}) {
  const metrics = [
    {
      name: "Observed events",
      value: number(r.events),
      note: r.cases + " linked cases",
      icon: Activity,
      color: "#bfea8c",
    },
    {
      name: "Process variants",
      value: number(r.variants),
      note: "Discovered paths",
      icon: GitFork,
      color: "#ad9ce1",
    },
    {
      name: "Opportunities",
      value: String(r.auto).padStart(2, "0"),
      note: "Automation candidates",
      icon: ScanLine,
      color: "#edb578",
    },
    {
      name: "Median cycle time",
      value: r.cycle.toString(),
      unit: "h",
      note: "First to last event",
      icon: Clock3,
      color: "#7dc4dc",
    },
  ];
  const ordered = ["refund", "entry", "review"]
    .map((id) => r.recommendations.find((x) => x.id === id))
    .filter((x): x is Rec => !!x);
  const feed = ordered.length ? ordered : r.recommendations.slice(0, 3);
  return (
    <>
      <div className="metrics">
        {metrics.map((m, i) => (
          <div className="metric" key={m.name}>
            <div className="metric-label">
              <m.icon size={15} />
              {m.name}
            </div>
            <div className="metric-main">
              <strong>
                {m.value}
                <em>{m.unit}</em>
              </strong>
              <Spark values={r.series[i]} color={m.color} id={"spark" + i} />
            </div>
            <small>{m.note}</small>
          </div>
        ))}
      </div>
      <div className="middle">
        <section className="panel map-card">
          <div className="panel-head">
            <div>
              <div className="section-eyebrow">
                <Orbit size={13} /> BUSINESS TOPOLOGY
              </div>
              <h2>Operational map</h2>
            </div>
            <button
              className="icon-btn square"
              aria-label="Expand business map"
              onClick={() => navigate("Business map")}
            >
              <Expand size={15} />
            </button>
          </div>
          <div className="map-surface">
            <Topology
              systems={r.systems}
              links={r.links}
              onSelect={selectSystem}
            />
          </div>
          <div className="map-foot">
            <span>
              <i className="legend-dot" />
              {r.systems.length} systems
              <i className="sep" /> {r.links.length} directed links
            </span>
            <button
              className="text-btn"
              onClick={() => navigate("Business map")}
            >
              Explore map <ChevronRight size={14} />
            </button>
          </div>
        </section>
        <section className="panel feed">
          <div className="panel-head">
            <div>
              <div className="section-eyebrow">
                <Radio size={13} /> ANALYSIS OUTPUT
              </div>
              <h2>Intelligence feed</h2>
            </div>
            <span className="counter">
              {feed.length.toString().padStart(2, "0")}
            </span>
          </div>
          <div className="feed-items">
            {feed.map((v) => (
              <button key={v.id} className="feed-item" onClick={() => open(v)}>
                <RecGlyph r={v} />
                <div className="feed-copy">
                  <span
                    className={
                      "category " +
                      (v.id === "review"
                        ? "orange"
                        : v.id === "entry"
                          ? "blue"
                          : "lime")
                    }
                  >
                    {v.id === "refund"
                      ? "BOTTLENECK"
                      : v.id === "entry"
                        ? "REPEATED WORK"
                        : v.kind === "Human-led"
                          ? "HUMAN BOUNDARY"
                          : "OPPORTUNITY"}
                  </span>
                  <strong>
                    {v.id === "refund"
                      ? "Refund approval delays"
                      : v.id === "entry"
                        ? "Duplicate data entry"
                        : v.id === "review"
                          ? "Dispute review boundary"
                          : v.title}
                  </strong>
                  <small>
                    {v.id === "refund"
                      ? v.hours + "h median approval interval"
                      : v.id === "entry"
                        ? v.cases + " cases with manual re-entry"
                        : v.id === "review"
                          ? v.cases + " cases with human review"
                          : v.cases + " matched cases"}
                  </small>
                </div>
                <ChevronRight size={14} />
              </button>
            ))}
            {!feed.length && (
              <p className="empty">No supported patterns in this window.</p>
            )}
          </div>
          <button
            className="feed-foot"
            onClick={() => navigate("Agent activity")}
          >
            <Activity size={14} /> View analysis trace{" "}
            <ChevronRight size={14} />
          </button>
        </section>
      </div>
      <Register recs={r.recommendations} open={open} />
    </>
  );
}
