"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ArrowUpRight, Network } from "lucide-react";
import type { ContinuousRun, ContinuousSnapshot } from "../lib/continuousTypes";
import type { State } from "../lib/types";
import { useFrozenSources } from "../lib/frozenSources";
import css from "./Continuous.module.css";

const Topology = dynamic(() => import("./Topology"), {
  ssr: false,
  loading: () => (
    <div className={css.fieldLoading}>Rendering observed relationships…</div>
  ),
});
const fieldOptions = {
  controls: false,
  ariaLabel: "Observed systems and handoffs",
  unit: "events",
};
type Tone = "flow" | "pressure" | "investigation";
export default function ContinuousField({
  s,
  snapshot,
  runs,
  signalId,
  inspect,
}: {
  s: State;
  snapshot: ContinuousSnapshot;
  runs: ContinuousRun[];
  signalId: string;
  inspect: (id: string) => void;
}) {
  const [choice, setChoice] = useState("");
  const frozen = useFrozenSources(s, snapshot.id);
  const rows = frozen.workspace.data.events;
  const { systems, links, bySystem } = useMemo(() => {
    const a = snapshot.analysis;
    const graphSystems = a.graph.nodes.filter((node) => node.kind === "system");
    const byId = new Map(graphSystems.map((node) => [node.id, node.label]));
    const source = new Map(rows.map((row) => [row.id, row.system]));
    const investigation = new Set(
      runs.filter((r) => r.snapshot_id === snapshot.id).map((r) => r.signal_id),
    );
    const bySystem = new Map<string, typeof a.signals>();
    for (const signal of a.signals) {
      for (const name of new Set(
        signal.evidence
          .map((id) => source.get(id))
          .filter((v): v is string => !!v),
      )) {
        const list = bySystem.get(name) ?? [];
        list.push(signal);
        bySystem.set(name, list);
      }
    }
    const systems = graphSystems
      .map((node) => {
        const related = bySystem.get(node.label) ?? [];
        const pressure = related.some(
          (sig) => sig.kind === "latency" && (sig.metric.delta ?? 0) > 0,
        );
        const tone: Tone = pressure
          ? "pressure"
          : related.some((sig) => investigation.has(sig.id))
            ? "investigation"
            : "flow";
        return {
          name: node.label,
          count: node.events,
          tone,
          detail: node.cases + " observed cases",
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const links = a.graph.edges.flatMap((edge) => {
      const from = byId.get(edge.source),
        to = byId.get(edge.target);
      return edge.kind === "handoff" && from && to
        ? [{ source: from, target: to, count: edge.count }]
        : [];
    });
    return { systems, links, bySystem };
  }, [rows, snapshot, runs]);
  const implied = systems.find((node) =>
    bySystem.get(node.name)?.some((sig) => sig.id === signalId),
  );
  const selected =
    systems.find((node) => node.name === choice) ?? implied ?? systems[0];
  const related = selected ? (bySystem.get(selected.name) ?? []) : [];
  const [signalChoice, setSignalChoice] = useState("");
  const candidate =
    related.find((sig) => sig.id === signalChoice) ??
    related.find((sig) => sig.id === signalId) ??
    related[0];
  return (
    <section className={css.fieldPanel} aria-label="Observed system field">
      <header>
        <span>
          <Network size={14} />
          System activity
        </span>
        <small>{links.length} observed handoff routes</small>
      </header>
      {selected ? (
        <>
          <div className={css.fieldViewport}>
            <Topology
              systems={systems}
              links={links}
              selected={selected.name}
              onSelect={setChoice}
              {...fieldOptions}
            />
          </div>
          <div className={css.fieldInspector}>
            <label>
              <i data-tone={selected.tone} />
              <select
                aria-label="Inspect field system"
                value={selected.name}
                onChange={(e) => setChoice(e.target.value)}
              >
                {systems.map((node) => (
                  <option key={node.name} value={node.name}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {selected.count.toLocaleString("en-GB")} events ·{" "}
              {selected.detail}
            </span>
          </div>
          {frozen.error && (
            <p role="status" className={css.fieldError}>
              {frozen.error}
            </p>
          )}
          {!!candidate && (
            <div className={css.fieldLinks}>
              {related.length > 1 && (
                <label className={css.fieldRelatedPicker}>
                  <span>{related.length} related signals</span>
                  <select
                    aria-label="Signal cited by selected system"
                    value={candidate.id}
                    onChange={(e) => setSignalChoice(e.target.value)}
                  >
                    {related.map((sig) => (
                      <option key={sig.id} value={sig.id}>
                        {sig.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                aria-label="Inspect related signal"
                onClick={() => inspect(candidate.id)}
              >
                <span>{candidate.title}</span>
                <ArrowUpRight size={15} />
              </button>
            </div>
          )}
        </>
      ) : (
        <p className={css.fieldLoading}>
          No system observations in this revision.
        </p>
      )}
    </section>
  );
}
