"use client";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import styles from "./WorkAreas.module.css";

type StageNode = Node<
  {
    label: string;
    step: number;
    caption?: string;
    pressure: boolean;
    compact: boolean;
    incoming: Position;
    outgoing: Position;
  },
  "stage"
>;

function Stage({ data }: NodeProps<StageNode>) {
  return (
    <div className={data.compact ? styles.verticalStage : styles.stage}>
      <span className={styles.pin} data-pressure={data.pressure || undefined}>
        {String(data.step).padStart(2, "0")}
        <Handle type="target" position={data.incoming} isConnectable={false} />
        <Handle type="source" position={data.outgoing} isConnectable={false} />
      </span>
      <span className={styles.stageText} title={data.label}>
        <strong>{data.label}</strong>
        {data.caption && <small>{data.caption}</small>}
      </span>
    </div>
  );
}

function Route(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } =
    props;
  const turn = sourcePosition === targetPosition;
  const offset = sourcePosition === Position.Left ? -56 : 56;
  const path = turn
    ? `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY}, ${targetX + offset} ${targetY}, ${targetX} ${targetY}`
    : getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        curvature: 0.38,
      })[0];
  return (
    <BaseEdge path={path} style={props.style} markerEnd={props.markerEnd} />
  );
}
const nodeTypes = { stage: Stage };
const edgeTypes = { route: Route };

export function Flow({
  labels,
  blue = false,
  captions = [],
  pressureIndex = -1,
}: {
  labels: string[];
  blue?: boolean;
  captions?: string[];
  pressureIndex?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const compact = width > 0 && width < 536;
  const maxColumns = Math.max(2, Math.floor((width - 32) / 144));
  const rows = compact ? labels.length : Math.ceil(labels.length / maxColumns);
  const columns = compact ? 1 : Math.ceil(labels.length / Math.max(1, rows));
  const height = compact
    ? Math.min(590, Math.max(252, labels.length * 70 + 48))
    : Math.min(520, 232 + Math.max(0, rows - 1) * 116);
  const nodes: StageNode[] = labels.map((label, i) => {
    const row = Math.floor(i / columns),
      column = i % columns;
    const reverse = row % 2 === 1;
    const x = compact ? 0 : (reverse ? columns - 1 - column : column) * 156;
    const arc = 30 * Math.sin((Math.PI * column) / Math.max(1, columns - 1));
    const y = compact ? i * 78 : row * 132 + (reverse ? arc : -arc);
    return {
      id: String(i),
      type: "stage",
      position: { x, y },
      data: {
        label,
        step: i + 1,
        caption: captions[i],
        compact,
        pressure: i === pressureIndex,
        incoming: compact
          ? Position.Top
          : reverse
            ? Position.Right
            : Position.Left,
        outgoing: compact
          ? Position.Bottom
          : reverse
            ? Position.Left
            : Position.Right,
      },
      ariaLabel: `Step ${i + 1}. ${label}`,
      draggable: false,
      selectable: false,
    };
  });
  const edges: Edge[] = labels.slice(1).map((_, i) => {
    const stroke = blue
      ? "#ad93f6"
      : i + 1 === pressureIndex
        ? "#ecb875"
        : "#5fc8bf";
    return {
      id: "e" + i,
      source: String(i),
      target: String(i + 1),
      type: "route",
      selectable: false,
      style: {
        stroke,
        strokeWidth: 1.6,
        strokeDasharray: blue ? "4 4" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: 14,
        height: 14,
      },
    };
  });
  return (
    <div
      ref={host}
      className={`flow ${styles.flow}`}
      data-proposal={blue || undefined}
      role="group"
      aria-label={
        blue ? "Proposed architecture flow" : "Observed process sequence"
      }
      style={{ height }}
    >
      <ol className="screen-reader-text">
        {labels.map((label, i) => (
          <li key={i}>{label}</li>
        ))}
      </ol>
      {width > 0 && (
        <ReactFlow
          key={JSON.stringify([labels, compact, columns])}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{
            nodes:
              labels.length > 20
                ? nodes.slice(0, compact ? 6 : columns * 2)
                : undefined,
            padding: compact ? 0.11 : 0.12,
            maxZoom: compact ? 1.15 : 1.25,
          }}
          minZoom={0.15}
          maxZoom={2.8}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={blue ? "#444050" : "#354745"} gap={21} size={1} />
          <Controls
            showInteractive={false}
            position="bottom-right"
            orientation="horizontal"
          />
        </ReactFlow>
      )}
    </div>
  );
}
