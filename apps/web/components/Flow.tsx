"use client";
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
export function Flow({
  labels,
  blue = false,
}: {
  labels: string[];
  blue?: boolean;
}) {
  const nodes: Node[] = labels.map((label, i) => ({
    id: String(i),
    position: { x: i * 210, y: (i % 2) * 48 },
    data: { label },
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    style: {
      width: 165,
      background: "#23272a",
      border: "1px solid " + (i === labels.length - 1 ? "#789458" : "#4b5454"),
      borderRadius: 8,
      color: "#e9edeb",
      fontSize: 13,
      padding: 14,
      fontFamily: "inherit",
    },
  }));
  const edges: Edge[] = labels.slice(1).map((_, i) => ({
    id: "e" + i,
    source: String(i),
    target: String(i + 1),
    type: "smoothstep",
    style: { stroke: blue ? "#ad9ce6" : "#a8ca83", strokeWidth: 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: blue ? "#ad9ce6" : "#a8ca83",
    },
  }));
  return (
    <div className="flow">
      <ReactFlow
        key={labels.join("|")}
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#3a4042" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
