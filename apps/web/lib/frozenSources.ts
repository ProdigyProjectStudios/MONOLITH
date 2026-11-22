import { useEffect, useState } from "react";
import { request, server } from "./client";
import { localInputs } from "./continuousLocal";
import { getSnapshot } from "./investigations";
import type { Data, State } from "./types";

const cache = new Map<string, Promise<Data>>();
const empty: Data = { events: [], sources: [], docs: [] };
export function useFrozenSources(
  workspace: State,
  id?: string,
  studio = false,
) {
  const key = id
    ? JSON.stringify([server || "browser", workspace.tenant, studio, id])
    : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    data?: Data;
    error?: string;
  }>();
  useEffect(() => {
    if (!key || !id) return;
    let current = true;
    let operation = cache.get(key);
    if (!operation) {
      operation = studio
        ? getSnapshot(workspace, id).then((s) => s.data)
        : server
          ? request(
              "continuous/snapshots/" + encodeURIComponent(id) + "/records",
            )
          : localInputs(workspace.tenant, id);
      cache.set(key, operation!);
      if (cache.size > 6) cache.delete(cache.keys().next().value!);
    }
    operation!
      .then((data) => {
        if (current) setLoaded({ key, data });
      })
      .catch(() => {
        cache.delete(key);
        if (current)
          setLoaded({
            key,
            error: "The evidence for this revision could not be loaded.",
          });
      });
    return () => {
      current = false;
    };
  }, [key, id, studio]);
  const value = loaded?.key === key ? loaded : undefined;
  return {
    workspace: id ? { ...workspace, data: value?.data ?? empty } : workspace,
    loading: !!id && !value,
    error: value?.error,
  };
}
