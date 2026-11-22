import { useEffect, useRef, useState } from "react";
import type { State } from "./types";
import { server } from "./client";
import {
  approveApproach,
  getSnapshot,
  listRuns,
  resumeRun,
  startRun,
  watchRun,
  type InvestigationRun,
} from "./investigations";

export function useInvestigation(
  workspace: State | null,
  reportError: (error: string) => void,
) {
  const [runs, setRuns] = useState<InvestigationRun[]>([]),
    [run, setRun] = useState<InvestigationRun | null>(null);
  const [id, setId] = useState(""),
    [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<{ id: string; data: State } | null>(
    null,
  );
  const lock = useRef(false),
    currentId = useRef(""),
    context = useRef(workspace);
  context.current = workspace;
  const scope = workspace ? (server || "browser") + "/" + workspace.tenant : "";
  const storageKey = "monolith-investigation/" + scope;
  const choose = (next: string) => {
    currentId.current = next;
    setId(next);
    sessionStorage.setItem(storageKey, next);
  };
  function remember(next: InvestigationRun) {
    setRun(next);
    setRuns((old) =>
      [next, ...old.filter((r) => r.id !== next.id)].sort((a, b) =>
        b.created.localeCompare(a.created),
      ),
    );
  }
  useEffect(() => {
    const s = context.current;
    if (!s) return;
    let ignore = false;
    currentId.current = "";
    setRun(null);
    setId("");
    setRuns([]);
    listRuns(s)
      .then((history) => {
        if (ignore || currentId.current) return;
        setRuns(history);
        const stored = sessionStorage.getItem(storageKey);
        const first = history.find((r) => r.id === stored) || history[0];
        if (first) choose(first.id);
      })
      .catch((e) => {
        if (!ignore) reportError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [scope, storageKey, reportError]);
  useEffect(() => {
    const s = context.current;
    if (!s || !id) return;
    const controller = new AbortController();
    void getSnapshot(s, id)
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot({ id, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) reportError(e.message);
      });

    void watchRun(
      s,
      id,
      (r) => {
        if (!controller.signal.aborted && id === currentId.current) remember(r);
      },
      controller.signal,
    ).catch((e) => {
      if (!controller.signal.aborted) reportError(e.message);
    });
    return () => controller.abort();
  }, [scope, id, reportError]);
  async function perform(task: (s: State) => Promise<InvestigationRun>) {
    const s = context.current;
    if (!s || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const next = await task(s);
      choose(next.id);
      remember(next);
    } catch (e) {
      reportError(
        e instanceof Error ? e.message : "Investigation operation failed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    runs,
    run,
    snapshot: snapshot && snapshot.id === id ? snapshot.data : undefined,
    busy,
    choose: (rid: string) => {
      if (rid !== id) {
        setRun(null);
        choose(rid);
      }
    },
    start: () => perform(startRun),
    resume: () => perform((s) => resumeRun(s, id)),
    approve: (approach: string) =>
      perform((s) => approveApproach(s, id, approach)),
  };
}
