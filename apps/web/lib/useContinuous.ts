import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "./types";
import type { ContinuousSnapshot, ContinuousView } from "./continuousTypes";
import {
  appendSyntheticStream,
  readSavedWorkspace,
  post,
  request,
  run as reloadReport,
  server,
} from "./client";
import { localSnapshot, localView, syncLocal } from "./continuousLocal";

export function useContinuous(
  s: State | null,
  setWorkspace: (s: State) => void,
  legacyKey: string,
) {
  const [view, setView] = useState<ContinuousView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const latest = useRef(s),
    active = useRef(0),
    pending = useRef(0),
    channel = useRef<BroadcastChannel | null>(null);
  const stamp = useRef<string | undefined>(undefined),
    observedRevision = useRef(0);
  latest.current = s;
  const run = useCallback(
    async (
      action: "scan" | "refresh" | "resume",
      id?: string,
      workspace?: State,
    ) => {
      const state = workspace ?? latest.current;
      if (!state) return;
      const session = active.current;
      const current = () =>
        session === active.current && state.tenant === latest.current?.tenant;
      const publish = (v: ContinuousView) => {
        if (current()) setView(v);
      };
      pending.current++;
      setBusy(true);
      try {
        if (server) {
          if (action === "scan" && stamp.current) {
            const status = await request("continuous/status");
            if (current() && status.stamp === stamp.current) return;
          }
          const response: ContinuousView =
            action === "refresh"
              ? await post("continuous/refresh", {})
              : action === "resume"
                ? await post(
                    "continuous/investigations/" +
                      encodeURIComponent(id!) +
                      "/resume",
                    {},
                  )
                : await request("continuous");
          const v: ContinuousView = response.monitor
            ? response
            : await request("continuous");
          if (!current()) return;
          const revision = v.snapshot?.revision ?? 0;
          if (revision && observedRevision.current !== revision) {
            const ws = await request("workspace");
            if (
              current() &&
              JSON.stringify(ws.data) !== JSON.stringify(latest.current?.data)
            ) {
              const next = await reloadReport(
                { ...state, ...ws },
                state.report.days,
                false,
              );
              if (current()) setWorkspace(next);
            }
          }
          if (current()) {
            stamp.current = v.stamp;
            observedRevision.current = revision;
            publish(v);
          }
        } else {
          await syncLocal(state, publish, id);
          channel.current?.postMessage("updated");
        }
        if (current()) setError("");
      } catch (e) {
        if (current())
          setError(e instanceof Error ? e.message : "Monitoring failed.");
      } finally {
        pending.current--;
        if (current()) setBusy(pending.current > 0);
      }
    },
    [setWorkspace],
  );
  useEffect(() => {
    stamp.current = undefined;
    observedRevision.current = 0;
    active.current++;
    setView(null);
    setError("");
    if (!s) return;
    if (server) {
      const timer = window.setInterval(() => {
        if (!document.hidden && !pending.current) void run("scan");
      }, 5000);
      return () => {
        active.current++;
        clearInterval(timer);
      };
    }
    const session = active.current,
      bus = new BroadcastChannel("monolith/continuous/" + s.tenant);
    const sources = new BroadcastChannel("monolith/sources/" + s.tenant);
    sources.onmessage = () => {
      void readSavedWorkspace(s.tenant)
        .then((next) => {
          if (
            session === active.current &&
            next &&
            JSON.stringify(next) !== JSON.stringify(latest.current)
          )
            setWorkspace(next);
        })
        .catch((e) => {
          if (session === active.current) setError(e.message);
        });
    };
    channel.current = bus;
    bus.onmessage = () => {
      void localView(s.tenant)
        .then((v) => {
          if (session === active.current) setView(v);
        })
        .catch((e) => {
          if (session === active.current) setError(e.message);
        });
    };
    return () => {
      active.current++;
      bus.close();
      sources.close();
      channel.current = null;
    };
  }, [s?.tenant, run]);
  useEffect(() => {
    if (s) void run("scan");
  }, [s?.data, legacyKey, run]);
  const loadSnapshot = useCallback(
    async (id: string): Promise<ContinuousSnapshot> => {
      if (!latest.current) throw Error("Workspace is loading.");
      return server
        ? request("continuous/snapshots/" + encodeURIComponent(id))
        : localSnapshot(latest.current.tenant, id);
    },
    [],
  );
  async function appendFixture(wave: "backlog" | "recovery" = "backlog") {
    const workspace = latest.current;
    if (!workspace) return;
    setBusy(true);
    try {
      const next = await appendSyntheticStream(workspace, wave);
      if (latest.current?.tenant === next.tenant) {
        setWorkspace(next);
        if (server) await run("refresh", undefined, next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream ingestion failed.");
      setBusy(false);
    }
  }
  return {
    view,
    busy,
    error,
    refresh: () => run("refresh"),
    loadSnapshot,
    resume: (id: string) => run("resume", id),
    appendFixture,
    canAppendFixture: s?.tenant === "northstar",
  };
}
