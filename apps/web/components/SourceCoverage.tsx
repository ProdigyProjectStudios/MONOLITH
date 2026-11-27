"use client";
import { useMemo, useState } from "react";
import { Database } from "lucide-react";
import type { State } from "../lib/types";
import { Evidence } from "./Detail";
import HandoffBackdrop from "./HandoffBackdrop";
import Membrane from "./Membrane";
import css from "./OperationalWork.module.css";

const utcDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
export default function SourceCoverage({
  s,
  id,
  onSource,
}: {
  s: State;
  id: string;
  onSource: (id: string) => void;
}) {
  const source = s.data.sources.find((v) => v.id === id) ?? s.data.sources[0];
  const [picked, pick] = useState("");
  const evidence = useMemo(() => {
    const buckets = new Map<
      string,
      { label: string; count: number; id: string; stamp: number }
    >();
    for (const row of s.data.events) {
      if (row.source !== source?.id) continue;
      const stamp = Date.parse(row.timestamp);
      const day = Number.isFinite(stamp)
        ? new Date(stamp).toISOString().slice(0, 10)
        : "undated";
      const bucket = buckets.get(day) ?? {
        label: day === "undated" ? "Undated" : utcDate.format(stamp),
        count: 0,
        id: row.id,
        stamp,
      };
      bucket.count++;
      if (stamp > bucket.stamp) {
        bucket.id = row.id;
        bucket.stamp = stamp;
      }
      buckets.set(day, bucket);
    }
    const days = Array.from(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, g]) => ({ ...g, key }));
    const docs = s.data.docs
      .filter((d) => d.source === source?.id)
      .sort((a, b) => a.page - b.page);
    return { days, docs, total: days.reduce((sum, d) => sum + d.count, 0) };
  }, [s.data.events, s.data.docs, source?.id]);
  if (!source) return null;
  const { days, docs, total } = evidence;
  const items = [
    ...days.map((day) => ({ ...day, isDate: true })),
    ...docs.map((d) => ({
      isDate: false,
      key: d.id,
      label: "Page " + d.page,
      id: d.id,
      count: 1,
    })),
  ];
  const item = items.find((v) => v.key === picked) ?? items.at(-1);
  const peak = Math.max(1, ...days.map((d) => d.count));
  return (
    <section className={css.coverage} aria-label="Source coverage">
      <div className={css.sourceStage}>
        <HandoffBackdrop warm={false} />
        <div>
          <span className={css.caption}>
            <Database size={14} />
            {source.synthetic ? "Synthetic source" : "Imported source"} ·{" "}
            {source.kind}
          </span>
          <h2>Source coverage</h2>
          <label className={css.picker}>
            Inspect source
            <select
              value={source.id}
              onChange={(e) => {
                pick("");
                onSource(e.target.value);
              }}
            >
              {s.data.sources.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={css.sourceForm}>
          <Membrane
            identity={source.id}
            tone={docs.length ? "violet" : "blue"}
            strength={days.length / 30}
          />
        </div>
      </div>
      <div className={css.coverBody}>
        <div className={css.coverNumbers}>
          <span>
            <strong>{total.toLocaleString("en-GB")}</strong> event rows
          </span>
          <span>
            <strong>{docs.length}</strong> document pages
          </span>
        </div>
        {!!days.length && (
          <div className={css.dayBars} aria-hidden="true">
            {days.slice(-32).map((v) => (
              <i
                key={v.key}
                data-selected={v.key === item?.key}
                style={{ height: Math.max(4, (100 * v.count) / peak) + "%" }}
              />
            ))}
          </div>
        )}
        {!!days.length && (
          <small className={css.caption}>
            {days.length > 32 ? "Last 32 active dates" : "Active dates"} · rows
            per date (UTC)
          </small>
        )}
        {item ? (
          <div className={css.coverEvidence}>
            <label className={css.picker}>
              Source evidence
              <select value={item.key} onChange={(e) => pick(e.target.value)}>
                {items.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                    {v.isDate ? " · " + v.count + " rows" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Evidence key={item.id} s={s} id={item.id} showTime />
          </div>
        ) : (
          <p>No event rows or document pages registered for this source.</p>
        )}
      </div>
    </section>
  );
}
