"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { request, server } from "../lib/client";
import styles from "./RuntimeReadiness.module.css";

type Readiness = {
  queue: { mode: "rq" | "inline"; status: string; pending: number | null };
  worker: {
    status: string;
    active: number | null;
    provider_configured: number | null;
    reported: number;
  };
  provider: {
    calls_enabled?: boolean;
    configured: boolean;
    source: "environment" | "file" | "none";
    status: string;
    model: string;
    verification: string;
    last_response: { run_id: string; at: string; model: string } | null;
  };
  budget: {
    max_calls: number;
    max_output_tokens: number;
    per_call_max_output_tokens: number;
  } | null;
};

export default function RuntimeReadiness({ tenant }: { tenant: string }) {
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<{ data?: Readiness; error?: string }>({});
  useEffect(() => {
    if (!server) return;
    let current = true;
    setView({});
    void request("runtime/readiness")
      .then((data: Readiness) => {
        if (current) setView({ data });
      })
      .catch((e: Error) => {
        if (current) setView({ error: e.message });
      });
    return () => {
      current = false;
    };
  }, [attempt, tenant]);
  if (!server) return null;
  const d = view.data;
  return (
    <section className={styles.diagnostics} aria-label="Runtime readiness">
      <header>
        <h3>
          <Activity size={16} /> Runtime readiness
        </h3>
        <button
          className="text-btn"
          type="button"
          onClick={() => setAttempt((v) => v + 1)}
        >
          <RefreshCw size={13} /> Check runtime
        </button>
      </header>
      {!d ? (
        <p role="status">
          {view.error
            ? "Diagnostics unavailable. " + view.error
            : "Checking the API and worker…"}
        </p>
      ) : (
        <>
          <dl>
            <div>
              <dt>Job queue</dt>
              <dd>
                {d.queue.mode === "inline"
                  ? "In-process"
                  : d.queue.status === "reachable"
                    ? "Redis online"
                    : "Redis unavailable"}
              </dd>
              {d.queue.pending !== null && (
                <small>{d.queue.pending} waiting</small>
              )}
            </div>
            <div>
              <dt>Worker</dt>
              <dd>
                {d.worker.status === "in_process"
                  ? "In-process"
                  : d.worker.status === "online"
                    ? d.worker.active + " online"
                    : d.worker.status === "offline"
                      ? "Offline"
                      : "Unknown"}
              </dd>
              {d.worker.provider_configured !== null &&
                d.queue.mode === "rq" && (
                  <small>
                    {d.worker.provider_configured} reporting model credentials
                  </small>
                )}
            </div>
            <div>
              <dt>API model credentials</dt>
              <dd>
                {d.provider.configured
                  ? d.provider.source === "file"
                    ? "Secret file"
                    : "Environment"
                  : d.provider.status === "invalid"
                    ? "Invalid configuration"
                    : "Missing"}
              </dd>
              <small>
                {d.provider.calls_enabled === false
                  ? "Model calls disabled · "
                  : ""}
                {d.provider.model}
              </small>
            </div>
            <div>
              <dt>Workspace OpenAI receipt</dt>
              <dd>
                {d.provider.verification === "observed_response" &&
                d.provider.last_response
                  ? "Response recorded"
                  : "Unverified"}
              </dd>
              {d.provider.last_response && (
                <small>
                  {new Date(d.provider.last_response.at).toLocaleString(
                    "en-GB",
                    { timeZone: "UTC" },
                  )}{" "}
                  UTC
                </small>
              )}
            </div>
          </dl>
          {d.budget && (
            <p>
              Per investigation · {d.budget.max_calls} model calls ·{" "}
              {d.budget.max_output_tokens.toLocaleString("en-GB")} output tokens
              · {d.budget.per_call_max_output_tokens.toLocaleString("en-GB")}{" "}
              maximum per call
            </p>
          )}
        </>
      )}
    </section>
  );
}
