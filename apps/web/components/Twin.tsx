"use client";
import { useMemo, useState, type CSSProperties } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Activity,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Focus,
  GitBranch,
  Layers3,
  Link2,
  ListFilter,
  Network,
  ScanLine,
  Search,
  Workflow,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Evidence } from "./Detail";
import ConnectedRecords from "./ConnectedRecords";
import HistoricalTwin, { type HistoricalTwinProps } from "./HistoricalTwin";
import { number } from "./UI";
import type { EventRow, Rec, State } from "../lib/types";
import css from "./Twin.module.css";

type Kind = "System" | "Department" | "Process" | "Event" | "Opportunity";
type Layer = "Systems" | "Ownership" | "Processes" | "Events" | "Opportunities";
type Entity = {
  kind: Kind;
  title: string;
  detail: string;
  evidence: string[];
  accent: string;
  system?: string;
  variant?: number;
  rec?: Rec;
  event?: EventRow;
  unknown?: boolean;
};
type MapNode = Node<Entity, "entity">;
type Relation = { description: string; evidence: string[]; status: string };
type MapEdge = Edge<Relation>;
type MapData = { nodes: MapNode[]; edges: MapEdge[] };
const layers: Layer[] = [
  "Systems",
  "Ownership",
  "Processes",
  "Events",
  "Opportunities",
];
const icons = {
  System: Database,
  Department: Building2,
  Process: GitBranch,
  Event: Activity,
  Opportunity: ScanLine,
};
const tones = {
  System: "#8fcbde",
  Department: "#b7a2e8",
  Process: "#a1c4e7",
  Event: "#7cd6bd",
  Opportunity: "#c0df91",
};
const ownership: Record<string, string> = {
  crm: "Customer operations",
  finance: "Finance",
  operations: "Fulfilment",
  support: "Customer support",
};
const systemId = (name: string) => "system:" + name;
const processId = (idx: number) => "process:" + idx;
const ncount = (n: number, unit: string) =>
  number(n) + " " + unit + (n === 1 ? "" : "s");
function Card({ data, selected }: NodeProps<MapNode>) {
  const Icon = icons[data.kind];
  return (
    <div
      className={css.node}
      data-selected={Boolean(selected)}
      style={{ "--tone": data.accent } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} className={css.port} />
      <div className={css.nodeKind}>
        <Icon size={13} />
        {data.kind}
      </div>
      <strong>{data.title}</strong>
      <small>{data.detail}</small>
      <Handle type="source" position={Position.Right} className={css.port} />
    </div>
  );
}
const nodeTypes = { entity: Card };

function derive(s: State) {
  const ids = new Set(s.report.case_ids);
  const cases = new Map<string, EventRow[]>();
  const eventsBySystem = new Map<string, EventRow[]>();
  const records = new Map<string, EventRow>();
  for (const e of s.data.events) {
    if (!ids.has(e.case)) continue;
    records.set(e.id, e);
    if (!cases.has(e.case)) cases.set(e.case, []);
    if (!eventsBySystem.has(e.system)) eventsBySystem.set(e.system, []);
    cases.get(e.case)!.push(e);
    eventsBySystem.get(e.system)!.push(e);
  }
  const variantBySteps = new Map(
    s.report.paths.map((p, i) => [JSON.stringify(p.steps), i]),
  );
  const systemsByVariant = new Map<number, Map<string, EventRow[]>>();
  const handoffs = new Map<string, string[]>();
  for (const rows of cases.values()) {
    rows.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    );
    const variant = variantBySteps.get(
      JSON.stringify(rows.map((e) => e.activity)),
    );
    if (variant !== undefined) {
      if (!systemsByVariant.has(variant))
        systemsByVariant.set(variant, new Map());
      const systems = systemsByVariant.get(variant)!;
      for (const e of rows) {
        if (!systems.has(e.system)) systems.set(e.system, []);
        systems.get(e.system)!.push(e);
      }
    }
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      if (a.system === b.system) continue;
      const key = JSON.stringify([a.system, b.system]);
      if (!handoffs.has(key)) handoffs.set(key, []);
      const samples = handoffs.get(key)!;
      if (samples.length < 6) samples.push(a.id, b.id);
    }
  }
  return { cases, eventsBySystem, records, systemsByVariant, handoffs };
}

type Index = ReturnType<typeof derive>;
function assemble(
  s: State,
  ix: Index,
  layer: Layer,
  scope: string,
  caseId: string,
): MapData {
  const nodes: MapNode[] = [],
    edges: MapEdge[] = [];
  const systems = s.report.systems.filter(
    (sys) => !scope || scope === sys.name,
  );
  function node(
    id: string,
    x: number,
    y: number,
    kind: Kind,
    title: string,
    detail: string,
    extras: Partial<Entity> = {},
  ) {
    nodes.push({
      id,
      type: "entity",
      position: { x, y },
      ariaLabel: kind + ", " + title,
      data: {
        kind,
        title,
        detail,
        accent: tones[kind],
        evidence: [],
        ...extras,
      },
    });
  }
  function edge(
    source: string,
    target: string,
    label: string,
    description: string,
    evidence: string[],
    status = "Observed",
    offset = 0,
  ) {
    const tone =
      status === "Inferred"
        ? "#9581bb"
        : status === "Proposed"
          ? "#91ad71"
          : "#58838d";
    edges.push({
      id: JSON.stringify([source, target]),
      source,
      target,
      label,
      type: "default",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: tone,
        width: 14,
        height: 14,
      },
      style: {
        stroke: tone,
        strokeWidth: 1.65,
        strokeDasharray: status === "Observed" ? undefined : "5 4",
      },
      labelStyle: { fill: "#c3d2d5", fontSize: 11, fontWeight: 550 },
      labelBgStyle: { fill: "#132025" },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 3,
      sourceHandle: null,
      targetHandle: null,
      zIndex: offset,
      data: { description, evidence, status },
    });
  }
  if (layer === "Events") {
    const rows = ix.cases.get(caseId) ?? [];
    rows.forEach((e, i) => {
      node(e.id, i * 247, (i % 2) * 32, "Event", e.activity, e.system, {
        event: e,
        system: e.system,
        evidence: [e.id],
      });
      if (i)
        edge(
          rows[i - 1].id,
          e.id,
          "",
          "These events are consecutive in case " + e.case + ".",
          [rows[i - 1].id, e.id],
        );
    });
    return { nodes, edges };
  }
  let visible = systems;
  if (scope && layer === "Systems") {
    const neighbours = new Set([scope]);
    s.report.links.forEach((l) => {
      if (l.source === scope) neighbours.add(l.target);
      if (l.target === scope) neighbours.add(l.source);
    });
    visible = s.report.systems.filter((sys) => neighbours.has(sys.name));
  }
  visible.forEach((sys, i) => {
    const rows = ix.eventsBySystem.get(sys.name) ?? [];
    const diamond = [
      [0, 122],
      [277, 0],
      [277, 244],
      [552, 122],
    ];
    const [x, y] =
      layer === "Systems" && visible.length === 4
        ? diamond[i]
        : layer === "Systems"
          ? [(i % 3) * 275, Math.floor(i / 3) * 170 + (i % 2) * 52]
          : [0, i * 141];
    node(
      systemId(sys.name),
      x,
      y,
      "System",
      sys.name,
      ncount(sys.count, "event"),
      { system: sys.name, evidence: rows.slice(0, 3).map((e) => e.id) },
    );
  });
  if (layer === "Systems") {
    s.report.links
      .filter((l) => !scope || l.source === scope || l.target === scope)
      .forEach((l) => {
        const key = JSON.stringify([l.source, l.target]);
        edge(
          systemId(l.source),
          systemId(l.target),
          number(l.count),
          ncount(l.count, "handoff") +
            " from " +
            l.source +
            " to " +
            l.target +
            " across consecutive case events.",
          ix.handoffs.get(key) ?? [],
        );
      });
  } else if (layer === "Ownership") {
    const departments = new Map<string, number>();
    systems.forEach((sys) => {
      const department = ownership[sys.name.toLowerCase()];
      const id = "dept:" + (department ?? "unknown:" + sys.name);
      const evidence = (ix.eventsBySystem.get(sys.name) ?? [])
        .slice(0, 2)
        .map((e) => e.id);
      if (!departments.has(id)) {
        const y = departments.size * 141;
        departments.set(id, y);
        node(
          id,
          355,
          y,
          "Department",
          department ?? "Unassigned",
          department ? "Inferred ownership" : "Owner unknown",
          { system: sys.name, unknown: !department, evidence },
        );
      }
      edge(
        systemId(sys.name),
        id,
        department ? "inferred owner" : "unassigned",
        department
          ? "System naming suggests this functional owner. Department responsibility requires confirmation."
          : "The event records do not identify a department owner.",
        evidence,
        department ? "Inferred" : "Unknown",
      );
    });
  } else if (layer === "Processes") {
    let n = 0;
    s.report.paths.forEach((p, i) => {
      const linked = ix.systemsByVariant.get(i);
      if (!linked || (scope && !linked.has(scope))) return;
      const sample = linked.values().next().value?.[0];
      node(
        processId(i),
        400,
        n++ * 141,
        "Process",
        "Variant " + String(i + 1).padStart(2, "0"),
        ncount(p.count, "case") + " · " + ncount(p.steps.length, "step"),
        {
          variant: i,
          evidence: sample
            ? (ix.cases.get(sample.case) ?? []).slice(0, 3).map((e) => e.id)
            : [],
        },
      );
      systems
        .filter((sys) => linked.has(sys.name))
        .forEach((sys) => {
          const rows = linked.get(sys.name)!;
          edge(
            systemId(sys.name),
            processId(i),
            "",
            sys.name +
              " recorded " +
              ncount(rows.length, "event") +
              " on this path.",
            rows.slice(0, 3).map((e) => e.id),
          );
        });
    });
  } else {
    let n = 0;
    s.report.recommendations.forEach((rec) => {
      const cited = rec.evidence
        .map((id) => ix.records.get(id))
        .filter((e): e is EventRow => !!e);
      if (scope && !cited.some((e) => e.system === scope)) return;
      const id = "rec:" + rec.id;
      node(id, 400, n++ * 141, "Opportunity", rec.title, rec.kind, {
        rec,
        evidence: rec.evidence,
      });
      systems.forEach((sys) => {
        const ids = cited.filter((e) => e.system === sys.name).map((e) => e.id);
        if (ids.length)
          edge(
            systemId(sys.name),
            id,
            "",
            rec.title + " cites records in " + sys.name + ".",
            ids,
            "Proposed",
          );
      });
    });
  }
  return { nodes, edges };
}

const layerSummary: Record<Layer, string> = {
  Systems: "Directed handoffs",
  Ownership: "Inferred functional ownership",
  Processes: "Observed process participation",
  Events: "Chronological case sequence",
  Opportunities: "Evidence-linked recommendations",
};

export default function Twin({
  s,
  selected,
  select,
  onInvestigate,
  onProcess,
  onOpportunity,
  continuous,
  selectedSignal,
  selectedSnapshot,
  onOpenInvestigation,
  onOpenContinuous,
}: HistoricalTwinProps & {
  s: State;
  selected: string;
  select: (system: string) => void;
  onInvestigate: () => void;
  onProcess: (variant: number) => void;
  onOpportunity: (r: Rec) => void;
}) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<"layers" | "records" | "history">(
    selectedSignal || selectedSnapshot ? "history" : "layers",
  );
  const [layer, setLayer] = useState<Layer>("Systems"),
    [scope, setScope] = useState(""),
    [chosenCase, setCase] = useState("");
  const [entity, setEntity] = useState(""),
    [relationship, setRelationship] = useState(""),
    [search, setSearch] = useState("");
  const [instance, setInstance] = useState<ReactFlowInstance<
    MapNode,
    MapEdge
  > | null>(null);
  const ix = useMemo(() => derive(s), [s]);
  const activeScope = s.report.systems.some((x) => x.name === scope)
    ? scope
    : "";
  const caseOptions = useMemo(
    () =>
      Array.from(ix.cases)
        .filter(
          ([, rows]) =>
            !activeScope || rows.some((e) => e.system === activeScope),
        )
        .map(([id]) => id),
    [ix, activeScope],
  );
  const caseId = caseOptions.includes(chosenCase)
    ? chosenCase
    : (caseOptions[0] ?? "");
  const graph = useMemo(
    () => assemble(s, ix, layer, activeScope, caseId),
    [s, ix, layer, activeScope, caseId],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return graph;
    const matches = new Set(
      graph.nodes
        .filter((n) =>
          [n.data.title, n.data.kind, n.data.detail, n.data.event?.case].some(
            (val) => val?.toLowerCase().includes(term),
          ),
        )
        .map((n) => n.id),
    );
    const edges = graph.edges.filter(
      (e) => matches.has(e.source) || matches.has(e.target),
    );
    const visible = new Set(matches);
    edges.forEach((e) => {
      visible.add(e.source);
      visible.add(e.target);
    });
    return { nodes: graph.nodes.filter((n) => visible.has(n.id)), edges };
  }, [graph, search]);
  const picked =
    filtered.nodes.find((n) => n.id === entity) ??
    filtered.nodes.find((n) => n.id === systemId(selected)) ??
    filtered.nodes[0];
  const link = filtered.edges.find((e) => e.id === relationship);
  const item = !link ? picked?.data : undefined;
  const nodes = filtered.nodes.map((n) => ({
    ...n,
    selected: !link && n.id === picked?.id,
  }));
  const evidence = [...new Set(link?.data?.evidence ?? item?.evidence ?? [])];
  const systemEvents =
    item?.kind === "System" ? (ix.eventsBySystem.get(item.title) ?? []) : [];
  const activityCounts = new Map<string, number>();
  systemEvents.forEach((e) =>
    activityCounts.set(e.activity, (activityCounts.get(e.activity) ?? 0) + 1),
  );
  const activities = Array.from(activityCounts).sort((a, b) => b[1] - a[1]);
  const systemRecs =
    item?.kind === "System"
      ? s.report.recommendations.filter((r) =>
          r.evidence.some((id) => ix.records.get(id)?.system === item.system),
        )
      : [];
  const process =
    item?.variant === undefined ? undefined : s.report.paths[item.variant];
  const Icon = item ? icons[item.kind] : Link2;
  const focus = () => {
    const targets = link
      ? nodes.filter((n) => n.id === link.source || n.id === link.target)
      : picked
        ? [picked]
        : [];
    if (targets.length)
      void instance?.fitView({
        nodes: targets,
        maxZoom: 1.4,
        padding: 0.45,
        duration: reduced ? 0 : 230,
      });
  };
  const go = (n: MapNode) => {
    setRelationship("");
    setEntity(n.id);
    if (n.data.system) select(n.data.system);
  };
  const chooseLayer = (v: Layer) => {
    setMode("layers");
    setLayer(v);
    setSearch("");
    setRelationship("");
    setEntity("");
  };
  const investigate = () => {
    if (item?.system) select(item.system);
    onInvestigate();
  };
  const toolbar = (
    <>
      <header className={css.header}>
        <div>
          <span className={css.kicker}>
            <Network size={14} /> Knowledge graph
          </span>
          <h2>Operational twin</h2>
        </div>
        <span className={css.summary}>
          <span />
          {ncount(s.report.systems.length, "system")}
          <i /> {ncount(s.report.events, "event")}
        </span>
      </header>
      <div className={css.layers} role="group" aria-label="Graph layers">
        {layers.map((l) => (
          <button
            key={l}
            aria-pressed={mode === "layers" && layer === l}
            onClick={() => chooseLayer(l)}
          >
            {l}
          </button>
        ))}
        <button
          aria-pressed={mode === "records"}
          onClick={() => setMode("records")}
        >
          Connected records
        </button>
        <button
          aria-pressed={mode === "history"}
          onClick={() => setMode("history")}
        >
          Graph history
        </button>
      </div>
    </>
  );
  if (mode === "history")
    return (
      <section className={css.workbench} aria-label="Business digital twin">
        {toolbar}
        <HistoricalTwin
          key={[s.tenant, selectedSignal, selectedSnapshot].join("/")}
          s={s}
          continuous={continuous}
          selectedSignal={selectedSignal}
          selectedSnapshot={selectedSnapshot}
          onOpenInvestigation={onOpenInvestigation}
          onOpenContinuous={onOpenContinuous}
        />
      </section>
    );
  if (mode === "records")
    return (
      <section className={css.workbench} aria-label="Business digital twin">
        {toolbar}
        <ConnectedRecords s={s} onProcess={onProcess} />
      </section>
    );
  return (
    <section className={css.workbench} aria-label="Business digital twin">
      {toolbar}
      <div className={css.split}>
        <div className={css.visual}>
          <div className={css.filters}>
            <label className={css.search}>
              <Search size={15} />
              <input
                aria-label="Search map entities"
                placeholder="Find an entity…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className={css.filter}>
              <ListFilter size={14} />
              <select
                aria-label="Filter by system"
                value={activeScope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setEntity("");
                  setRelationship("");
                }}
              >
                <option value="">All systems</option>
                {s.report.systems.map((sys) => (
                  <option key={sys.name}>{sys.name}</option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
          </div>
          {layer === "Events" && (
            <label className={css.casePicker}>
              Case{" "}
              <select
                aria-label="Case timeline"
                value={caseId}
                onChange={(e) => {
                  setCase(e.target.value);
                  setEntity("");
                  setRelationship("");
                }}
              >
                {caseOptions.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </label>
          )}
          <div className={css.canvas}>
            {nodes.length ? (
              <ReactFlow<MapNode, MapEdge>
                key={[layer, activeScope, caseId, search].join("|")}
                nodes={nodes}
                edges={filtered.edges}
                nodeTypes={nodeTypes}
                onInit={setInstance}
                fitView
                fitViewOptions={{ padding: 0.16, maxZoom: 1.13 }}
                minZoom={0.06}
                maxZoom={2.7}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesFocusable
                elementsSelectable
                onNodeClick={(_, n) => go(n)}
                onNodeDoubleClick={(_, n) => {
                  go(n);
                  void instance?.fitView({
                    nodes: [n],
                    maxZoom: 1.4,
                    padding: 0.7,
                    duration: reduced ? 0 : 230,
                  });
                }}
                onEdgeClick={(_, e) => setRelationship(e.id)}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#344445" gap={19} size={0.8} />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className={css.empty}>
                {search
                  ? "No entities match this search."
                  : "No linked records in this view."}
              </div>
            )}
            <button
              title="Zoom to the inspected entity or relationship"
              className={css.fit}
              disabled={!nodes.length}
              onClick={focus}
            >
              <Focus size={15} /> Focus
            </button>
          </div>
          <div className={css.caption}>
            <span>
              <span className={css.legendLine} />
              {layerSummary[layer]}
            </span>
            <span>
              {nodes.length} nodes · {filtered.edges.length} links
            </span>
          </div>
        </div>
        <aside className={css.inspector} aria-label="Entity inspector">
          <div className={css.inspectorTools}>
            <div className={css.inspectorLabel}>
              <Layers3 size={13} /> Inspector
            </div>
            {nodes.length > 0 && (
              <label className={css.picker}>
                Select
                <ChevronDown size={12} />
                <select
                  aria-label="Inspect a graph entity or relationship"
                  value={link?.id ?? picked?.id ?? ""}
                  onChange={(e) => {
                    const n = nodes.find((n) => n.id === e.target.value);
                    if (n) go(n);
                    else setRelationship(e.target.value);
                  }}
                >
                  <optgroup label="Entities">
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.data.kind} · {n.data.title}
                      </option>
                    ))}
                  </optgroup>
                  {filtered.edges.length > 0 && (
                    <optgroup label="Relationships">
                      {filtered.edges.map((edge) => (
                        <option key={edge.id} value={edge.id}>
                          {nodes.find((n) => n.id === edge.source)?.data.title}{" "}
                          →{" "}
                          {nodes.find((n) => n.id === edge.target)?.data.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
          </div>
          {!item && !link ? (
            <p>Select an entity on the map to inspect its records.</p>
          ) : (
            <>
              <div
                className={css.identity}
                style={{ "--tone": item?.accent ?? "#99bec7" } as CSSProperties}
              >
                <span>
                  <Icon size={18} />
                </span>
                <div>
                  <small>{item?.kind ?? "Relationship"}</small>
                  <h3>{item?.title ?? link?.data?.status + " link"}</h3>
                </div>
              </div>
              {link?.data && <p>{link.data.description}</p>}
              {item?.kind === "System" && (
                <>
                  <div className={css.measures}>
                    <div>
                      <small>Events</small>
                      <b>{number(systemEvents.length)}</b>
                    </div>
                    <div>
                      <small>Cases</small>
                      <b>
                        {number(new Set(systemEvents.map((e) => e.case)).size)}
                      </b>
                    </div>
                  </div>
                  {activities.length > 0 && (
                    <section className={css.section}>
                      <h4>Frequent activities</h4>
                      {activities.slice(0, 3).map(([key, v]) => (
                        <div className={css.bar} key={key}>
                          <div>
                            <span>{key}</span>
                            <code>{number(v)}</code>
                          </div>
                          <span>
                            <i
                              style={{
                                width: (100 * v) / activities[0][1] + "%",
                              }}
                            />
                          </span>
                        </div>
                      ))}
                    </section>
                  )}
                  {systemRecs.length > 0 && (
                    <section className={css.section}>
                      <h4>Linked opportunities</h4>
                      {systemRecs.map((r) => (
                        <button
                          className={css.rowLink}
                          key={r.id}
                          onClick={() => onOpportunity(r)}
                        >
                          {r.title}
                          <ChevronRight size={13} />
                        </button>
                      ))}
                    </section>
                  )}
                </>
              )}
              {item?.kind === "Department" && (
                <p>
                  {item.unknown
                    ? "The source records do not identify an owner for this system."
                    : "Department ownership is inferred from the system name. Verify it with the team responsible for " +
                      item.system +
                      "."}
                </p>
              )}
              {process && item?.variant !== undefined && (
                <>
                  <p>
                    {ncount(process.count, "case")} followed this exact activity
                    sequence.
                  </p>
                  <ol className={css.steps}>
                    {process.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  <button
                    className={css.action}
                    onClick={() => onProcess(item.variant!)}
                  >
                    <Workflow size={14} /> Explore process
                  </button>
                </>
              )}
              {item?.rec && (
                <>
                  <p>{item.rec.observed}</p>
                  <div className={css.fact}>
                    <span>Decision</span>
                    <b>{item.rec.kind}</b>
                  </div>
                  <div className={css.fact}>
                    <span>Rule confidence</span>
                    <b>{item.rec.confidence}%</b>
                  </div>
                  <button
                    className={css.action}
                    onClick={() => onOpportunity(item.rec!)}
                  >
                    <ScanLine size={14} /> Inspect opportunity
                  </button>
                </>
              )}
              {item?.event && (
                <>
                  <div className={css.fact}>
                    <span>Case</span>
                    <b>{item.event.case}</b>
                  </div>
                  <div className={css.fact}>
                    <span>System</span>
                    <b>{item.event.system}</b>
                  </div>
                  <p>
                    {new Date(item.event.timestamp).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </p>
                </>
              )}
              {evidence.length > 0 && (
                <section className={css.section}>
                  <h4>Source evidence</h4>
                  {evidence.slice(0, 3).map((id) => (
                    <Evidence key={id} id={id} s={s} />
                  ))}
                </section>
              )}
              {(item?.kind === "System" ||
                item?.kind === "Department" ||
                item?.kind === "Event") && (
                <button className={css.action} onClick={investigate}>
                  <Search size={14} /> Investigate system
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
