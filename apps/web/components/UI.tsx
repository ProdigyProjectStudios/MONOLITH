import {
  Activity,
  Radio,
  BrainCircuit,
  Database,
  GitFork,
  Layers3,
  LayoutDashboard,
  Orbit,
  ScanLine,
  type LucideIcon,
} from "lucide-react";
import { type Page } from "../lib/types";
export const menu: { page: Page; icon: LucideIcon }[] = [
  { page: "Overview", icon: LayoutDashboard },
  { page: "Business map", icon: Orbit },
  { page: "Process explorer", icon: GitFork },
  { page: "Opportunities", icon: ScanLine },
  { page: "Technical blueprint", icon: Layers3 },
  { page: "Intelligence studio", icon: BrainCircuit },
  { page: "Continuous intelligence", icon: Radio },
  { page: "Agent activity", icon: Activity },
  { page: "Data sources", icon: Database },
];
export function Tag({
  children,
  color = "neutral",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return <span className={"tag " + color}>{children}</span>;
}
export const number = (v: number) => v.toLocaleString("en-US");
