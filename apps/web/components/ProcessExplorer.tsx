"use client";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, GitBranch, Pause, Play } from "lucide-react";
import { Evidence } from "./Detail";
import { number } from "./UI";
import HandoffBackdrop from "./HandoffBackdrop";
import ProcessRibbon from "./ProcessRibbon";
import type { EventRow, State } from "../lib/types";
import css from "./ProcessExplorer.module.css";

const gap = (a: EventRow, b: EventRow) => {
  const hours = (Date.parse(b.timestamp) - Date.parse(a.timestamp)) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
};
const fmt = (n: number | null) =>
  n === null ? "—" : number(Number(n.toFixed(2))) + " h";
type Variant = State["report"]["paths"][number];
type Motion = { paused: boolean; togglePause: () => void };

function VariantView({
  s,
  path,
  index,
  choose,
  paused,
  togglePause,
}: Motion & {
  s: State;
  path: Variant;
  index: number;
  choose: (index: number) => void;
}) {
  const matching = useMemo(() => {
    const groups = new Map<string, EventRow[]>(),
      ids = new Set(s.report.case_ids);
    for (const e of s.data.events) {
      if (!ids.has(e.case)) continue;
      const rows = groups.get(e.case);
      if (rows) rows.push(e);
      else groups.set(e.case, [e]);
    }
    return [...groups]
      .filter(([, rows]) => {
        if (rows.length !== path.steps.length) return false;
        rows.sort(
          (a, b) =>
            a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
        );
        return rows.every((e, i) => e.activity === path.steps[i]);
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [s.data.events, s.report.case_ids, path.steps]);
  const stops = useMemo(
    () =>
      path.steps.map((label, i) => {
        const systems = new Set(matching.map(([, rows]) => rows[i].system));
        const values =
          i === 0
            ? []
            : matching
                .map(([, rows]) => gap(rows[i - 1], rows[i]))
                .filter((v): v is number => v !== null)
                .sort((a, b) => a - b);
        const count = values.length;
        const hours = count
          ? (values[Math.floor(count / 2)] +
              values[Math.floor((count - 1) / 2)]) /
            2
          : null;
        return { label, hours, systems: [...systems].join(" · "), count };
      }),
    [path, matching],
  );
  const maximum = stops.reduce((v, s) => Math.max(v, s.hours ?? 0), 0);
  const peak = maximum > 0 ? stops.findIndex((s) => s.hours === maximum) : -1;
  const [picked, pick] = useState<number | null>(null);
  const selected =
    picked !== null && picked < stops.length ? picked : Math.max(0, peak);
  const current = stops[selected];
  const [caseId, chooseCase] = useState("");
  const example = matching.find(([id]) => id === caseId) ?? matching[0];
  const previous =
    example && selected > 0 ? example[1][selected - 1] : undefined;
  const arrival = example?.[1][selected];
  const start = Math.floor(selected / 7) * 7;
  const visibleStops = useMemo(
    () => stops.slice(start, start + 7),
    [stops, start],
  );
  return (
    <div className={css.page} data-paused={paused}>
      <section className={css.hero} aria-label="Variant timing">
        <div className={css.stage}>
          <HandoffBackdrop warm={selected === peak} />
          <div className={css.top}>
            <span>
              <GitBranch size={16} /> Execution path
            </span>
            <div>
              <select
                aria-label="Process variant"
                value={index}
                onChange={(e) => choose(Number(e.target.value))}
              >
                {s.report.paths.map((v, i) => (
                  <option key={i} value={i}>
                    Variant {i + 1} · {number(v.count)} cases
                  </option>
                ))}
              </select>
              <button
                onClick={togglePause}
                aria-label={
                  paused ? "Play process motion" : "Pause process motion"
                }
              >
                {paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
            </div>
          </div>
          <div className={css.headline}>
            <div>
              <small>
                {selected === peak
                  ? "Longest median interval"
                  : selected > 0
                    ? "Selected interval"
                    : "Starting activity"}
              </small>
              <h2>{current?.label ?? "No observed steps"}</h2>
              {selected > 0 && <p>From {stops[selected - 1].label}</p>}
            </div>
            {selected > 0 && (
              <div className={css.readout} data-peak={selected === peak}>
                <strong>{fmt(current.hours)}</strong>
                <span>median · {number(current.count)} intervals</span>
              </div>
            )}
          </div>
          <ProcessRibbon
            stops={visibleStops}
            start={start}
            maximum={maximum}
            peak={peak}
            selected={selected}
            select={pick}
            paused={paused}
          />
          <div className={css.caption}>
            <span>
              {stops.length <= 7 ? (
                <>
                  Sequence order <ArrowRight size={13} />
                </>
              ) : (
                <>
                  <button
                    disabled={start === 0}
                    aria-label="Previous steps"
                    onClick={() => pick(start - 1)}
                  >
                    ‹
                  </button>
                  Steps {start + 1}–{start + visibleStops.length} of{" "}
                  {stops.length}
                  <button
                    disabled={start + visibleStops.length === stops.length}
                    aria-label="Next steps"
                    onClick={() => pick(start + visibleStops.length)}
                  >
                    ›
                  </button>
                </>
              )}
            </span>
            <span>Wider ribbon · longer median interval</span>
          </div>
        </div>
        <div className={css.foot}>
          <span>
            <b>{number(path.count)}</b> cases on path
          </span>
          <span>
            <b>
              {s.report.cases
                ? number(
                    Number(((100 * path.count) / s.report.cases).toFixed(1)),
                  )
                : 0}
              %
            </b>{" "}
            of cases
          </span>
          <span>
            <b>{stops.length}</b> activities
          </span>
          <span>{s.report.mining} discovery</span>
        </div>
      </section>
      <div className={css.columns}>
        <section
          className={css.panel}
          role="group"
          aria-label="Observed process sequence"
        >
          <header>
            <h2>Activity sequence</h2>
            <span>Median interval</span>
          </header>
          <ol className={css.ledger}>
            {stops.map((step, i) => (
              <li key={i}>
                <button onClick={() => pick(i)} aria-pressed={selected === i}>
                  <small>{String(i + 1).padStart(2, "0")}</small>
                  <span>
                    <strong>{step.label}</strong>
                    <em>{step.systems}</em>
                  </span>
                  <b data-peak={peak === i}>{i ? fmt(step.hours) : "Start"}</b>
                  {step.hours !== null && maximum > 0 && (
                    <i
                      aria-hidden="true"
                      style={{ width: (step.hours / maximum) * 85 + "%" }}
                    />
                  )}
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className={css.panel} aria-label="Case evidence">
          <header>
            <h2>Case evidence</h2>
            {example && (
              <select
                aria-label="Select case"
                value={example[0]}
                onChange={(e) => chooseCase(e.target.value)}
              >
                {matching.map(([id]) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            )}
          </header>
          {arrival && example ? (
            <div className={css.witness} key={example[0] + "/" + selected}>
              <div className={css.caseLead}>
                <span>
                  {previous
                    ? "Elapsed in this case"
                    : "First recorded activity"}
                </span>
                {previous && <b>{fmt(gap(previous, arrival))}</b>}
              </div>
              {previous && (
                <div>
                  <small>Previous event</small>
                  <Evidence s={s} id={previous.id} showTime />
                </div>
              )}
              <div>
                <small>{previous ? "Arrival event" : "Source event"}</small>
                <Evidence s={s} id={arrival.id} showTime />
              </div>
              <details className={css.all}>
                <summary>
                  Full case timeline <span>{example[1].length} events</span>
                </summary>
                <ol>
                  {example[1].map((e) => (
                    <li key={e.id}>
                      <Evidence s={s} id={e.id} showTime />
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          ) : (
            <p className={css.noRows}>
              No matching source records are available in this window.
            </p>
          )}
        </section>
      </div>
      <section className={css.panel} aria-label="Workspace bottlenecks">
        <header>
          <h2>Workspace bottlenecks</h2>
          <span>Across process variants</span>
        </header>
        {s.report.bottlenecks.slice(0, 4).map((b) => (
          <details
            className={css.bottleneck}
            key={JSON.stringify([b.first, b.last])}
          >
            <summary>
              <ChevronRight size={15} />
              <span>
                {b.first} → {b.last}
              </span>
              <b>{fmt(b.hours)}</b>
            </summary>
            <div>
              <p>
                {number(b.count)} observed transitions · median elapsed time
              </p>
              {b.evidence.map((id) => (
                <Evidence key={id} s={s} id={id} />
              ))}
            </div>
          </details>
        ))}
        {!s.report.bottlenecks.length && (
          <p className={css.noRows}>No measured bottlenecks in this window.</p>
        )}
      </section>
    </div>
  );
}

export default function Processes({
  s,
  initialVariant = 0,
  paused,
  togglePause,
}: Motion & { s: State; initialVariant?: number }) {
  const [variant, choose] = useState(initialVariant);
  const index = s.report.paths[variant] ? variant : 0;
  const path = s.report.paths[index];
  if (!path)
    return (
      <div className="panel empty">
        Import an event log to discover a process path.
      </div>
    );
  return (
    <VariantView
      key={JSON.stringify(path.steps)}
      s={s}
      path={path}
      index={index}
      choose={choose}
      paused={paused}
      togglePause={togglePause}
    />
  );
}
