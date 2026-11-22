export type EventRow = {
  id: string;
  case: string;
  activity: string;
  department?: string;
  timestamp: string;
  system: string;
  source: string;
  row: number | string;
  synthetic: boolean;
};
export type Doc = {
  id: string;
  source: string;
  page: number;
  text: string;
  synthetic: boolean;
};
export type Source = {
  id: string;
  name: string;
  kind: string;
  synthetic: boolean;
};
export type Data = { events: EventRow[]; docs: Doc[]; sources: Source[] };
export type Audit = { action: string; at: string; detail: string };
export type Finding = {
  statement: string;
  evidence: string[];
  limitation: string;
};
export type Rec = {
  id: string;
  title: string;
  area: string;
  action: string;
  kind: string;
  score: number;
  confidence: number;
  cases: number;
  hours: number;
  evidence: string[];
  observed: string;
  inference: string;
  limitations: string;
  dependencies: string[];
  architecture: string[];
  roadmap: string[];
  agent_findings?: Finding[];
};
export type Report = {
  days: number;
  asof: string;
  engine: string;
  mining: string;
  events: number;
  cases: number;
  variants: number;
  cycle: number;
  auto: number;
  series: number[][];
  systems: { name: string; count: number }[];
  links: { source: string; target: string; count: number }[];
  paths: { steps: string[]; count: number }[];
  bottlenecks: {
    first: string;
    last: string;
    hours: number;
    count: number;
    evidence: string[];
  }[];
  recommendations: Rec[];
  case_ids: string[];
  blueprints: Record<
    string,
    { nodes: string[]; phases: string[]; dependencies: string[] }
  >;
  traces: {
    role: string;
    tool: string;
    ms: number;
    status: string;
    finding?: Finding;
  }[];
};
export type State = {
  data: Data;
  report: Report;
  audit: Audit[];
  ai: boolean;
  hubspot: boolean;
  tenant: string;
};
export const pages = [
  "Overview",
  "Business map",
  "Process explorer",
  "Opportunities",
  "Technical blueprint",
  "Intelligence studio",
  "Continuous intelligence",
  "Agent activity",
  "Data sources",
] as const;
export type Page = (typeof pages)[number];
