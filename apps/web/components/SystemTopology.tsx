"use client";
import { useId, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Network,
} from "lucide-react";
import type { State } from "../lib/types";
import { buildFieldEvidence, linkId } from "./overview/fieldEvidence";
import { Evidence } from "./Detail";
import HandoffBackdrop from "./HandoffBackdrop";
import { Topology } from "./Overview";
import { number } from "./UI";
import css from "./SystemTopology.module.css";

export default function SystemTopology({
  s,
  selected,
  select,
  paused = false,
}: {
  s: State;
  selected: string;
  paused?: boolean;
  select: (system: string) => void;
}) {
  const evidenceId = useId();
  const evidencePanel = useRef<HTMLElement>(null);
  const [pickedRoute, setRoute] = useState("");
  const evidence = useMemo(
    () => buildFieldEvidence(s.report, s.data.events, s.data.sources),
    [s.report, s.data.events, s.data.sources],
  );
  const nodes = useMemo(
    () =>
      s.report.systems.map((system) => ({
        ...system,
        tone: evidence.pressure.has(system.name)
          ? ("pressure" as const)
          : ("flow" as const),
      })),
    [s.report.systems, evidence],
  );
  const links = useMemo(
    () =>
      s.report.links.map((link) => ({
        ...link,
        id: linkId(link.source, link.target),
      })),
    [s.report.links],
  );
  const system =
    evidence.systems.get(selected) ?? evidence.systems.values().next().value;
  if (!system)
    return (
      <section className="panel empty">
        Import an event log to discover system relationships.
      </section>
    );

  const routes = [...evidence.handoffs.values()]
    .filter(
      (route) => route.source === system.name || route.target === system.name,
    )
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const route = routes.find((r) => r.id === pickedRoute);
  const inbound = system.inbound.reduce((sum, row) => sum + row.count, 0);
  const outbound = system.outbound.reduce((sum, row) => sum + row.count, 0);
  function pickSystem(name: string) {
    setRoute("");
    select(name);
  }
  function inspectRoute(id: string) {
    const handoff = evidence.handoffs.get(id);
    if (!handoff || !system) return;
    if (system.name !== handoff.source && system.name !== handoff.target)
      select(handoff.source);
    setRoute(id);
  }
  return (
    <section
      className={css.workspace}
      data-paused={paused}
      aria-label="System topology"
    >
      <div className={css.chamber}>
        <div className={css.main}>
          <header className={css.heading}>
            <div className={css.title}>
              <Network aria-hidden="true" size={20} />
              <h2>System topology</h2>
            </div>
            <span>
              {number(nodes.length)} systems <i>/</i> {number(links.length)}{" "}
              routes
            </span>
          </header>
          <div className={css.map}>
            <Topology
              showTrafficVolume
              paused={paused}
              systems={nodes}
              links={links}
              selected={system.name}
              selectedLink={route?.id}
              onSelect={pickSystem}
              onSelectLink={inspectRoute}
            />
            <div className={css.mist} aria-hidden="true">
              <HandoffBackdrop warm={system.pressure} />
            </div>
          </div>
          <footer className={css.mapFooter}>
            <span>Select a system or handoff to inspect its traffic.</span>
            <button
              type="button"
              aria-controls={evidenceId}
              onClick={() => evidencePanel.current?.focus()}
            >
              Inspect evidence
            </button>
          </footer>
        </div>
        <aside className={css.inspector} aria-label="System inspector">
          <label className={css.picker}>
            Inspect system
            <select
              aria-label="Inspect system"
              value={system.name}
              onChange={(event) => pickSystem(event.target.value)}
            >
              {nodes.map((node) => (
                <option key={node.name}>{node.name}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <div className={css.readout}>
            <h3>{system.name}</h3>
            <p>
              <strong>{number(system.count)}</strong> observed events
            </p>
          </div>
          <div className={css.balance}>
            <div>
              <span>
                <ArrowDownLeft size={15} /> Incoming
              </span>
              <b>{number(inbound)}</b>
            </div>
            <div>
              <span>
                <ArrowUpRight size={15} /> Outgoing
              </span>
              <b>{number(outbound)}</b>
            </div>
            <div className={css.balanceBar} aria-hidden="true">
              <i style={{ flexGrow: inbound }} />
              <i style={{ flexGrow: outbound }} />
            </div>
          </div>
          <h4>Connected routes</h4>
          {routes.length ? (
            <div className={css.routeList}>
              {routes.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  aria-pressed={route?.id === r.id}
                  aria-controls={evidenceId}
                  onClick={() => inspectRoute(r.id)}
                >
                  <span>
                    {r.source} <ArrowRight aria-label="to" size={12} />{" "}
                    {r.target}
                  </span>
                  <b>{number(r.count)}</b>
                </button>
              ))}
            </div>
          ) : (
            <p>No incoming or outgoing handoffs in this window.</p>
          )}
        </aside>
      </div>
      <section
        id={evidenceId}
        ref={evidencePanel}
        tabIndex={-1}
        className={css.sources}
        aria-label="Topology evidence"
      >
        <header>
          <div>
            <span className={css.label}>
              {route ? "Handoff evidence" : "System evidence"}
            </span>
            <h3>
              {route ? (
                <>
                  {route.source} <ArrowRight aria-label="to" size={20} />{" "}
                  {route.target}
                </>
              ) : (
                system.name + " records"
              )}
            </h3>
          </div>
          <div className={css.facts}>
            {route ? (
              <>
                <span>
                  <b>{number(route.count)}</b> handoffs
                </span>
                <span>
                  <b>{number(route.cases)}</b> cases
                </span>
                {route.medianHours !== null && (
                  <span>
                    <b>{number(Number(route.medianHours.toFixed(2)))} h</b>{" "}
                    median interval
                  </span>
                )}
              </>
            ) : (
              <span>
                <b>{number(system.cases)}</b> distinct cases
              </span>
            )}
          </div>
        </header>
        {route ? (
          route.samples.length ? (
            route.samples.map((pair) => (
              <div className={css.pair} key={pair.from.id + pair.to.id}>
                <span>{pair.case}</span>
                <Evidence id={pair.from.id} s={s} showTime />
                <Evidence id={pair.to.id} s={s} showTime />
              </div>
            ))
          ) : (
            <p>No paired records are available for this handoff.</p>
          )
        ) : system.samples.length ? (
          <div className={css.records}>
            {system.samples.map((row) => (
              <Evidence key={row.id} id={row.id} s={s} showTime />
            ))}
          </div>
        ) : (
          <p>No source records are available for this system.</p>
        )}
      </section>
    </section>
  );
}
