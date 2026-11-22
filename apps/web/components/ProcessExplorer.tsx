import { useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import {
  indexJourneys,
  intervalHours,
  journeyStages,
  type ProcessCase,
} from "../lib/journey";
import type { State } from "../lib/types";
import { number } from "./UI";
import { Evidence } from "./Detail";
import styles from "./Journeys.module.css";

const hours = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const formatHours = (n: number) => hours.format(n);
type Stages = ReturnType<typeof journeyStages>;

function WaitProfile({
  stages,
  selected,
}: {
  stages: Stages;
  selected: number;
}) {
  const gradient = useId();
  const top = Math.max(0, ...stages.map((s) => s.median ?? 0));
  if (!top) return null;
  const width = 1000,
    floor = 112;
  const cell = width / stages.length;
  const crest = stages.map((stage, i) => ({
    x: (i + 0.5) * cell,
    y: floor - (87 * (stage.median ?? 0)) / top,
  }));
  const points = [{ x: 0, y: floor }, ...crest, { x: width, y: floor }];
  const line = (depth: number) => {
    // Ribs meet the exact measured heights at each station on the upper contour.
    const y = (v: number) => floor + (v - floor) * depth;
    let path = "M 0 " + floor;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1],
        next = points[i],
        mid = (next.x + prev.x) / 2;
      path += ` C ${mid} ${y(prev.y)},${mid} ${y(next.y)},${next.x} ${y(next.y)}`;
    }
    return path;
  };
  const focus = crest[selected];
  return (
    <svg
      className={styles.profile}
      viewBox={`0 0 ${width} 124`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradient}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0%" stopColor="#273457" />
          <stop offset="75%" stopColor="#8491ad" />
          <stop offset="100%" stopColor="var(--paper, #f3efe7)" />
        </linearGradient>
      </defs>
      {crest.map((p, i) => (
        <path
          key={i}
          d={`M${p.x},12 V${floor}`}
          stroke="var(--line)"
          strokeDasharray="2 5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={line(1) + " Z"} fill={`url(#${gradient})`} />
      {Array.from({ length: 14 }, (_, i) => (
        <path
          key={i}
          d={line((i + 1) / 14)}
          fill="none"
          stroke={i === 13 ? "#232c47" : "#e0e0dc"}
          strokeWidth={i === 13 ? 1.1 : 0.65}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {focus && (
        <path
          d={`M${focus.x},${focus.y - 5} V${floor + 8}`}
          stroke="var(--rust)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

const PAGE_SIZE = 16;

function PageControls({
  offset,
  total,
  label,
  change,
}: {
  offset: number;
  total: number;
  label: string;
  change: (start: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className={styles.pager}>
      <span>
        {label} {number(offset + 1)}–
        {number(Math.min(offset + PAGE_SIZE, total))} of {number(total)}
      </span>
      <button
        onClick={() => change(offset - PAGE_SIZE)}
        disabled={!offset}
        aria-label={`Previous ${label.toLowerCase()}`}
      >
        Previous
      </button>
      <button
        onClick={() => change(offset + PAGE_SIZE)}
        disabled={offset + PAGE_SIZE >= total}
        aria-label={`Next ${label.toLowerCase()}`}
      >
        Next
      </button>
    </div>
  );
}

function CaseTimeline({ rows, s }: { rows: ProcessCase["rows"]; s: State }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(0);
  const offset = Math.min(
    start,
    Math.max(0, Math.floor((rows.length - 1) / PAGE_SIZE) * PAGE_SIZE),
  );
  return (
    <details
      className={styles.disclosure}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Full case timeline{" "}
        <span>
          {number(rows.length)} events <ChevronDown size={15} />
        </span>
      </summary>
      {open && (
        <>
          <PageControls
            label="Events"
            total={rows.length}
            offset={offset}
            change={setStart}
          />
          <ol className={styles.allEvents} start={offset + 1}>
            {rows.slice(offset, offset + PAGE_SIZE).map((e) => (
              <li key={e.id}>
                <Evidence s={s} id={e.id} showTime />
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}

function Variant({
  s,
  index,
  chooseVariant,
  cases,
}: {
  s: State;
  index: number;
  chooseVariant: (i: number) => void;
  cases: ProcessCase[];
}) {
  const path = s.report.paths[index];
  const stages = useMemo(
    () => journeyStages(path.steps, cases),
    [path.steps, cases],
  );
  const peak = stages.reduce(
    (best, stage, i) =>
      stage.median !== null &&
      (best < 0 || stage.median > (stages[best].median ?? 0))
        ? i
        : best,
    -1,
  );
  const [pickedStage, setPickedStage] = useState<number | null>(null);
  const [pickedCase, setPickedCase] = useState("");
  const step =
    pickedStage !== null && stages[pickedStage]
      ? pickedStage
      : Math.max(0, peak);
  const stage = stages[step];
  const stageOffset = Math.floor(step / PAGE_SIZE) * PAGE_SIZE;
  function inspectStage(i: number) {
    setPickedStage(i);
    setPickedCase("");
  }
  const ranked = useMemo(
    () =>
      cases
        .map((item) => ({
          ...item,
          wait: intervalHours(item.rows, step),
        }))
        .sort(
          (a, b) => (b.wait ?? -1) - (a.wait ?? -1) || a.id.localeCompare(b.id),
        ),
    [cases, step],
  );
  const chosen = ranked.find((c) => c.id === pickedCase) ?? ranked[0];
  const previous = chosen?.rows[step - 1],
    arrival = chosen?.rows[step];
  const evidenceId = useId();
  const evidencePanel = useRef<HTMLElement>(null);
  function revealCase() {
    evidencePanel.current?.focus({ preventScroll: true });
    evidencePanel.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  return (
    <div className={styles.work}>
      <section className={styles.atlas} aria-label="Execution path">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}>Observed journey</p>
            <h2>Execution path</h2>
          </div>
          <label className={styles.fieldLabel}>
            Process variant
            <select
              aria-label="Process variant"
              value={index}
              onChange={(e) => chooseVariant(Number(e.target.value))}
            >
              {s.report.paths.map((p, i) => (
                <option key={i} value={i}>
                  Variant {i + 1} · {number(p.count)} cases
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className={styles.journeyLead}>
          <div>
            <div className={styles.metricLabel}>Longest median wait</div>
            <strong className={styles.primaryNumber}>
              {peak < 0 ? "—" : formatHours(stages[peak].median!)}
              {peak >= 0 && <small> h</small>}
            </strong>
          </div>
          <div className={styles.leadStory}>
            <p>
              {peak > 0 ? (
                <>
                  From <strong>{stages[peak - 1].label}</strong> to{" "}
                  <strong>{stages[peak].label}</strong>.
                </>
              ) : (
                "This path has no measured transition interval."
              )}
            </p>
            <span>
              {number(path.count)} cases on this path ·{" "}
              {s.report.cases
                ? Math.round((path.count / s.report.cases) * 1000) / 10
                : 0}
              % of the window
            </span>
          </div>
        </div>
        <div className={styles.routeActions}>
          <p className={styles.routeCaption}>
            Median elapsed time before each step
          </p>
          {chosen && (
            <button
              type="button"
              aria-controls={evidenceId}
              onClick={revealCase}
            >
              View case evidence <ChevronDown size={14} />
            </button>
          )}
        </div>
        <PageControls
          label="Steps"
          total={stages.length}
          offset={stageOffset}
          change={inspectStage}
        />
        <div
          className={styles.route}
          data-compact={stages.length > 8 || undefined}
          role="group"
          aria-label="Observed process sequence"
        >
          {stages.length <= 8 && (
            <WaitProfile stages={stages} selected={step} />
          )}
          <ol
            start={stageOffset + 1}
            style={{ "--stage-count": stages.length } as CSSProperties}
          >
            {stages.slice(stageOffset, stageOffset + PAGE_SIZE).map((st, j) => {
              const i = stageOffset + j;
              return (
                <li key={i}>
                  <button
                    type="button"
                    aria-label={`Inspect step ${i + 1}, ${st.label}`}
                    aria-pressed={i === step}
                    aria-controls={evidenceId}
                    style={
                      {
                        "--wait":
                          (peak < 0 || !stages[peak].median
                            ? 0
                            : (st.median ?? 0) / stages[peak].median!) *
                            100 +
                          "%",
                      } as CSSProperties
                    }
                    onClick={() => inspectStage(i)}
                  >
                    <span className={styles.station}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.stageName}>
                      {st.label}
                      <small>{st.system}</small>
                    </span>
                    <span className={styles.stepTime}>
                      {st.median === null
                        ? i
                          ? "—"
                          : "Start"
                        : formatHours(st.median) + " h"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section
        className={styles.witnesses}
        aria-label="Selected interval evidence"
        id={evidenceId}
        ref={evidencePanel}
        tabIndex={-1}
      >
        <div className={styles.witnessMain}>
          <header className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}>Source records</p>
              <h2>Case events</h2>
            </div>
            {!!ranked.length && (
              <label className={styles.fieldLabel}>
                Case{" "}
                <select
                  aria-label="Select case"
                  value={chosen?.id ?? ""}
                  onChange={(e) => setPickedCase(e.target.value)}
                >
                  {ranked.map(({ id }) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
            )}
          </header>
          {arrival && stage ? (
            <>
              <div className={styles.caseMeasure}>
                <span>
                  {previous
                    ? `${previous.activity} → ${arrival.activity}`
                    : arrival.activity}
                </span>
                <strong>
                  {chosen?.wait === null
                    ? "Start of case"
                    : formatHours(chosen.wait) + " h"}
                </strong>
              </div>
              <div className={styles.eventReceipts}>
                {previous && (
                  <div>
                    <small>Start event</small>
                    <Evidence s={s} id={previous.id} showTime />
                  </div>
                )}
                <div>
                  <small>{previous ? "End event" : "First event"}</small>
                  <Evidence s={s} id={arrival.id} showTime />
                </div>
              </div>
              <CaseTimeline key={chosen.id} s={s} rows={chosen.rows} />
            </>
          ) : (
            <p className={styles.empty}>
              The current snapshot has no case records for this step.
            </p>
          )}
        </div>

        <aside className={styles.rank}>
          <p className={styles.kicker}>Cases on this path</p>
          <h3>{step ? "Longest waits" : "Starting cases"}</h3>
          {stage && <p>{step ? `Into ${stage.label}` : stage.label}</p>}
          <ol>
            {ranked.slice(0, 4).map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={item.id === chosen?.id}
                  onClick={() => setPickedCase(item.id)}
                >
                  <span>{item.id}</span>
                  <strong>
                    {item.wait === null
                      ? "Start"
                      : formatHours(item.wait) + " h"}
                  </strong>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className={styles.subsection}>
        <header>
          <div>
            <p className={styles.kicker}>Across all variants</p>
            <h2>Bottlenecks</h2>
          </div>
          <span className={styles.method}>{s.report.mining} discovery</span>
        </header>
        {s.report.bottlenecks.slice(0, 4).map((b) => (
          <details
            className={styles.interval}
            key={JSON.stringify([b.first, b.last])}
          >
            <summary>
              <span>
                {b.first} <span aria-hidden="true">→</span> {b.last}
              </span>
              <b>{formatHours(b.hours)} h</b>
              <ChevronDown size={16} />
            </summary>
            <p>{number(b.count)} observed transitions · median elapsed time</p>
            {b.evidence.map((id) => (
              <Evidence key={id} s={s} id={id} />
            ))}
          </details>
        ))}
        {!s.report.bottlenecks.length && (
          <p className={styles.empty}>
            No transitions were observed in this window.
          </p>
        )}
      </section>
    </div>
  );
}

export function Processes({
  s,
  initialVariant = 0,
}: {
  s: State;
  initialVariant?: number;
}) {
  const [idx, setIdx] = useState(initialVariant);
  const variants = useMemo(
    () => indexJourneys(s.data.events, s.report.case_ids),
    [s.data.events, s.report.case_ids],
  );
  const index = s.report.paths[idx] ? idx : 0;
  const path = s.report.paths[index];
  if (!path)
    return (
      <div className={styles.empty}>
        <Clock3 size={18} />
        Import an event log to discover a process path.
      </div>
    );
  const pathKey = JSON.stringify(path.steps);
  return (
    <Variant
      key={pathKey}
      s={s}
      cases={variants.get(pathKey) ?? []}
      index={index}
      chooseVariant={setIdx}
    />
  );
}
