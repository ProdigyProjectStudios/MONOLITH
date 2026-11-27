"use client";
import { useId, useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  Layers3,
  Link2,
  ListFilter,
  Network,
  ScanLine,
  Search,
  Workflow,
  ArrowUpRight,
  Clock3,
  History,
  ArrowRight,
} from "lucide-react";
import { Evidence } from "./Detail";
import ConnectedRecords from "./ConnectedRecords";
import HistoricalTwin, { type HistoricalTwinProps } from "./HistoricalTwin";
import Topology from "./Topology";
import HandoffBackdrop from "./HandoffBackdrop";
import { number } from "./UI";
import type { Rec, State } from "../lib/types";
import {
  assemble,
  indexWorkspace,
  layers,
  ncount,
  systemId,
  type FieldNode,
  type Layer,
} from "../lib/twinField";
import css from "./Twin.module.css";

const icons = {
  System: Database,
  Department: Building2,
  Process: GitBranch,
  Event: Activity,
  Opportunity: ScanLine,
};
const layerIcons = {
  Systems: Database,
  Ownership: Building2,
  Processes: GitBranch,
  Events: Activity,
  Opportunities: ScanLine,
};
const tones = {
  flow: "#70e4c5",
  pressure: "#efb566",
  investigation: "#ba9bf2",
};
const layerSummary: Record<Layer, string> = {
  Systems: "Directed handoffs",
  Ownership: "Department ownership",
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
  paused = false,
}: HistoricalTwinProps & {
  s: State;
  selected: string;
  select: (system: string) => void;
  onInvestigate: () => void;
  onProcess: (variant: number) => void;
  onOpportunity: (r: Rec) => void;
}) {
  const inspectorId = useId();
  const [mode, setMode] = useState<"layers" | "records" | "history">(
    selectedSignal || selectedSnapshot ? "history" : "layers",
  );
  const [layer, setLayer] = useState<Layer>("Systems"),
    [scope, setScope] = useState(""),
    [chosenCase, setCase] = useState("");
  const [entity, setEntity] = useState(""),
    [relationship, setRelationship] = useState(""),
    [search, setSearch] = useState("");
  const ix = useMemo(() => indexWorkspace(s), [s.data.events, s.report]);
  const longest = s.report.bottlenecks[0];
  const pressureSystems = useMemo(
    () =>
      new Set(
        longest?.evidence
          .map((id) => ix.records.get(id)?.system)
          .filter(Boolean),
      ),
    [longest, ix],
  );
  const investigating = useMemo(() => {
    const active = new Set(
      continuous?.view?.investigations
        .filter(
          (run) =>
            run.snapshot_id === continuous.view?.snapshot?.id &&
            (run.status === "running" || run.status === "queued"),
        )
        .map((run) => run.signal_id),
    );
    return new Set(
      continuous?.view?.signals
        .filter((signal) => active.has(signal.id))
        .flatMap((signal) =>
          signal.evidence.map((id) => ix.records.get(id)?.system),
        )
        .filter(Boolean),
    );
  }, [continuous?.view, ix]);
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
    if (!term) return { ...graph, matches: undefined };
    const matches = new Set(
      graph.nodes
        .filter((n) => {
          const info = n.data;
          if (
            [info.title, info.kind, info.detail, info.event?.case].some((v) =>
              v?.toLowerCase().includes(term),
            )
          )
            return true;
          if (info.variant !== undefined)
            return s.report.paths[info.variant]?.steps.some((step) =>
              step.toLowerCase().includes(term),
            );
          if (info.kind === "System")
            return ix.eventsBySystem
              .get(info.title)
              ?.some(
                (e) =>
                  e.activity.toLowerCase().includes(term) ||
                  e.case.toLowerCase().includes(term),
              );
          return false;
        })
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
    return {
      nodes: graph.nodes.filter((n) => visible.has(n.id)),
      edges,
      matches,
    };
  }, [graph, search, ix, s.report.paths]);
  const picked =
    filtered.nodes.find((n) => n.id === entity) ??
    filtered.nodes.find((n) => filtered.matches?.has(n.id)) ??
    filtered.nodes.find((n) => n.id === systemId(selected)) ??
    filtered.nodes[0];
  const link = filtered.edges.find((e) => e.id === relationship);
  const item = !link ? picked?.data : undefined;
  const nodes = filtered.nodes;
  const fieldNodes = useMemo(
    () =>
      nodes.map((n) => {
        const system = n.data.system;
        const tone =
          system && investigating.has(system)
            ? ("investigation" as const)
            : system && pressureSystems.has(system) && n.data.kind === "System"
              ? ("pressure" as const)
              : ("flow" as const);
        return {
          id: n.id,
          name: n.data.title,
          count: n.data.count,
          detail: n.data.detail,
          tone,
        };
      }),
    [nodes, pressureSystems, investigating],
  );
  const fieldLinks = useMemo(
    () =>
      filtered.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        count: e.count,
        label: e.label,
      })),
    [filtered.edges],
  );
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
  const go = (n: FieldNode) => {
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
  const nodeTitles = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.data.title])),
    [nodes],
  );
  const visibleRelations = useMemo(() => {
    const relations = filtered.edges.slice();
    if (layer !== "Events") relations.sort((a, b) => b.count - a.count);
    return relations;
  }, [filtered.edges, layer]);

  const toolbar = (
    <>
      <header className={css.header}>
        <div>
          <span className={css.kicker}>
            <Network size={13} />{" "}
            {mode === "history"
              ? "Saved graph revisions"
              : mode === "records"
                ? "Linked source records"
                : s.report.days + "-day process map"}
          </span>
          <h2>Operational twin</h2>
        </div>
        {mode === "layers" && (
          <dl className={css.summary} aria-label="Map coverage">
            <div>
              <dt>Systems</dt>
              <dd>{number(s.report.systems.length)}</dd>
            </div>
            <div>
              <dt>Cases</dt>
              <dd>{number(s.report.cases)}</dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{number(s.report.events)}</dd>
            </div>
          </dl>
        )}
      </header>
      <div className={css.layers} role="group" aria-label="Graph layers">
        {layers.map((l) => {
          const LayerIcon = layerIcons[l];
          return <button
            key={l}
            aria-pressed={mode === "layers" && layer === l}
            onClick={() => chooseLayer(l)}
          >
            <LayerIcon size={15} aria-hidden="true" /> {l}
          </button>;
        })}
        <button
          aria-pressed={mode === "records"}
          onClick={() => setMode("records")}
        >
          <Link2 size={15} aria-hidden="true" /> Connected records
        </button>
        <button
          aria-pressed={mode === "history"}
          onClick={() => setMode("history")}
        >
          <History size={15} aria-hidden="true" /> Graph history
        </button>
      </div>
    </>
  );
  if (mode === "history")
    return (
      <section className={css.workbench} aria-label="Business digital twin">
        {toolbar}
        <HistoricalTwin
          paused={paused}
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
            <h3 className={css.fieldTitle}>{layerSummary[layer]}</h3>
            <label className={css.search}>
              <Search size={15} />
              <input
                aria-label="Search map entities"
                placeholder="Find an entity…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setEntity("");
                  setRelationship("");
                }}
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
          <div className={css.canvas} data-paused={paused}>
            <HandoffBackdrop warm={fieldNodes.some((node) => node.tone === "pressure")} />
            {nodes.length ? (
              <Topology
                showTrafficVolume
                key={[layer, activeScope, caseId].join("|")}
                paused={paused}
                systems={fieldNodes}
                links={fieldLinks}
                selected={!link ? picked?.id : undefined}
                selectedLink={link?.id}
                ariaLabel={"Operational twin · " + layer}
                unit="records"
                onSelect={(id) => {
                  const n = nodes.find((item) => item.id === id);
                  if (n) go(n);
                }}
                onSelectLink={setRelationship}
              />
            ) : (
              <div className={css.empty}>
                {search
                  ? "No entities match this search."
                  : "No linked records in this view."}
              </div>
            )}
          </div>
          <div className={css.caption}>
            <span className={css.keys}>
              <span>
                <i className={css.legendLine} />
                Source-linked flow
              </span>
              {fieldNodes.some((n) => n.tone === "pressure") && (
                <span>
                  <i className={css.pressureLine} />
                  Longest interval
                </span>
              )}
              {fieldNodes.some((n) => n.tone === "investigation") && (
                <span>
                  <i className={css.agentLine} />
                  Active investigation
                </span>
              )}
            </span>
            <span>
              {filtered.matches
                ? filtered.matches.size +
                  (filtered.matches.size === 1 ? " match · " : " matches · ")
                : ""}
              {nodes.length} nodes · {filtered.edges.length} links
            </span>
          </div>
          {layer === "Systems" && longest && (
            <div className={css.pressure}>
              <Clock3 size={18} />
              <div>
                <span>Longest median interval</span>
                <strong>
                  {longest.first} <span aria-hidden="true">→</span>{" "}
                  {longest.last}
                </strong>
              </div>
              <div className={css.pressureValue}>
                <b>
                  {longest.hours.toLocaleString("en-GB", {
                    maximumFractionDigits: 2,
                  })}
                  <small> h</small>
                </b>
                <span>{ncount(longest.count, "transition")}</span>
              </div>
              {longest.evidence.some((id) => ix.records.has(id)) && (
                <button
                  type="button"
                  title="Inspect a case behind this interval"
                  aria-label="Inspect the longest median interval"
                  onClick={() => {
                    const row = longest.evidence
                      .map((id) => ix.records.get(id))
                      .find(Boolean);
                    if (row) {
                      chooseLayer("Events");
                      setScope("");
                      setCase(row.case);
                      setEntity(row.id);
                      select(row.system);
                    }
                  }}
                >
                  <ArrowUpRight size={18} />
                </button>
              )}
            </div>
          )}
          {visibleRelations.length > 0 && (
            <section className={css.relations} aria-label="Relationship index">
              <header>
                <h3>{layer === "Events" ? "Case transitions" : "Relationship index"}</h3>
                <span>{ncount(visibleRelations.length, "link")}</span>
              </header>
              <ul>
                {visibleRelations.map((edge) => (
                  <li key={edge.id}>
                    <button
                      type="button"
                      aria-pressed={edge.id === link?.id}
                      aria-controls={inspectorId}
                      onClick={() => {
                        setRelationship(edge.id);
                        document.getElementById(inspectorId)?.focus();
                      }}
                    >
                      <span>{nodeTitles.get(edge.source)}</span>
                      <ArrowRight size={14} aria-label="to" />
                      <span>{nodeTitles.get(edge.target)}</span>
                      <small>{edge.label}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside id={inspectorId} tabIndex={-1} className={css.inspector} aria-label="Entity inspector">
          <div className={css.inspectorTools}>
            <div className={css.inspectorLabel}>
              <Layers3 size={15} /> Evidence inspector
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
                style={
                  {
                    "--tone":
                      tones[
                        !link
                          ? (fieldNodes.find((n) => n.id === picked?.id)
                              ?.tone ?? "flow")
                          : "flow"
                      ],
                  } as CSSProperties
                }
              >
                <span>
                  <Icon size={18} />
                </span>
                <div>
                  <small>{item?.kind ?? "Relationship"}</small>
                  <h3>
                    {item?.title ??
                      [
                        nodes.find((n) => n.id === link?.source)?.data.title,
                        nodes.find((n) => n.id === link?.target)?.data.title,
                      ]
                        .filter(Boolean)
                        .join(" → ")}
                  </h3>
                </div>
              </div>
              {link?.data && (
                <>
                  <p>{link.data.description}</p>
                  <div className={css.fact}>
                    <span>Relationship basis</span>
                    <b>{link.data.status}</b>
                  </div>
                </>
              )}
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
                  {item.ownership === "Observed"
                    ? "Source events explicitly identify this department."
                    : item.ownership === "Unknown"
                      ? "The source records do not identify an owner for this system."
                      : "Department ownership is inferred from system naming and needs confirmation."}
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
              {item?.system && (
                <button className={css.action} onClick={investigate}>
                  <Search size={14} /> Open investigation studio
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
