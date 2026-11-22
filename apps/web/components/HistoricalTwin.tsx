"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GitBranch,
  Pause,
  Play,
  ScanLine,
} from "lucide-react";
import type {
  ContinuousSnapshot,
  GraphNode,
  GraphEdge,
  GraphEpoch,
} from "../lib/continuousTypes";
import type { useContinuous } from "../lib/useContinuous";
import type { State } from "../lib/types";
import {
  epochRelationships,
  evidenceEpoch,
  flowLayers,
  relationshipTrend,
  visibleFlows,
  type FlowLayer,
} from "../lib/graphHistory";
import { useFrozenSources } from "../lib/frozenSources";
import { Evidence } from "./Detail";
import Topology from "./Topology";
import css from "./HistoricalTwin.module.css";

export type HistoricalTwinProps = {
  continuous?: ReturnType<typeof useContinuous>;
  selectedSignal?: string;
  selectedSnapshot?: string;
  onOpenInvestigation?: (id: string) => void;
  onOpenContinuous?: (signalId?: string, snapshotId?: string) => void;
};

const compactDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dateRange = (epoch: GraphEpoch) =>
  compactDate.format(Date.parse(epoch.start)) +
  " – " +
  compactDate.format(Date.parse(epoch.end) - 1);
const number = (count: number) => count.toLocaleString("en-GB");

function RelationshipFlow({
  nodes,
  edges,
  epoch,
  previous,
  layer,
  activeId,
  investigationEdge,
  onChoose,
}: {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  epoch: GraphEpoch;
  previous?: GraphEpoch;
  layer: FlowLayer;
  activeId: string;
  investigationEdge?: string;
  onChoose: (id: string) => void;
}) {
  const { systems, links } = useMemo(() => {
    const visible = visibleFlows(edges, activeId, 9);
    const endpointIds = [
      ...new Set(visible.flatMap((e) => [e.source, e.target])),
    ].sort();
    const pressured = new Set<string>();
    const investigated = new Set<string>();
    const links = visible.map((e) => {
      const hours = epoch.edge_median_hours?.[e.id],
        prior = previous?.edge_median_hours?.[e.id];
      const longer =
        typeof hours === "number" && typeof prior === "number" && hours > prior;
      if (longer) pressured.add(e.target);
      if (e.id === investigationEdge) {
        investigated.add(e.source);
        investigated.add(e.target);
      }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        count: epoch.edge_counts[e.id],
        label:
          (nodes.get(e.source)?.label ?? e.source) +
          " → " +
          (nodes.get(e.target)?.label ?? e.target) +
          ", " +
          number(epoch.edge_counts[e.id]) +
          " observations",
        tone:
          e.id === investigationEdge
            ? ("investigation" as const)
            : longer
              ? ("pressure" as const)
              : ("flow" as const),
      };
    });
    const systems = endpointIds.map((id) => ({
      id,
      name: nodes.get(id)?.label ?? id,
      count: epoch.node_counts[id] ?? 0,
      detail: number(epoch.node_counts[id] ?? 0) + " events",
      tone: investigated.has(id)
        ? ("investigation" as const)
        : pressured.has(id)
          ? ("pressure" as const)
          : ("flow" as const),
    }));
    return { systems, links };
  }, [nodes, edges, epoch, previous, activeId, investigationEdge]);
  const selected = links.find((e) => e.id === activeId);
  return (
    <div className={css.figure}>
      {systems.length ? (
        <div className={css.fieldCanvas}>
          <Topology
            systems={systems}
            links={links}
            unit="events"
            selectedLink={activeId}
            ariaLabel={layer.name + " for " + dateRange(epoch)}
            onSelectLink={onChoose}
            onSelect={(id) => {
              const relation =
                selected?.source === id || selected?.target === id
                  ? selected
                  : (links.find((e) => e.source === id) ??
                    links.find((e) => e.target === id));
              if (relation) onChoose(relation.id);
            }}
          />
        </div>
      ) : (
        <div className={css.empty}>
          <GitBranch size={20} />
          <p>No {layer.name.toLowerCase()} recorded in this epoch.</p>
        </div>
      )}
      <div className={css.legend}>
        <span>
          <i className={css.legendDot} />
          {number(links.length)} of {number(edges.length)} relationships shown
        </span>
        {links.some((e) => e.tone === "pressure") && (
          <span className={css.pressureKey}>Longer median interval</span>
        )}
        {investigationEdge && (
          <span className={css.agentKey}>Investigated route</span>
        )}
      </div>
    </div>
  );
}

export default function HistoricalTwin({
  s,
  continuous,
  selectedSignal,
  selectedSnapshot,
  onOpenInvestigation,
  onOpenContinuous,
}: HistoricalTwinProps & { s: State }) {
  const latest = continuous?.view?.snapshot;
  const [revisionId, setRevision] = useState(selectedSnapshot ?? "");
  const [archived, setArchived] = useState<ContinuousSnapshot | null>(null);
  const [revisionError, setRevisionError] = useState("");
  const loadSnapshot = continuous?.loadSnapshot;
  const archiveId =
    revisionId && latest && revisionId !== latest.id ? revisionId : "";
  useEffect(() => {
    let current = true;
    setRevisionError("");
    if (archiveId && loadSnapshot) {
      loadSnapshot(archiveId)
        .then((snap) => {
          if (current) setArchived(snap);
        })
        .catch(() => {
          if (current)
            setRevisionError("This graph revision could not be loaded.");
        });
    }
    return () => {
      current = false;
    };
  }, [archiveId, loadSnapshot, s.tenant]);
  const snapshot = archiveId
    ? archived?.id === archiveId
      ? archived
      : null
    : latest;
  const analysis = snapshot?.analysis;
  const frozen = useFrozenSources(s, snapshot?.id);
  const events = frozen.workspace.data.events;
  const graph = analysis?.graph;
  const signal = analysis?.signals.find((item) => item.id === selectedSignal);
  const [chosenEpoch, setEpoch] = useState("");
  const [chosenLayer, setLayer] = useState<string>("");
  const [chosenEdge, setEdge] = useState("");
  const [playing, setPlaying] = useState(false);
  const eventTimes = useMemo(
    () => new Map(events.map((e) => [e.id, Date.parse(e.timestamp)])),
    [events],
  );
  const records = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );
  const positions = graph?.epochs;
  const anchor = useMemo(
    () =>
      positions &&
      signal &&
      evidenceEpoch(positions, signal.evidence, eventTimes),
    [positions, signal, eventTimes],
  );
  const activeId = chosenEpoch || anchor;
  const found = positions?.findIndex((epoch) => epoch.id === activeId) ?? -1;
  const index = found >= 0 ? found : (positions?.length ?? 0) - 1;
  const epoch = positions?.[index];
  const previous = positions?.[index - 1];
  const nodes = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.id, n])),
    [graph],
  );
  const edgeMap = useMemo(
    () => new Map(graph?.edges.map((e) => [e.id, e])),
    [graph],
  );
  const signalEvidence = useMemo(() => new Set(signal?.evidence), [signal]);
  const anchoredEdge = useMemo(() => {
    if (!epoch || !signal) return undefined;
    const preferred =
      signal.kind === "handoff"
        ? "handoff"
        : signal.kind === "latency" || signal.kind === "variant"
          ? "precedes"
          : "observed_in";
    const exact = epoch.edge_ids
      .map((id) => edgeMap.get(id))
      .find((edge) => {
        if (!edge || edge.kind !== preferred) return false;
        const a = nodes.get(edge.source)?.label,
          b = nodes.get(edge.target)?.label;
        if (preferred === "observed_in") return a === signal.subject[0];
        return signal.subject.some(
          (step, i) => step === a && signal.subject[i + 1] === b,
        );
      });
    if (exact) return exact;
    for (const kind of flowLayers) {
      const match = epoch.edge_ids.find(
        (id) =>
          edgeMap.get(id)?.kind === kind.id &&
          (epoch.edge_evidence[id] ?? []).some((ref) =>
            signalEvidence.has(ref),
          ),
      );
      if (match) return edgeMap.get(match);
    }
  }, [edgeMap, epoch, signalEvidence, signal, nodes]);
  const layer =
    flowLayers.find((l) => l.id === (chosenLayer || anchoredEdge?.kind)) ??
    flowLayers[0];
  const edges = useMemo(
    () =>
      graph && epoch ? epochRelationships(graph.edges, epoch, layer.id) : [],
    [graph, epoch, layer],
  );
  const selected =
    edges.find((edge) => edge.id === chosenEdge) ??
    edges.find((edge) => edge.id === anchoredEdge?.id) ??
    edges[0];
  useEffect(() => {
    if (!playing || !positions) return;
    const next = positions[index + 1];
    if (!next) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setEpoch(next.id), 1900);
    return () => window.clearTimeout(timer);
  }, [playing, index, positions]);
  const jump = (i: number) => {
    if (!positions?.[i]) return;
    setPlaying(false);
    setEpoch(positions[i].id);
  };
  if (!analysis || !graph || !epoch || !positions) {
    return (
      <section className={css.root} aria-label="Historical graph">
        <div className={css.empty}>
          <Clock3 size={26} />
          <h3>Relationship history</h3>
          <p role="status">
            {archiveId && !snapshot
              ? revisionError || "Loading saved graph revision…"
              : analysis
                ? "Graph history begins with a timestamped event."
                : "A monitoring snapshot supplies the event-time history for this map."}
          </p>
          {archiveId && (
            <button className={css.link} onClick={() => setRevision("")}>
              View latest revision
            </button>
          )}
          {onOpenContinuous && (
            <button className={css.link} onClick={() => onOpenContinuous()}>
              Open Continuous <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      </section>
    );
  }
  const before = new Set(
      previous?.edge_ids.filter((id) => edgeMap.get(id)?.kind === layer.id),
    ),
    current = new Set(edges.map((e) => e.id));
  const appeared = edges.filter((e) => !before.has(e.id)),
    disappeared = [...before].filter((id) => !current.has(id));
  const source = selected && nodes.get(selected.source),
    target = selected && nodes.get(selected.target);
  const evidence = selected ? (epoch.edge_evidence[selected.id] ?? []) : [];
  const cases = new Map<string, string[]>();
  for (const ref of evidence) {
    const record = records.get(ref);
    const label = record?.case || "Unavailable record";
    cases.set(label, [...(cases.get(label) || []), ref]);
  }
  for (const ids of cases.values())
    ids.sort((a, b) => (eventTimes.get(a) || 0) - (eventTimes.get(b) || 0));
  const refs = new Set(evidence);
  const linked = analysis.signals.filter((item) =>
    item.evidence.some((ref) => refs.has(ref)),
  );
  const trend = selected ? relationshipTrend(positions, selected.id) : [];
  const interval = selected
    ? epoch.edge_median_hours?.[selected.id]
    : undefined;
  const priorInterval = selected
    ? previous?.edge_median_hours?.[selected.id]
    : undefined;
  const maxEpoch = Math.max(1, ...positions.map((p) => p.events));
  const chooseEdge = (id: string) => {
    setPlaying(false);
    setEdge(id);
  };
  const nameEdge = (edge: GraphEdge) =>
    (nodes.get(edge.source)?.label ?? edge.source) +
    " → " +
    (nodes.get(edge.target)?.label ?? edge.target);
  return (
    <section className={css.root} aria-label="Historical graph">
      <div className={css.head}>
        <div>
          <span className={css.kicker}>
            <Clock3 size={13} /> Event-time playback
          </span>
          <h3>Relationship history</h3>
        </div>
        <label className={css.snapshot}>
          Data revision
          <select
            aria-label="Graph revision"
            value={snapshot?.id}
            onChange={(event) => {
              setPlaying(false);
              setEpoch("");
              setEdge("");
              setRevision(
                event.target.value === latest?.id ? "" : event.target.value,
              );
            }}
          >
            {(continuous?.view?.history ?? []).map((rev) => (
              <option value={rev.id} key={rev.id}>
                Revision {rev.revision}
                {rev.id === latest?.id ? " · Latest" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {signal && (
        <div className={css.context}>
          <ScanLine size={14} />
          <span>
            Signal in focus <strong>{signal.title}</strong>
            {!anchor && " · Cited records fall outside the displayed epochs."}
          </span>
          {onOpenContinuous && (
            <button
              className={css.link}
              onClick={() => onOpenContinuous(signal.id, snapshot?.id)}
            >
              View signal <ArrowUpRight size={13} />
            </button>
          )}
        </div>
      )}
      <div className={css.split}>
        <div className={css.main}>
          <div className={css.flowhead}>
            <div>
              <h4>{layer.name}</h4>
            </div>
            <select
              aria-label="Relationship layer"
              value={layer.id}
              onChange={(event) => {
                setPlaying(false);
                setLayer(event.target.value);
                setEdge("");
              }}
            >
              {flowLayers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <RelationshipFlow
            nodes={nodes}
            edges={edges}
            epoch={epoch}
            layer={layer}
            activeId={selected?.id ?? ""}
            onChoose={chooseEdge}
            previous={previous}
            investigationEdge={
              continuous?.view?.investigations.some(
                (run) =>
                  run.snapshot_id === snapshot?.id &&
                  run.signal_id === signal?.id,
              )
                ? anchoredEdge?.id
                : undefined
            }
          />
          <div className={css.timeline}>
            <div className={css.timehead}>
              <div>
                <span className={css.caption}>Selected epoch · UTC</span>
                <strong>
                  {dateRange(epoch)} {new Date(epoch.start).getUTCFullYear()}
                </strong>
              </div>
              <div className={css.transport}>
                <button
                  aria-label="Previous epoch"
                  disabled={index <= 0}
                  onClick={() => jump(index - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className={css.play}
                  aria-label={playing ? "Pause timeline" : "Play timeline"}
                  disabled={positions.length < 2}
                  onClick={() => {
                    if (!playing && index === positions.length - 1)
                      setEpoch(positions[0].id);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                  <span>{playing ? "Pause" : "Play"}</span>
                </button>
                <button
                  aria-label="Next epoch"
                  disabled={index >= positions.length - 1}
                  onClick={() => jump(index + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className={css.track}>
              {positions.map((p, i) => (
                <button
                  key={p.id}
                  aria-label={dateRange(p) + ", " + p.events + " events"}
                  aria-pressed={i === index}
                  title={dateRange(p) + " · " + p.events + " events"}
                  onClick={() => jump(i)}
                >
                  <span
                    style={{ height: Math.max(5, (p.events / maxEpoch) * 33) }}
                  />
                  <small>{compactDate.format(Date.parse(p.start))}</small>
                </button>
              ))}
            </div>
            <input
              className={css.range}
              type="range"
              aria-label="Graph epoch"
              aria-valuetext={dateRange(epoch)}
              min={0}
              max={positions.length - 1}
              value={index}
              onChange={(event) => jump(Number(event.target.value))}
            />
          </div>
          <div className={css.stats}>
            <div>
              <span>Events</span>
              <strong>{number(epoch.events)}</strong>
            </div>
            <div>
              <span>Cases</span>
              <strong>{number(epoch.cases)}</strong>
            </div>
            <div>
              <span>Mapped relationships</span>
              <strong>{number(epoch.edge_ids.length)}</strong>
            </div>
          </div>
          <div className={css.diff}>
            <h4>Change since previous epoch</h4>
            {previous ? (
              <>
                <div className={css.deltas}>
                  <span>
                    <b>{appeared.length}</b> newly observed
                  </span>
                  <span>
                    <b>{disappeared.length}</b> no longer observed
                  </span>
                </div>
                {(appeared.length > 0 || disappeared.length > 0) && (
                  <details>
                    <summary>Changed relationships</summary>
                    {appeared.slice(0, 8).map((e) => (
                      <p key={e.id}>
                        <b>Appeared</b> {nameEdge(e)}
                      </p>
                    ))}
                    {disappeared.slice(0, 8).map((id) => {
                      const edge = edgeMap.get(id);
                      return (
                        edge && (
                          <p key={id}>
                            <b>Absent</b> {nameEdge(edge)}
                          </p>
                        )
                      );
                    })}
                    {(appeared.length > 8 || disappeared.length > 8) && (
                      <p>Showing up to eight per group.</p>
                    )}
                  </details>
                )}
              </>
            ) : (
              <p>This is the first displayed epoch.</p>
            )}
          </div>
        </div>
        <aside
          className={css.inspector}
          aria-label="Historical relationship inspector"
        >
          <span className={css.kicker}>
            <GitBranch size={13} /> Relationship inspector
          </span>
          {selected ? (
            <>
              <label className={css.selectLabel}>
                Inspect a relationship
                <select
                  aria-label="Inspect a relationship"
                  value={selected.id}
                  onChange={(event) => chooseEdge(event.target.value)}
                >
                  {edges.map((e) => (
                    <option value={e.id} key={e.id}>
                      {nameEdge(e)}
                    </option>
                  ))}
                </select>
              </label>
              <h4>
                {source?.label}
                <ArrowRight size={14} />
                {target?.label}
              </h4>
              {layer.id === "assigned_to" && (
                <p>
                  Assignment provenance ·{" "}
                  {edgeMap.get(selected.id)?.origin ?? target?.origin}
                </p>
              )}
              <div className={css.insight}>
                <strong>{number(epoch.edge_counts[selected.id])}</strong>
                <span>occurrences in this epoch</span>
              </div>
              <div
                className={css.minitrend}
                aria-label="Relationship occurrences across epochs"
              >
                {trend.map((v, i) => (
                  <button
                    key={positions[i].id}
                    aria-label={
                      dateRange(positions[i]) + ", " + v + " occurrences"
                    }
                    aria-pressed={i === index}
                    onClick={() => jump(i)}
                  >
                    <span
                      style={{
                        height: Math.max(2, (v / Math.max(...trend, 1)) * 26),
                      }}
                    />
                  </button>
                ))}
              </div>
              {typeof interval === "number" && (
                <div className={css.intervals}>
                  <p className={css.duration}>
                    Median interval this epoch{" "}
                    <strong>
                      {interval.toLocaleString("en-GB", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      h
                    </strong>
                  </p>
                  {typeof priorInterval === "number" && (
                    <>
                      <p className={css.duration}>
                        Previous epoch
                        <strong>
                          {priorInterval.toLocaleString("en-GB", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          h
                        </strong>
                      </p>
                      <p
                        className={css.duration}
                        data-direction={
                          interval > priorInterval
                            ? "longer"
                            : interval < priorInterval
                              ? "shorter"
                              : "level"
                        }
                      >
                        Median change
                        <strong>
                          {(interval - priorInterval).toLocaleString("en-GB", {
                            signDisplay: "exceptZero",
                            maximumFractionDigits: 1,
                          })}{" "}
                          h
                        </strong>
                      </p>
                    </>
                  )}
                </div>
              )}
              <span className={css.caption}>
                Source evidence · {evidence.length} cited records
              </span>
              <div className={css.evidence}>
                {frozen.error && <p role="alert">{frozen.error}</p>}
                {evidence.length ? (
                  [...cases].map(([caseId, ids]) => (
                    <div className={css.caseGroup} key={caseId}>
                      <small>{caseId}</small>
                      {ids.map((id) =>
                        records.has(id) ? (
                          <Evidence key={id} s={frozen.workspace} id={id} />
                        ) : (
                          <code key={id}>{id}</code>
                        ),
                      )}
                    </div>
                  ))
                ) : (
                  <p>No source rows cited for this connection.</p>
                )}
              </div>
              {linked.length > 0 && onOpenContinuous && (
                <div className={css.signals}>
                  <span className={css.caption}>
                    Signals citing these records
                  </span>
                  {linked.map((item) => {
                    const investigation = continuous?.view?.investigations.find(
                      (run) =>
                        run.signal_id === item.id &&
                        run.snapshot_id === snapshot?.id,
                    );
                    return (
                      <div key={item.id}>
                        <strong>{item.title}</strong>
                        <button
                          className={css.link}
                          onClick={() =>
                            onOpenContinuous(item.id, snapshot?.id)
                          }
                        >
                          Open signal in Continuous <ArrowUpRight size={13} />
                        </button>
                        {investigation && onOpenInvestigation && (
                          <button
                            className={css.link}
                            onClick={() =>
                              onOpenInvestigation(investigation.id)
                            }
                          >
                            Open investigation <ArrowUpRight size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <p>
              Select another epoch or relationship layer to inspect recorded
              connections.
            </p>
          )}
        </aside>
      </div>
      <div className={css.note}>
        <Clock3 size={13} />
        <span>
          Epochs use event timestamps. A handoff belongs to the receiving
          event’s epoch. Event nodes sample up to six source records per epoch.
        </span>
      </div>
    </section>
  );
}
