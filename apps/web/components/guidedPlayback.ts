import type { InvestigationRun, RunEvent } from "../lib/investigations";

export const chapters = [
  { id: "evidence", title: "Source evidence", start: 0, duration: 12 },
  { id: "roles", title: "Specialist handoffs", start: 12, duration: 24 },
  { id: "architectures", title: "Competing designs", start: 36, duration: 14 },
  { id: "simulation", title: "Scenario trials", start: 50, duration: 16 },
  { id: "verification", title: "Verification", start: 66, duration: 12 },
  {
    id: "blueprint",
    title: "Implementation blueprint",
    start: 78,
    duration: 12,
  },
] as const;
export const guideDuration = chapters.at(-1)!.start + chapters.at(-1)!.duration;
export const roles = [
  { id: "discovery", title: "Discovery" },
  { id: "process", title: "Process intelligence" },
  { id: "strategy", title: "Automation strategy" },
  { id: "architect", title: "Solutions architect" },
  { id: "simulation", title: "Simulation" },
  { id: "verification", title: "Verification" },
] as const;
export function playbackPosition(seconds: number) {
  const time = Math.min(
    guideDuration,
    Math.max(0, Number.isFinite(seconds) ? seconds : 0),
  );
  const index = chapters.findLastIndex((c) => time >= c.start);
  const role = Math.min(
    roles.length - 1,
    Math.max(
      0,
      Math.floor(
        (time - chapters[1].start) / (chapters[1].duration / roles.length),
      ),
    ),
  );
  return { time, index, role, ended: time === guideDuration };
}
export function roleTime(index: number) {
  return (
    chapters[1].start +
    (Math.min(roles.length - 1, Math.max(0, index)) * chapters[1].duration) /
      roles.length
  );
}
export function roleReceipts(run: InvestigationRun, stage: string) {
  const events = run.events.filter((event) => event.stage === stage);
  return {
    tools: events.filter((event) => event.kind === "tool_result"),
    handoff: events.find((event) => event.kind === "handoff"),
    complete: events.find((event) => event.kind === "stage_completed"),
  };
}
export function receiptIds(event?: RunEvent) {
  const refs = event?.payload.evidence;
  return Array.isArray(refs)
    ? refs.filter((id): id is string => typeof id === "string")
    : [];
}
export function blueprintChoice(run: InvestigationRun) {
  const result = run.result;
  if (run.status !== "completed" || !result?.verified) return null;
  const id = run.approval?.approach ?? result.selected;
  const approach = result.package.approaches.find(
    (candidate) => candidate.id === id,
  );
  return approach ? { approach, approved: !!run.approval } : null;
}
