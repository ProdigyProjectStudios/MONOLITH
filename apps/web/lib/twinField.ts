import type { EventRow, Rec, State } from "./types";

export type Kind =
  "System" | "Department" | "Process" | "Event" | "Opportunity";
export const layers = [
  "Systems",
  "Ownership",
  "Processes",
  "Events",
  "Opportunities",
] as const;
export type Layer = (typeof layers)[number];
type Entity = {
  kind: Kind;
  title: string;
  detail: string;
  count: number;
  evidence: string[];
  system?: string;
  variant?: number;
  rec?: Rec;
  event?: EventRow;
  ownership?: "Observed" | "Inferred" | "Unknown";
};
export type FieldNode = { id: string; data: Entity };
type Relation = { description: string; evidence: string[]; status: string };
export type FieldEdge = {
  id: string;
  source: string;
  target: string;
  count: number;
  label: string;
  data: Relation;
};
export const systemId = (name: string) => "system:" + name;
export const ncount = (n: number, unit: string) =>
  n.toLocaleString("en-GB") + " " + unit + (n === 1 ? "" : "s");
const inferredOwners: Record<string, string> = {
  crm: "Customer operations",
  finance: "Finance",
  operations: "Fulfilment",
  support: "Customer support",
};
const refs = (rows: EventRow[]) => rows.slice(0, 3).map((e) => e.id);

export function indexWorkspace(s: State) {
  const caseIds = new Set(s.report.case_ids);
  const cases = new Map<string, EventRow[]>();
  const eventsBySystem = new Map<string, EventRow[]>();
  const records = new Map<string, EventRow>();
  function group(map: Map<string, EventRow[]>, key: string, event: EventRow) {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }
  for (const event of s.data.events) {
    if (!caseIds.has(event.case)) continue;
    records.set(event.id, event);
    group(cases, event.case, event);
    group(eventsBySystem, event.system, event);
  }
  const pathId = new Map(
    s.report.paths.map((p, i) => [JSON.stringify(p.steps), i]),
  );
  const systemsByVariant = new Map<number, Map<string, EventRow[]>>();
  const handoffs = new Map<string, string[]>();
  for (const rows of cases.values()) {
    rows.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    );
    const variant = pathId.get(JSON.stringify(rows.map((r) => r.activity)));
    if (variant !== undefined) {
      if (!systemsByVariant.has(variant))
        systemsByVariant.set(variant, new Map());
      for (const row of rows)
        group(systemsByVariant.get(variant)!, row.system, row);
    }
    for (let i = 1; i < rows.length; i++) {
      const first = rows[i - 1],
        last = rows[i];
      if (first.system === last.system) continue;
      const key = JSON.stringify([first.system, last.system]);
      if (!handoffs.has(key)) handoffs.set(key, []);
      const sample = handoffs.get(key)!;
      if (sample.length < 6) sample.push(first.id, last.id);
    }
  }
  return { cases, eventsBySystem, records, systemsByVariant, handoffs };
}

type SourceIndex = ReturnType<typeof indexWorkspace>;
export function assemble(
  s: State,
  ix: SourceIndex,
  layer: Layer,
  scope: string,
  caseId: string,
) {
  const nodes: FieldNode[] = [],
    edges: FieldEdge[] = [];
  const node = (id: string, data: Entity) => nodes.push({ id, data });
  const edge = (
    source: string,
    target: string,
    count: number,
    label: string,
    description: string,
    evidence: string[],
    status = "Observed",
  ) =>
    edges.push({
      id: JSON.stringify([source, target]),
      source,
      target,
      count,
      label,
      data: { description, evidence, status },
    });
  if (layer === "Events") {
    const rows = ix.cases.get(caseId) ?? [];
    rows.forEach((r, i) => {
      node(r.id, {
        kind: "Event",
        title: r.activity,
        detail: r.system,
        count: 1,
        event: r,
        system: r.system,
        evidence: [r.id],
      });
      if (i)
        edge(
          rows[i - 1].id,
          r.id,
          1,
          "Case sequence",
          "These events are consecutive in case " + r.case + ".",
          [rows[i - 1].id, r.id],
        );
    });
    return { nodes, edges };
  }
  const systems = s.report.systems.filter(
    (sys) => !scope || sys.name === scope,
  );
  const routes = s.report.links.filter(
    (r) => !scope || r.source === scope || r.target === scope,
  );
  const neighbours = new Set([
    scope,
    ...routes.flatMap((r) => [r.source, r.target]),
  ]);
  const visible =
    layer === "Systems" && scope
      ? s.report.systems.filter((sys) => neighbours.has(sys.name))
      : systems;
  for (const sys of visible)
    node(systemId(sys.name), {
      kind: "System",
      title: sys.name,
      count: sys.count,
      detail: ncount(sys.count, "event"),
      system: sys.name,
      evidence: refs(ix.eventsBySystem.get(sys.name) ?? []),
    });
  if (layer === "Systems") {
    for (const r of routes)
      edge(
        systemId(r.source),
        systemId(r.target),
        r.count,
        ncount(r.count, "handoff"),
        ncount(r.count, "handoff") +
          " from " +
          r.source +
          " to " +
          r.target +
          " across consecutive case events.",
        ix.handoffs.get(JSON.stringify([r.source, r.target])) ?? [],
      );
  } else if (layer === "Ownership") {
    const departments = new Map<string, Entity>();
    for (const sys of systems) {
      const byOwner = new Map<string, EventRow[]>();
      const rows = ix.eventsBySystem.get(sys.name) ?? [];
      for (const row of rows) {
        const owner = row.department?.trim() || "";
        if (!byOwner.has(owner)) byOwner.set(owner, []);
        byOwner.get(owner)!.push(row);
      }
      for (const [declared, group] of byOwner) {
        const text = declared || inferredOwners[sys.name.toLowerCase()];
        const origin = declared ? "Observed" : text ? "Inferred" : "Unknown";
        const id = "dept:" + JSON.stringify([text || sys.name, origin]);
        const sample = refs(group);
        const existing = departments.get(id);
        if (existing) {
          existing.count += group.length;
          existing.evidence = [...new Set([...existing.evidence, ...sample])];
          if (existing.system !== sys.name) existing.system = undefined;
        } else {
          const data: Entity = {
            kind: "Department",
            title: text || "Unassigned",
            detail:
              origin === "Unknown"
                ? "Owner unavailable"
                : origin + " ownership",
            count: group.length,
            system: sys.name,
            ownership: origin,
            evidence: sample,
          };
          departments.set(id, data);
          node(id, data);
        }
        edge(
          systemId(sys.name),
          id,
          group.length,
          ncount(group.length, "event"),
          declared
            ? ncount(group.length, "event") +
                " in " +
                sys.name +
                " identify " +
                declared +
                " as the department."
            : text
              ? sys.name +
                " suggests a functional owner. Confirm this assignment with the team responsible."
              : "The records for " + sys.name + " have no named department.",
          sample,
          origin,
        );
      }
    }
  } else if (layer === "Processes") {
    s.report.paths.forEach((p, i) => {
      const group = ix.systemsByVariant.get(i);
      if (!group || (scope && !group.has(scope))) return;
      const sample = group.values().next().value?.[0];
      const id = "process:" + i;
      node(id, {
        kind: "Process",
        title: "Variant " + String(i + 1).padStart(2, "0"),
        detail:
          ncount(p.count, "case") + " · " + ncount(p.steps.length, "step"),
        count: [...group.values()].reduce((sum, rows) => sum + rows.length, 0),
        variant: i,
        evidence: sample ? refs(ix.cases.get(sample.case) ?? []) : [],
      });
      for (const sys of systems) {
        const groupRows = group.get(sys.name);
        if (groupRows)
          edge(
            systemId(sys.name),
            id,
            groupRows.length,
            ncount(groupRows.length, "event"),
            sys.name +
              " recorded " +
              ncount(groupRows.length, "event") +
              " on this path.",
            refs(groupRows),
          );
      }
    });
  } else {
    for (const rec of s.report.recommendations) {
      const cited = rec.evidence
        .map((id) => ix.records.get(id))
        .filter((r): r is EventRow => !!r);
      if (scope && !cited.some((r) => r.system === scope)) continue;
      const id = "rec:" + rec.id;
      node(id, {
        kind: "Opportunity",
        title: rec.title,
        detail: rec.kind,
        count: rec.evidence.length,
        rec,
        evidence: rec.evidence,
      });
      for (const sys of systems) {
        const ids = cited.filter((e) => e.system === sys.name).map((e) => e.id);
        if (ids.length)
          edge(
            systemId(sys.name),
            id,
            ids.length,
            ncount(ids.length, "citation"),
            rec.title + " cites records in " + sys.name + ".",
            ids,
            "Proposed",
          );
      }
    }
  }
  return { nodes, edges };
}
