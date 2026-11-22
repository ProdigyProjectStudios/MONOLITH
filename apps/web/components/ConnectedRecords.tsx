"use client";
import { useEffect, useState } from "react";
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  ExternalLink,
  Fingerprint,
  GitBranch,
  History,
  Link2,
  Search,
} from "lucide-react";
import { Evidence } from "./Detail";
import { server } from "../lib/client";
import {
  linkedVariant,
  loadDeal,
  loadDeals,
  pageSize,
  type Correlation,
  type Deal,
  type DealDetail,
} from "../lib/correlations";
import type { State } from "../lib/types";
import css from "./ConnectedRecords.module.css";

const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
function Citations({ ids, s }: { ids: string[]; s: State }) {
  return (
    <div className={css.citations}>
      {ids.map((id) =>
        s.data.events.some((e) => e.id === id) ? (
          <Evidence key={id} id={id} s={s} />
        ) : (
          <code key={id}>{id}</code>
        ),
      )}
    </div>
  );
}

function Claims({
  items,
  s,
  hypothesis,
}: {
  items: Correlation[];
  s: State;
  hypothesis?: boolean;
}) {
  const [visible, setVisible] = useState(5);
  const Icon = hypothesis ? CircleHelp : Link2;
  return (
    <div className={css.claims}>
      <h4>
        <Icon size={15} />
        {hypothesis ? "Hypotheses to verify" : "Exact source-key matches"}
        <b>{items.length}</b>
      </h4>
      {items.length === 0 && (
        <p className={css.muted}>
          {hypothesis
            ? "No additional evidence-backed candidates."
            : "No operational rows have a qualifying source key."}
        </p>
      )}
      {items.slice(0, visible).map((item) => (
        <details key={item.evidence.join("|")} className={css.claim}>
          <summary>
            <span>
              <strong>{item.activity}</strong>
              <small>
                {item.system} · {item.case_id}
              </small>
            </span>
            <em>{item.rule}</em>
            <ChevronDown size={13} />
          </summary>
          <div>
            <p>{item.basis}</p>
            <Citations ids={item.evidence} s={s} />
          </div>
        </details>
      ))}
      {visible < items.length && (
        <button
          className={css.button}
          onClick={() => setVisible((v) => v + 10)}
        >
          Show more
        </button>
      )}
    </div>
  );
}
function DealInspector({
  s,
  deal,
  detail,
  onProcess,
}: {
  s: State;
  deal: Deal;
  detail: DealDetail;
  onProcess: (i: number) => void;
}) {
  const [section, setSection] = useState("Relationships"),
    [historyLimit, setHistoryLimit] = useState(8);
  return (
    <article className={css.detail}>
      <div className={css.detailHead}>
        <div className={css.object}>
          <span>
            <Fingerprint size={21} />
          </span>
          <div>
            <small>HubSpot deal</small>
            <h3>Deal {deal.object_id}</h3>
          </div>
        </div>
        {deal.record_url && (
          <a
            className={css.button}
            href={deal.record_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Source record <ExternalLink size={13} />
          </a>
        )}
      </div>
      <dl className={css.fields}>
        <div>
          <dt>Portal ID</dt>
          <dd>{deal.portal_id ?? "Unknown · legacy sync"}</dd>
        </div>
        <div>
          <dt>Latest stage ID</dt>
          <dd>{deal.stage}</dd>
        </div>
        <div>
          <dt>Canonical case</dt>
          <dd>{deal.case_id}</dd>
        </div>
        <div>
          <dt>Source ID</dt>
          <dd>{deal.source_id}</dd>
        </div>
        {deal.case_reference && (
          <div>
            <dt>{deal.case_property}</dt>
            <dd>{deal.case_reference}</dd>
          </div>
        )}
      </dl>
      <div className={css.subnav} role="group" aria-label="Deal details">
        {["Relationships", "Snapshots", "Process cases"].map((label) => (
          <button
            key={label}
            aria-pressed={section === label}
            onClick={() => setSection(label)}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "Relationships" ? (
        <>
          {!deal.portal_id && (
            <p className={css.notice}>
              This older sync preserved the deal ID without a portal ID.
              Account-scoped correlation requires a verified snapshot.
            </p>
          )}
          <Claims items={detail.matches} s={s} />
          <Claims items={detail.hypotheses} s={s} hypothesis />
        </>
      ) : section === "Snapshots" ? (
        <section className={css.hist}>
          <h4>
            <History size={15} />
            Observed snapshot history <b>{detail.history.length}</b>
          </h4>
          <p className={css.muted}>
            Each timestamp is the deal modification time reported by HubSpot.
            Stage transitions between syncs may be absent.
          </p>
          {[...detail.history]
            .reverse()
            .slice(0, historyLimit)
            .map((obs) => (
              <div className={css.obs} key={obs.event_id}>
                <div>
                  <span />
                  {obs.stage}
                </div>
                <time dateTime={obs.modified_at}>{date(obs.modified_at)}</time>
                {obs.case_property && (
                  <small>
                    {obs.case_property} = {obs.case_reference}
                  </small>
                )}
                <Citations ids={[obs.event_id]} s={s} />
              </div>
            ))}
          {historyLimit < detail.history.length && (
            <button
              className={css.button}
              onClick={() => setHistoryLimit((v) => v + 10)}
            >
              Earlier observations
            </button>
          )}
        </section>
      ) : (
        <section className={css.hist}>
          <h4>
            <GitBranch size={15} />
            Operational cases <b>{detail.processes.length}</b>
          </h4>
          {!detail.processes.length && (
            <p className={css.muted}>
              No case has a directly linked operational record.
            </p>
          )}
          {detail.processes.map((process) => {
            const index = linkedVariant(s, process);
            return (
              <details className={css.process} key={process.case_id}>
                <summary>
                  <strong>{process.case_id}</strong>
                  <span>{process.steps.length} events</span>
                  <ChevronDown size={13} />
                </summary>
                <p className={css.muted}>
                  Ordered operational records for this case. Verify deal
                  participation for events without a direct key.
                </p>
                <ol>
                  {process.steps.map((step, i) => (
                    <li key={i}>
                      {step}
                      <Citations ids={[process.evidence[i]]} s={s} />
                    </li>
                  ))}
                </ol>
                {index >= 0 && (
                  <button
                    className={css.button}
                    onClick={() => onProcess(index)}
                  >
                    <GitBranch size={14} /> Open process variant
                  </button>
                )}
              </details>
            );
          })}
        </section>
      )}
    </article>
  );
}

export default function ConnectedRecords({
  s,
  onProcess,
}: {
  s: State;
  onProcess: (index: number) => void;
}) {
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [chosen, setChosen] = useState(""),
    [revision, retry] = useState(0);
  const [reply, setReply] = useState<{ items: Deal[]; total: number } | null>(
      null,
    ),
    [detail, setDetail] = useState<DealDetail | null>(null);
  const [listError, setListError] = useState(""),
    [detailError, setDetailError] = useState("");
  const key =
    reply?.items.find((i) => i.key === chosen)?.key ??
    reply?.items[0]?.key ??
    "";
  const deal = reply?.items.find((i) => i.key === key);
  useEffect(() => {
    const c = new AbortController();
    setReply(null);
    setListError("");
    if (!server) {
      setReply({ items: [], total: 0 });
      return () => c.abort();
    }
    const timer = setTimeout(
      () => {
        void loadDeals(query, offset, c.signal)
          .then((data) => {
            if (!c.signal.aborted) setReply(data);
          })
          .catch((e) => {
            if (!c.signal.aborted)
              setListError(
                e instanceof Error ? e.message : "Could not read synced deals.",
              );
          });
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, offset, revision, s.data, s.tenant]);
  useEffect(() => {
    const c = new AbortController();
    setDetail(null);
    setDetailError("");
    if (key && server)
      void loadDeal(key, c.signal)
        .then((data) => {
          if (!c.signal.aborted) setDetail(data);
        })
        .catch((e) => {
          if (!c.signal.aborted)
            setDetailError(
              e instanceof Error ? e.message : "Could not read deal evidence.",
            );
        });
    return () => c.abort();
  }, [key, revision, s.tenant, s.data]);
  const failure = (message: string) => (
    <div role="alert" className={css.empty}>
      <h3>Source records unavailable</h3>
      <p>{message}</p>
      <button className={css.button} onClick={() => retry((v) => v + 1)}>
        Retry
      </button>
    </div>
  );
  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <div>
          <span className={css.kicker}>
            <Database size={13} /> HubSpot · All sync history
          </span>
          <h3>Connected records</h3>
        </div>
        {server && (
          <label className={css.search}>
            <Search size={14} />
            <input
              aria-label="Search deals by ID, reference or stage"
              placeholder="Find a deal, stage or reference…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        )}
      </div>
      {listError ? (
        failure(listError)
      ) : !reply ? (
        <p role="status" className={css.loading}>
          Reading synced records…
        </p>
      ) : !reply.items.length ? (
        <div className={css.empty}>
          <span>
            <Boxes size={23} />
          </span>
          <h3>{query ? "No matching deals" : "No synced HubSpot deals"}</h3>
          <p>
            {query
              ? "Try a portal ID, deal ID, stage or configured case reference."
              : server
                ? "Deal identity, observed snapshots and operational relationships will appear after a successful read-only sync."
                : "Connect a FastAPI workspace and sync HubSpot deals to inspect their source evidence."}
          </p>
          {query ? (
            <button
              className={css.button}
              onClick={() => {
                setQuery("");
                setOffset(0);
              }}
            >
              Clear search
            </button>
          ) : (
            <a className={css.button} href="#data-sources">
              <Database size={14} /> Data sources
            </a>
          )}
        </div>
      ) : (
        <div className={css.body}>
          <aside className={css.roster}>
            <h4>
              Observed deals <b>{reply.total}</b>
            </h4>
            {reply.items.map((d) => (
              <button
                key={d.key}
                aria-pressed={key === d.key}
                onClick={() => setChosen(d.key)}
              >
                <span>
                  <strong>Deal {d.object_id}</strong>
                  <small>
                    {d.portal_id ? "Portal " + d.portal_id : "Legacy sync"} ·{" "}
                    {d.observations} snapshot{d.observations === 1 ? "" : "s"}
                  </small>
                </span>
                {key === d.key && <Check size={13} />}
              </button>
            ))}
            {reply.total > pageSize && (
              <div className={css.pager}>
                <button
                  aria-label="Previous deals"
                  disabled={!offset}
                  onClick={() => setOffset((x) => Math.max(0, x - pageSize))}
                >
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {offset + 1}–{offset + reply.items.length}
                </span>
                <button
                  aria-label="Next deals"
                  disabled={offset + reply.items.length >= reply.total}
                  onClick={() => setOffset((x) => x + pageSize)}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </aside>
          {detailError ? (
            failure(detailError)
          ) : deal && detail && detail.history[0]?.key === deal.key ? (
            <DealInspector
              key={deal.key}
              deal={deal}
              detail={detail}
              s={s}
              onProcess={onProcess}
            />
          ) : (
            <p role="status" className={css.loading}>
              Reading deal evidence…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
