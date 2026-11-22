import type { GraphEdge, GraphEpoch } from "./continuousTypes";
export const flowLayers = [
  {
    id: "handoff",
    name: "System handoffs",
    source: "Sending system",
    target: "Receiving system",
  },
  {
    id: "precedes",
    name: "Process sequences",
    source: "Preceding activity",
    target: "Following activity",
  },
  {
    id: "observed_in",
    name: "System participation",
    source: "Activity",
    target: "System",
  },
  {
    id: "assigned_to",
    name: "Department assignments",
    source: "System",
    target: "Department",
  },
  {
    id: "instance_of",
    name: "Event records",
    source: "Event",
    target: "Activity",
  },
] as const;
export type FlowLayer = (typeof flowLayers)[number];

export function epochRelationships(
  edges: GraphEdge[],
  epoch: GraphEpoch,
  kind: string,
) {
  const present = new Set(epoch.edge_ids);
  return edges
    .filter((edge) => edge.kind === kind && present.has(edge.id))
    .sort(
      (a, b) =>
        epoch.edge_counts[b.id] - epoch.edge_counts[a.id] ||
        a.id.localeCompare(b.id),
    );
}

export function evidenceEpoch(
  epochs: GraphEpoch[],
  citedIds: string[],
  eventTimes: Map<string, number>,
) {
  const times = citedIds
    .map((id) => eventTimes.get(id))
    .filter((t): t is number => t !== undefined && Number.isFinite(t));
  for (let i = epochs.length - 1; i >= 0; i--) {
    const epoch = epochs[i],
      start = Date.parse(epoch.start),
      end = Date.parse(epoch.end);
    if (times.some((t) => t >= start && t < end)) return epoch.id;
  }
  return undefined;
}

export function visibleFlows(
  edges: GraphEdge[],
  inspectedId: string,
  limit: number,
) {
  const visible = edges.slice(0, limit),
    selected = edges.find((edge) => edge.id === inspectedId);
  if (selected && !visible.includes(selected) && visible.length)
    visible[visible.length - 1] = selected;
  return visible;
}

export function relationshipTrend(epochs: GraphEpoch[], edgeId: string) {
  return epochs.map((epoch) => epoch.edge_counts[edgeId] ?? 0);
}
