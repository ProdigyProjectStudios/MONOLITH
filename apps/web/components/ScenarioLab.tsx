"use client";

import {
  Activity,
  CircleHelp,
  Clock3,
  FlaskConical,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getPackage,
  simulate,
  type FlagshipPackage,
  type RoutingScenario as Scenario,
} from "../lib/investigations";
import type { State } from "../lib/types";
import styles from "./FlagshipLab.module.css";

type Assumptions = Record<string, number | string>;
type Input = {
  key: string;
  name: string;
  unit: "fraction" | "min" | "h" | "£" | "£/h";
  min: number;
  max: number;
  step: number;
};
const primaryInputs: Input[] = [
  {
    key: "coverage",
    name: "Eligible cases routed",
    unit: "fraction",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "reduction",
    name: "Successful route time reduction",
    unit: "fraction",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "failure",
    name: "Routing failure rate",
    unit: "fraction",
    min: 0,
    max: 100,
    step: 1,
  },
];
const additionalInputs: Input[] = [
  {
    key: "manual_minutes",
    name: "Current routing effort",
    unit: "min",
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: "review_minutes",
    name: "Human authorisation effort",
    unit: "min",
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: "assist_minutes",
    name: "Successful routing effort",
    unit: "min",
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: "exception_minutes",
    name: "Extra failure handling",
    unit: "min",
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: "failure_delay",
    name: "Delay on failure",
    unit: "h",
    min: 0,
    max: 168,
    step: 0.5,
  },
  {
    key: "cadence_hours",
    name: "Batch interval",
    unit: "h",
    min: 0,
    max: 168,
    step: 0.5,
  },
  {
    key: "hourly_rate",
    name: "Loaded labour rate",
    unit: "£/h",
    min: 0,
    max: 1000,
    step: 0.5,
  },
  {
    key: "fixed_cost",
    name: "Fixed pilot cost per window",
    unit: "£",
    min: 0,
    max: 100000,
    step: 1,
  },
  {
    key: "unit_cost",
    name: "Cost per routing attempt",
    unit: "£",
    min: 0,
    max: 1000,
    step: 0.01,
  },
];
const decimal = (value: number, digits = 1) =>
  value.toLocaleString("en-GB", { maximumFractionDigits: digits });
const money = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);
const hours = (v: number) => decimal(v, 2) + " h";
const explanation = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to calculate this model.";
const signature = (a: Assumptions) =>
  JSON.stringify(Object.entries(a).sort(([l], [r]) => l.localeCompare(r)));

function Control({
  input,
  value,
  onChange,
  range,
}: {
  input: Input;
  value: number;
  onChange: (value: number) => void;
  range: boolean;
}) {
  const fraction = input.unit === "fraction";
  const display = fraction ? Math.round(100 * value) : value;
  const unit = fraction ? "%" : input.unit;
  const update = (n: number) => {
    if (Number.isFinite(n))
      onChange(
        (fraction ? 0.01 : 1) * Math.max(input.min, Math.min(input.max, n)),
      );
  };
  return (
    <label className={range ? styles.slider : styles.numeric}>
      <span>{input.name}</span>
      {range ? (
        <>
          <output>
            {decimal(display, 2)}
            {unit}
          </output>
          <input
            aria-label={input.name}
            type="range"
            min={input.min}
            max={input.max}
            step={input.step}
            value={display}
            onChange={(e) => update(e.currentTarget.valueAsNumber)}
          />
        </>
      ) : (
        <span className={styles.numberField}>
          <input
            type="number"
            aria-label={input.name}
            min={input.min}
            max={input.max}
            step={input.step}
            value={display}
            onChange={(e) => update(e.currentTarget.valueAsNumber)}
          />
          <small>{unit}</small>
        </span>
      )}
    </label>
  );
}

function ModelEditor({ s, model }: { s: State; model: FlagshipPackage }) {
  const [selected, setSelected] = useState(model.approaches[0]?.id ?? "");
  const [inputs, setInputs] = useState<Record<string, Assumptions>>(() =>
    Object.fromEntries(
      model.approaches.map((a) => [a.id, { ...a.assumptions, approach: a.id }]),
    ),
  );
  const [outputs, setOutputs] = useState<
    Record<string, { key: string; value: Scenario }>
  >(() =>
    Object.fromEntries(
      model.scenarios.map((v) => [
        v.approach,
        { key: signature(inputs[v.approach]), value: v },
      ]),
    ),
  );
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const updates = Object.entries(inputs).filter(
      ([id, parms]) => outputs[id]?.key !== signature(parms),
    );
    if (!updates.length) return;
    const handle = window.setTimeout(async () => {
      try {
        const next = await Promise.all(
          updates.map(
            async ([id, assumptions]) =>
              [
                id,
                {
                  key: signature(assumptions),
                  value: await simulate(s, assumptions),
                },
              ] as const,
          ),
        );
        if (active) {
          setOutputs((old) => ({ ...old, ...Object.fromEntries(next) }));
          setError("");
        }
      } catch (e) {
        if (active) setError(explanation(e));
      }
    }, 140);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [s, inputs, outputs, retry]);

  const baseline = model.baseline,
    approach = model.approaches.find((a) => a.id === selected);
  if (
    baseline.median === null ||
    baseline.p25 === null ||
    baseline.p75 === null ||
    !baseline.intervals ||
    !approach
  )
    return (
      <p className={styles.message}>
        {baseline.intervals
          ? "Every matched refund case has dispute activity. Human review is retained across this cohort."
          : "This analysis window contains no matched refund authorisation intervals."}
      </p>
    );
  const params = inputs[selected],
    current = outputs[selected]?.value;
  const pending = !current || outputs[selected].key !== signature(params);
  const change = (key: string, value: number) => {
    setError("");
    setInputs((previous) => ({
      ...previous,
      [selected]: { ...previous[selected], [key]: value },
    }));
  };
  const rows = [
    {
      name: "Observed baseline",
      time: baseline.median,
      low: baseline.p25,
      high: baseline.p75,
      style: styles.observed,
      title: "Measured interquartile range",
    },
    ...model.approaches.flatMap((a, i) => {
      const v = outputs[a.id]?.value;
      return v &&
        v.projected_median !== null &&
        v.sensitivity.low !== null &&
        v.sensitivity.high !== null
        ? [
            {
              name: a.name,
              time: v.projected_median,
              low: v.sensitivity.low,
              high: v.sensitivity.high,
              style: i ? styles.batch : styles.queue,
              title: "Model sensitivity range",
            },
          ]
        : [];
    }),
  ];
  const scale = Math.max(
    1,
    ...rows.map((r) => Math.max(r.time, r.low, r.high)),
  );
  const sum = (
    id: string,
    fmt: (v: number) => string,
    field: keyof Pick<
      Scenario,
      | "staff_hours"
      | "operating_cost"
      | "net_savings"
      | "failure_attempts"
      | "elapsed_hours_saved"
    >,
  ) => {
    const result = outputs[id]?.value;
    return result ? fmt(result[field]) : "…";
  };
  return (
    <section className={styles.lab} aria-label="Refund routing scenario model">
      <div className={styles.title}>
        <FlaskConical size={20} />
        <h3>Routing simulation</h3>
      </div>
      <div className={styles.measurement}>
        <div>
          <span className={styles.metricLabel}>
            <Clock3 size={12} /> Observed median
          </span>
          <strong>
            {decimal(baseline.median, 2)}
            <small>h</small>
          </strong>
        </div>
        <p>
          <b>{decimal(baseline.cases, 0)} refund cases</b>
          <br />
          Invoice re-entry to refund authorisation in the {s.report.days}-day
          window.
        </p>
      </div>
      <figure className={styles.comparison}>
        <figcaption>Median authorisation interval</figcaption>
        <div className={styles.bars}>
          {rows.map((row) => (
            <div key={row.name} className={styles.barRow}>
              <div>
                <span>{row.name}</span>
                <b>{hours(row.time)}</b>
              </div>
              <div
                className={styles.track}
                aria-label={
                  row.title +
                  ", " +
                  hours(Math.min(row.low, row.high)) +
                  " to " +
                  hours(Math.max(row.low, row.high))
                }
              >
                <i
                  className={row.style}
                  style={{
                    left: (100 * Math.min(row.low, row.high)) / scale + "%",
                    width: (100 * Math.abs(row.high - row.low)) / scale + "%",
                  }}
                />
                <b
                  className={row.style}
                  style={{ left: (100 * row.time) / scale + "%" }}
                />
              </div>
              <small className={styles.bandCaption}>
                {row.title} · {hours(Math.min(row.low, row.high))}–
                {hours(Math.max(row.low, row.high))}
              </small>
            </div>
          ))}
        </div>
        <p>
          Dots show medians. Bands show the observed middle 50% or the model’s
          sensitivity to a ±20% change in routing effectiveness.
        </p>
      </figure>
      <div className={styles.sectionHead}>
        <h4>
          <SlidersHorizontal size={15} /> Model assumptions
        </h4>
        <button
          type="button"
          className={styles.subtle}
          disabled={
            signature(params) ===
            signature({ ...approach.assumptions, approach: selected })
          }
          onClick={() => {
            setError("");
            setInputs((previous) => ({
              ...previous,
              [selected]: { ...approach.assumptions, approach: selected },
            }));
          }}
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>
      <div className={styles.choices} aria-label="Approach to adjust">
        {model.approaches.map((a) => (
          <button
            type="button"
            key={a.id}
            aria-pressed={selected === a.id}
            onClick={() => setSelected(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      {primaryInputs.map((input) => (
        <Control
          key={input.key}
          input={input}
          value={Number(params[input.key])}
          onChange={(v) => change(input.key, v)}
          range
        />
      ))}
      <details className={styles.disclosure}>
        <summary>Workload, costs and exceptions</summary>
        <div className={styles.numbers}>
          {additionalInputs
            .filter((f) => f.key !== "cadence_hours" || selected === "batch")
            .map((input) => (
              <Control
                key={input.key}
                input={input}
                value={Number(params[input.key])}
                onChange={(v) => change(input.key, v)}
                range={false}
              />
            ))}
        </div>
      </details>
      {error ? (
        <div className={styles.message} role="alert">
          {error}{" "}
          <button
            type="button"
            className={styles.subtle}
            onClick={() => {
              setError("");
              setRetry((v) => v + 1);
            }}
          >
            Retry calculation
          </button>
        </div>
      ) : (
        <p className={styles.calcStatus} role="status">
          {pending ? (
            <>
              <LoaderCircle size={12} className={styles.spin} /> Updating
              estimates…
            </>
          ) : (
            <>
              <Activity size={12} /> Model calculated
            </>
          )}
        </p>
      )}
      <div className={styles.sectionHead}>
        <h4>
          <Wallet size={15} /> Window estimates
        </h4>
      </div>
      <div className={styles.matrix}>
        <table>
          <thead>
            <tr>
              <th scope="col">Outcome</th>
              {model.approaches.map((a) => (
                <th key={a.id} scope="col">
                  {a.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                label: "Staff workload",
                field: "staff_hours" as const,
                fmt: hours,
              },
              {
                label: "Operating cost",
                field: "operating_cost" as const,
                fmt: money,
              },
              {
                label: "Net saving",
                field: "net_savings" as const,
                fmt: money,
              },
              {
                label: "Failed attempts",
                field: "failure_attempts" as const,
                fmt: decimal,
              },
              {
                label: "Elapsed case-hours saved",
                field: "elapsed_hours_saved" as const,
                fmt: hours,
              },
            ].map((r) => (
              <tr key={r.field}>
                <th scope="row">{r.label}</th>
                {model.approaches.map((a) => (
                  <td key={a.id}>{sum(a.id, r.fmt, r.field)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && (
        <div className={styles.note}>
          <ShieldCheck size={16} />
          <p>
            <b>
              {decimal(current.approvals_retained, 0)} human authorisations
              retained
            </b>
            <span>
              Cases with dispute activity are excluded from proposed routing.
            </span>
          </p>
        </div>
      )}
      <details className={styles.disclosure}>
        <summary>
          <CircleHelp size={14} /> How to interpret these estimates
        </summary>
        <div className={styles.explain}>
          <p>
            Each projection applies the selected coverage, success rate and
            delay reduction to measured intervals. Failed routes return to
            manual handling and incur the specified extra delay. Batch routing
            also introduces a wait for the next dispatch.
          </p>
          {current && (
            <p>
              For {approach.name}, the assumed manual workload is{" "}
              {hours(current.baseline_staff_hours)}, valued at{" "}
              {money(current.baseline_staff_cost)}. Proposed staff cost is{" "}
              {money(current.staff_cost)}. A negative net saving means the
              proposed route costs more over this window.
            </p>
          )}
          <p>
            Staff time and costs use the entered assumptions. Net savings
            exclude implementation costs. Elapsed hours can overlap across
            cases. The sensitivity band varies effectiveness while holding the
            other inputs fixed.
          </p>
        </div>
      </details>
    </section>
  );
}

export default function ScenarioLab({ s }: { s: State }) {
  const [data, setData] = useState<FlagshipPackage | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    getPackage(s)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(explanation(e));
      });
    return () => {
      active = false;
    };
  }, [s, retry]);
  if (error)
    return (
      <div className={styles.message} role="alert">
        {error}{" "}
        <button
          type="button"
          className={styles.subtle}
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry model
        </button>
      </div>
    );
  if (!data)
    return (
      <p className={styles.message} role="status">
        <LoaderCircle size={16} className={styles.spin} /> Preparing measured
        refund intervals…
      </p>
    );
  return <ModelEditor s={s} model={data} />;
}
