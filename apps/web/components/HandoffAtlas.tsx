"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, Pause, Play, Route } from "lucide-react";
import { number } from "./UI";
import type { State } from "../lib/types";
import { buildFieldEvidence, type EvidenceRecord, type HandoffEvidence } from "./overview/fieldEvidence";
import type { FieldEngine, FieldSystem } from "./overview/fieldEngine";
import css from "./HandoffAtlas.module.css";

const duration = (hours: number | null) => hours === null ? "—" : number(Number(hours.toFixed(2))) + " h";
const utc = new Intl.DateTimeFormat("en-GB", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit", timeZone:"UTC"});

function Passage({ systems, route, scale, paused }: {
  systems: FieldSystem[]; route: HandoffEvidence; scale: { events: number; handoffs: number }; paused: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<FieldEngine | null>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let closed = false;
    let fx: FieldEngine | undefined;
    function lost() { setEngine(null); }
    el.addEventListener("webglcontextlost", lost);
    import("./overview/fieldEngine").then(({ FieldEngine }) => {
      if (closed) return;
      fx = new FieldEngine(el, "route");
      setEngine(fx);
    }).catch(() => { if (!closed) setEngine(null); });
    return () => { closed = true; el.removeEventListener("webglcontextlost", lost); fx?.dispose(); };
  }, []);
  useEffect(() => {
    if (!engine) return;
    const ends = [route.source, route.target].flatMap(name => systems.filter(s => s.name === name));
    engine.setData(ends, [route], scale);
    engine.renderStill();
  }, [engine, systems, route, scale]);
  useEffect(() => {
    const el = canvas.current;
    if (!engine || !el) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    function sync() { engine?.setActive(visible && !document.hidden && !paused && !preference.matches); }
    const resize = () => engine.resize(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    resize();
    observer.observe(el); intersection.observe(el);
    preference.addEventListener("change", sync); document.addEventListener("visibilitychange", sync);
    return () => {
      engine.setActive(false); observer.disconnect(); intersection.disconnect();
      preference.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync);
    };
  }, [engine, paused]);
  return <div className={css.plot} data-renderer={engine ? "webgl" : "static"} aria-hidden="true">
    {!engine && <div className={css.staticRoute}><i/><span/><ArrowRight size={18}/><i/></div>}
    <canvas ref={canvas}/>
  </div>;
}

function SourceEvent({ row }: {row: EvidenceRecord}) {
  const date = new Date(row.timestamp);
  return <div className={css.event}><small>{row.system}</small><strong>{row.activity}</strong>
    <time dateTime={row.timestamp}>{Number.isFinite(date.getTime()) ? utc.format(date) + " UTC" : row.timestamp}</time>
    <span>{row.source} · row {row.row} · {row.id}</span>
  </div>;
}

export default function HandoffAtlas({s, paused, togglePause, openSystem}: {
  s: State; paused: boolean; togglePause: () => void; openSystem: (name: string) => void;
}) {
  const evidence = useMemo(() => buildFieldEvidence(s.report, s.data.events, s.data.sources), [s.report, s.data.events, s.data.sources]);
  const [sort, setSort] = useState("volume");
  const [selected, select] = useState("");
  const routes = useMemo(() => [...evidence.handoffs.values()].sort((a,b) =>
    (sort === "wait" ? (b.medianHours ?? -1) - (a.medianHours ?? -1) : b.count - a.count) || a.id.localeCompare(b.id)), [evidence, sort]);
  const systems = useMemo(() => {
    let tint = 0;
    return [...evidence.systems.values()].map((s, formIndex) => ({
      name:s.name, count:s.count, pressure:s.pressure, formIndex, tintIndex:s.pressure ? undefined : tint++,
    }));
  }, [evidence]);
  const scale = useMemo(() => ({events: Math.max(1, ...systems.map(s => s.count)), handoffs: Math.max(1, ...routes.map(r => r.count))}), [systems, routes]);
  const route = routes.find(r => r.id === selected) ?? routes[0];
  if (!route) return <section className={css.empty}><Route/><h2>Handoff atlas</h2><p>No cross-system handoffs were observed in this reporting window.</p></section>;
  return <section className={css.atlas} aria-label="Handoff atlas">
    <div className={css.layout}>
      <article className={css.field}>
        <header className={css.head}><div><div className={css.eyeline}><Route size={16}/> Selected handoff</div>
          <h2>{route.source} <ArrowRight aria-label="to"/> {route.target}</h2></div>
          <button className={css.motion} onClick={togglePause} aria-label={paused ? "Play map motion" : "Pause map motion"}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
        </header>
        <Passage systems={systems} route={route} scale={scale} paused={paused}/>
        <div className={css.ends}>{[route.source,route.target].map((name,i) =>
          <button key={name} onClick={() => openSystem(name)} aria-label={"Inspect "+name}><small>{i === 0 ? "Origin" : "Destination"}</small>{name}<ArrowUpRight size={13}/></button>)}</div>
        <dl className={css.metrics}><div><dt>Observed handoffs</dt><dd>{number(route.count)}</dd></div>
          <div><dt>Distinct cases</dt><dd>{number(route.cases)}</dd></div><div><dt>Median interval</dt><dd>{duration(route.medianHours)}</dd></div></dl>
      </article>
      <aside className={css.register} aria-label="Directed handoffs">
        <header><div className={css.eyeline}>{routes.length} directed routes</div><h2>Handoff index</h2>
        <div className={css.sort} role="group" aria-label="Order routes">{["volume","wait"].map(key =>
          <button key={key} aria-pressed={sort===key} onClick={() => setSort(key)}>{key==="volume"?"By volume":"By interval"}</button>)}</div></header>
        <div className={css.list}>{routes.map(r => <button key={r.id} aria-pressed={route.id===r.id} onClick={() => select(r.id)}>
          <span>{r.source} <ArrowRight size={13}/> {r.target}</span><b>{sort==="volume" ? number(r.count) : duration(r.medianHours)}</b>
        </button>)}</div>
      </aside>
    </div>
    <section className={css.evidence} aria-label="Paired source records"><header><h2>Paired source records</h2><span>Consecutive events in the same case</span></header>
      <div key={route.id}>{route.samples.length ? route.samples.map((pair,i) => <details key={pair.from.id + "/" + pair.to.id} open={i === 0}>
        <summary><ChevronDown size={15}/><strong>{pair.case}</strong><span>{pair.from.activity} → {pair.to.activity}</span></summary>
        <div className={css.pair}><SourceEvent row={pair.from}/><ArrowRight aria-hidden="true" size={19}/><SourceEvent row={pair.to}/></div>
      </details>) : <p>Source pairs are unavailable for this route.</p>}</div>
    </section>
  </section>;
}
