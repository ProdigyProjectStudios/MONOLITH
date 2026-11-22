"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Database,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { can, post, request, server } from "../lib/client";
import type { State } from "../lib/types";
import { Tag } from "./UI";
import style from "./HubSpotConnection.module.css";

type Status = {
  connected: boolean;
  verified: boolean;
  configured: boolean;
  can_sync: boolean;
  mode: "oauth" | "environment" | "none";
  oauth_available: boolean;
  disabled: boolean;
  environment_available: boolean;
  pending_page: boolean;
  portal_id: string | null;
  scopes: string[];
  redirect_uri?: string | null;
  retry_at?: string | null;
  revocation?: "pending" | "retry_required" | "revoked" | null;
  last_sync: {
    status: string;
    at?: string;
    added?: number;
    error?: string;
  } | null;
  checkpoint: string | number | null;
};
const route = "connectors/hubspot/";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "The connector is unavailable.";
const date = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
};

export default function HubSpotConnection({
  s,
  busy,
  sync,
}: {
  s: State;
  busy: boolean;
  sync: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [working, setWorking] = useState(""),
    [error, setError] = useState("");
  const [launch, setLaunch] = useState(""),
    [confirm, setConfirm] = useState(false);
  const sequence = useRef(0);
  const mayManage = can(s, "connectors:manage");
  const refresh = useCallback(async () => {
    if (!server || !mayManage) return;
    const turn = ++sequence.current;
    try {
      const next = (await request(route + "status")) as Status;
      if (turn !== sequence.current) return;
      setStatus(next);
      setError("");
      if (next.verified) setLaunch("");
    } catch (e) {
      if (turn === sequence.current) setError(message(e));
    }
  }, [mayManage]);
  useEffect(() => {
    setStatus(null);
    setLaunch("");
    setConfirm(false);
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      sequence.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, s.tenant]);
  const perform = async (name: string, fn: () => Promise<void>) => {
    if (working || busy) return;
    setWorking(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking("");
    }
  };
  const connect = async () => {
    const result = await post(route + "oauth/start", {});
    const url = new URL(result.authorization_url, server);
    if (url.origin !== new URL(server!).origin)
      throw Error("The authorisation launch URL does not match this API.");
    setLaunch(url.href);
  };
  const disabled = busy || !!working;
  const last = status?.last_sync;
  const revoked = status?.revocation === "revoked";
  const revoking =
    status?.revocation === "pending" || status?.revocation === "retry_required";
  useEffect(() => {
    if (!status?.retry_at) return;
    const remaining = Date.parse(status.retry_at) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(() => void refresh(), remaining + 250);
    return () => window.clearTimeout(timer);
  }, [status?.retry_at, refresh]);
  const label = !server
    ? "Browser workspace"
    : !mayManage
      ? "Administrator access"
      : !status
        ? "Status unavailable"
        : revoking
          ? "Revocation pending"
          : revoked
            ? "Grant revoked"
            : status.verified
              ? "Verified account"
              : status.disabled
                ? "Disconnected"
                : status.can_sync
                  ? "Credentials configured"
                  : "Not connected";
  return (
    <section
      className={"panel block " + style.section}
      aria-label="HubSpot connection"
    >
      <div className="section-eyebrow">
        <Link2 size={13} /> READ-ONLY CONNECTOR
      </div>
      <div className="inline-head">
        <h2>HubSpot deals</h2>
        <Tag color={status?.verified ? "lime" : "neutral"}>{label}</Tag>
      </div>
      {!server ? (
        <p className="muted">
          Connect a MONOLITH API below to authorise a CRM account and import
          deal observations.
        </p>
      ) : !mayManage ? (
        <p className="muted">A workspace administrator manages this connection.</p>
      ) : (
        <>
          <p className="muted">
            {revoking ? "The existing grant is suspended in this workspace." : status?.verified
              ? "HubSpot account " +
                status.portal_id +
                " · " +
                (status.mode === "oauth"
                  ? "Workspace OAuth"
                  : "Server credentials")
              : status?.can_sync
                ? "Sync deals to verify the configured account and retrieve source records."
                : status?.oauth_available
                  ? "Authorise deal reads for this workspace in HubSpot."
                  : "Configure a HubSpot OAuth app or read-only token on the API."}
          </p>
          {last && (
            <dl className={style.grid}>
              <div>
                <dt>Last sync</dt>
                <dd>{last.status}</dd>
              </div>
              {last.added != null && (
                <div>
                  <dt>Records added</dt>
                  <dd>{last.added}</dd>
                </div>
              )}
              {last.at && (
                <div>
                  <dt>Sync time</dt>
                  <dd>{date(last.at)}</dd>
                </div>
              )}
            </dl>
          )}
          {revoking && (
            <p className={style.hint}>Sync is paused until HubSpot confirms revocation. You can retry the provider request.</p>
          )}
          {status?.retry_at && (
            <p className={style.hint}>HubSpot allows another sync after {date(status.retry_at)}.</p>
          )}
          {last?.error && (
            <p className="runtime-error" role="status">
              {last.error}
            </p>
          )}
          {(status?.scopes?.length ?? 0) > 0 && (
            <div className={style.scopes}>
              <span>Scopes</span>
              {status!.scopes.map((scope) => (
                <code key={scope}>{scope}</code>
              ))}
            </div>
          )}
          <div className={style.actions}>
            {mayManage && status?.oauth_available && !revoking && !status.verified && !launch && (
              <button
                className="btn primary"
                disabled={disabled}
                onClick={() => void perform("connect", connect)}
              >
                <Link2 size={14} />
                Connect HubSpot
              </button>
            )}
            {mayManage && launch && (
              <a
                href={launch}
                target="_blank"
                rel="noopener noreferrer"
                className="btn primary"
              >
                Continue to HubSpot <ExternalLink size={13} />
              </a>
            )}
            {mayManage && status?.can_sync && (
              <button
                className="btn primary"
                disabled={disabled || !!status.retry_at && Date.parse(status.retry_at) > Date.now()}
                onClick={() =>
                  void perform("sync", async () => {
                    try {
                      await sync();
                    } finally {
                      await refresh();
                    }
                  })
                }
              >
                {working === "sync" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Database size={14} />
                )}{" "}
                {status?.pending_page ? "Continue sync" : "Sync deals"}
              </button>
            )}
            {mayManage && status?.disabled && status.environment_available && (
              <button
                className="btn"
                disabled={disabled}
                onClick={() =>
                  void perform("enable", async () => {
                    await post(route + "enable", {});
                    await refresh();
                  })
                }
              >
                Enable server credentials
              </button>
            )}
            <button
              className="btn"
              disabled={disabled}
              onClick={() => void perform("refresh", refresh)}
            >
              <RefreshCw size={13} /> Refresh status
            </button>
            {mayManage && (status?.can_sync || revoking) && !confirm && (
              <button
                className="text-btn"
                disabled={disabled}
                onClick={() => setConfirm(true)}
              >
                <Unplug size={14} />
                Disconnect
              </button>
            )}
          </div>
          {mayManage && launch && (
            <p className={style.hint}>
              Finish authorisation in the new tab, then return here to check the
              account.
            </p>
          )}
          {mayManage && confirm && (
            <div className={style.confirm}>
              <p>
                Disconnect removes the credential from this workspace. Source history stays available.
                {status?.mode === "oauth" && " Revoke also asks HubSpot to invalidate the refresh grant."}
              </p>
              <button
                className="btn"
                disabled={disabled}
                onClick={() =>
                  void perform("disconnect", async () => {
                    await post(route + "disconnect", {});
                    setConfirm(false);
                    setLaunch("");
                    await refresh();
                  })
                }
              >
                Disconnect account
              </button>
              {status?.mode === "oauth" && (
                <button
                  className="btn"
                  disabled={disabled}
                  onClick={() =>
                    void perform("revoke", async () => {
                      try {
                        await post(route + "revoke", {});
                        setConfirm(false);
                        setLaunch("");
                      } finally {
                        await refresh();
                      }
                    })
                  }
                >
                  Revoke HubSpot grant
                </button>
              )}
              <button className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="runtime-error">
          {error}
        </p>
      )}
    </section>
  );
}
