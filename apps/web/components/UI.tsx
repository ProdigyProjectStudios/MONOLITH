import {
  Activity,
  BrainCircuit,
  Copy,
  Database,
  GitFork,
  Layers3,
  LayoutDashboard,
  Orbit,
  Route,
  ScanLine,
  ShieldCheck,
  Timer,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { type Page, type Rec } from "../lib/types";
export const menu: { page: Page; icon: LucideIcon }[] = [
  { page: "Overview", icon: LayoutDashboard },
  { page: "Business map", icon: Orbit },
  { page: "Process explorer", icon: GitFork },
  { page: "Opportunities", icon: ScanLine },
  { page: "Technical blueprint", icon: Layers3 },
  { page: "Intelligence studio", icon: BrainCircuit },
  { page: "Agent activity", icon: Activity },
  { page: "Data sources", icon: Database },
];
export const recIcon = (id: string) =>
  ({ refund: Timer, entry: Copy, handoff: Route, review: ShieldCheck })[id] ||
  Workflow;
export const recColor = (id: string) =>
  ({ refund: "lime", entry: "blue", handoff: "violet", review: "orange" })[
    id
  ] || "lime";
export function Mark() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="30"
      height="30"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2 26 13 5h5L7 26zm9 0L22 5h5L16 26zm9 0 7-13 3 13z" />
    </svg>
  );
}
export function Kicker({ children }: { children: React.ReactNode }) {
  return <span className="kicker">{children}</span>;
}
export function Tag({
  children,
  color = "neutral",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return <span className={"tag " + color}>{children}</span>;
}
export function RecGlyph({ r }: { r: Rec }) {
  const Icon = recIcon(r.id);
  return (
    <span className={"rec-glyph " + recColor(r.id)}>
      <Icon size={18} />
    </span>
  );
}
export const number = (v: number) => v.toLocaleString("en-US");
export function Spark({
  values,
  color,
  id,
}: {
  values: number[];
  color: string;
  id: string;
}) {
  const min = Math.min(...values),
    max = Math.max(...values),
    coords = values.map((v, i) => [
      2 + (i * 94) / Math.max(1, values.length - 1),
      32 - ((v - min) / Math.max(1, max - min)) * 24,
    ]);
  const d = coords
    .map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1))
    .join(" ");
  return (
    <svg
      className="spark"
      viewBox="0 0 100 41"
      aria-label="Trend by case completion interval"
      role="img"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop stopColor={color} stopOpacity=".24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={d + " L96 41 H2 Z"} fill={"url(#" + id + ")"} />
      <path
        d={d}
        stroke={color}
        fill="none"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
