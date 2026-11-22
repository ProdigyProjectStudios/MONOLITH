import { useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Database, GitBranch } from "lucide-react";
import type { State } from "../lib/types";
import { indexWorkspace } from "../lib/twinField";
import { Evidence } from "./Detail";
import Topology from "./Topology";
import { number } from "./UI";
import css from "./Twin.module.css";

export default function SystemTopology({
  s,
  selected,
  select,
}: {
  s: State;
  selected: string;
  select: (name: string) => void;
}) {
  const { systems, links } = s.report;
  const [routeId, setRoute] = useState("");
  const inspector = useRef<HTMLElement>(null);
  const index = useMemo(() => indexWorkspace(s), [s.data.events, s.report]);
  const routes = useMemo(
    () => links.map(link => ({ ...link, id: JSON.stringify([link.source, link.target]) })),
    [links],
  );
  const system = systems.find(item => item.name === selected) ?? systems[0];
  if (!system) {
    return <div className={css.workbench}><p className={css.empty}>Import an event log to discover system relationships.</p></div>;
  }
  const chooseSystem = (name: string) => {
    setRoute("");
    select(name);
  };
  const route = routes.find(item => item.id === routeId);
  const connected = routes.filter(item => item.source === system.name || item.target === system.name)
    .sort((a, b) => b.count - a.count);
  const samples = route
    ? index.handoffs.get(route.id) ?? []
    : (index.eventsBySystem.get(system.name) ?? []).slice(0, 3).map(event => event.id);
  return (
    <section className={css.workbench} aria-label="System topology explorer">
      <header className={css.header}>
        <h2>System topology</h2>
        <dl className={css.summary} aria-label="Network coverage">
          <div><dt>Systems</dt><dd>{number(systems.length)}</dd></div>
          <div><dt>Directed links</dt><dd>{number(routes.length)}</dd></div>
        </dl>
      </header>
      <div className={css.split}>
        <div className={css.visual}>
          <div className={css.canvas}>
            <Topology
              ariaLabel="System topology"
              systems={systems}
              links={routes}
              selected={route ? undefined : system.name}
              selectedLink={route?.id}
              onSelect={chooseSystem}
              onSelectLink={setRoute}
            />
          </div>
          <div className={css.caption}>
            <span>Choose a system or handoff to inspect its source records.</span>
          </div>
          <button className={css.jump} onClick={() => inspector.current?.focus()}>
            Inspect {route ? "this handoff" : system.name} <ChevronDown size={16} />
          </button>
        </div>
        <aside className={css.inspector} aria-label="System inspector" tabIndex={-1} ref={inspector}>
          <div className={css.inspectorTools}>
            <span className={css.inspectorLabel}>Selection</span>
            <label className={css.picker}>
              Change <ChevronDown size={13} />
              <select
                aria-label="Inspect a system or handoff"
                value={route ? "route:" + route.id : "system:" + system.name}
                onChange={event => {
                  const value = event.target.value;
                  if (value.startsWith("route:")) setRoute(value.slice(6));
                  else chooseSystem(value.slice(7));
                }}
              >
                <optgroup label="Systems">
                  {systems.map(item => <option key={item.name} value={"system:" + item.name}>{item.name}</option>)}
                </optgroup>
                <optgroup label="Handoffs">
                  {routes.map(item => <option key={item.id} value={"route:" + item.id}>{item.source} → {item.target}</option>)}
                </optgroup>
              </select>
            </label>
          </div>
          <div className={css.identity}>
            <span>{route ? <GitBranch size={18} /> : <Database size={18} />}</span>
            <div>
              <small>{route ? "Observed handoff" : "System"}</small>
              <h3>{route ? route.source + " → " + route.target : system.name}</h3>
            </div>
          </div>
          {route ? (
            <>
              <div className={css.fact}><span>Consecutive transfers</span><b>{number(route.count)}</b></div>
              <section className={css.section}>
                <h4>Systems on this route</h4>
                <button className={css.rowLink} onClick={() => chooseSystem(route.source)}>From {route.source} <Database size={14} /></button>
                <button className={css.rowLink} onClick={() => chooseSystem(route.target)}>To {route.target} <Database size={14} /></button>
              </section>
            </>
          ) : (
            <>
              <div className={css.measures}>
                <div><small>Events</small><b>{number(system.count)}</b></div>
                <div><small>Directed links</small><b>{number(connected.length)}</b></div>
              </div>
              {connected.length > 0 && <section className={css.section}>
                <h4>System handoffs</h4>
                <div className={css.routeList}>
                  {connected.map(link => (
                    <button key={link.id} onClick={() => setRoute(link.id)}>
                      <span>{link.source} <ArrowRight size={14} aria-label="to" /> {link.target}</span>
                      <b>{number(link.count)}</b>
                    </button>
                  ))}
                </div>
              </section>}
            </>
          )}
          <section className={css.section}>
            <h4>Source evidence <span>{number(samples.length)}</span></h4>
            {samples.map(id => <Evidence key={id} id={id} s={s} showTime />)}
            {!samples.length && <p>No source rows are available for this selection.</p>}
          </section>
        </aside>
      </div>
    </section>
  );
}
