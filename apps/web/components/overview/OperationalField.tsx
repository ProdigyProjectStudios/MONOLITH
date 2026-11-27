"use client";
import { fieldLabelPosition } from "./fieldLabelPosition";
import { ArrowRight, ArrowUpRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { number } from "../UI";
import styles from "./OperationalField.module.css";
import { FieldEngine, type FieldAnchors, type FieldPick } from "./fieldEngine";
import type { EvidenceRecord, FieldEvidence } from "./fieldEvidence";

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const when = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? stamp.format(t) + " UTC" : iso;
};
const hours = (h: number | null) =>
  h === null ? "—" : h >= 10 ? h.toFixed(1) + "h" : h.toFixed(2) + "h";

function EvidenceRow({ r }: { r: EvidenceRecord }) {
  return (
    <li className={styles.record}>
      <span className={styles.recordAct}>{r.activity}</span>
      <span className={styles.recordMeta}>
        <code>{r.id}</code> · {r.source} row {r.row} · {when(r.timestamp)}
      </span>
    </li>
  );
}

export type OperationalFieldProps = {
  evidence: FieldEvidence;
  systems: { name: string; count: number }[];
  links: { source: string; target: string; count: number; id: string }[];
  emphasis: Set<string>;
  playing: boolean;
  /** Clearing the selection from outside (e.g. "Reset view"). */
  resetKey: number;
  onOpenSystem: (name: string) => void;
  onUnavailable: () => void;
};

export default function OperationalField({
  evidence,
  systems,
  links,
  emphasis,
  playing,
  resetKey,
  onOpenSystem,
  onUnavailable,
}: OperationalFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<FieldEngine | null>(null);
  const [anchors, setAnchors] = useState<FieldAnchors | null>(null);
  const [selected, setSelected] = useState<FieldPick>(null);
  const [hovered, setHovered] = useState<FieldPick>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;

  useEffect(() => setSelected(null), [resetKey]);

  // Mount the renderer once; data changes go through setData.
  useEffect(() => {
    const el = canvas.current;
    const box = host.current;
    if (!el || !box) return;
    let fx: FieldEngine;
    try {
      fx = new FieldEngine(el);
    } catch {
      unavailable.current();
      return;
    }
    engine.current = fx;
    fx.onAnchors = setAnchors;
    const lost = (event: Event) => {
      event.preventDefault();
      unavailable.current();
    };
    el.addEventListener("webglcontextlost", lost);
    const size = () => fx.resize(box.clientWidth, box.clientHeight);
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    const io = new IntersectionObserver(([entry]) => fx.setActive(entry.isIntersecting && !document.hidden));
    io.observe(box);
    const vis = () => fx.setActive(!document.hidden && box.getBoundingClientRect().bottom > 0);
    document.addEventListener("visibilitychange", vis);
    fx.setActive(true);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      el.removeEventListener("webglcontextlost", lost);
      ro.disconnect();
      io.disconnect();
      fx.dispose();
      engine.current = null;
    };
  }, []);

  const fieldSystems = useMemo(
    () => systems.map((s) => ({ ...s, pressure: evidence.pressure.has(s.name) })),
    [systems, evidence],
  );
  const fieldLinks = useMemo(
    () => links.map((l) => ({ ...l, pressure: evidence.pressure.has(l.target) })),
    [links, evidence],
  );
  useEffect(() => {
    engine.current?.setData(fieldSystems, fieldLinks);
  }, [fieldSystems, fieldLinks]);
  useEffect(() => {
    engine.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    engine.current?.setFocus({ selected, hovered, emphasis });
  }, [selected, hovered, emphasis]);

  // Keep a selection only while it still exists in the data.
  useEffect(() => {
    if (selected?.kind === "system" && !evidence.systems.has(selected.name)) setSelected(null);
    if (selected?.kind === "link" && !evidence.handoffs.has(selected.id)) setSelected(null);
  }, [evidence, selected]);

  const same = (a: FieldPick, b: FieldPick) => {
    if (!a || !b) return a === b;
    if (a.kind === "system") return b.kind === "system" && a.name === b.name;
    return b.kind === "link" && a.id === b.id;
  };
  const toggle = (pick: FieldPick) => setSelected((cur) => (pick && same(cur, pick) ? null : pick));

  const local = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const system = selected?.kind === "system" ? evidence.systems.get(selected.name) : undefined;
  const handoff = selected?.kind === "link" ? evidence.handoffs.get(selected.id) : undefined;
  const hoverLink = hovered?.kind === "link" ? evidence.handoffs.get(hovered.id) : undefined;
  const ordered = anchors?.systems.map((a) => ({ a, s: evidence.systems.get(a.name) })) || [];

  return (
    <div
      ref={host}
      className={styles.field}
      data-selected={selected ? "true" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.stopPropagation();
          setSelected(null);
        }
      }}
    >
      <canvas
        ref={canvas}
        className={styles.canvas}
        data-hover={hovered ? "true" : undefined}
        role="img"
        aria-label={`Operational field: ${systems.length} systems connected by ${links.length} directed handoff routes. Use the system and route buttons to inspect evidence.`}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return;
          const p = local(e);
          const pick = engine.current?.pick(p.x, p.y) ?? null;
          setPointer(p);
          setHovered((cur) => (same(cur, pick) ? cur : pick));
        }}
        onPointerLeave={() => {
          setHovered(null);
          setPointer(null);
        }}
        onClick={(e) => {
          const r = canvas.current!.getBoundingClientRect();
          const pick = engine.current?.pick(e.clientX - r.left, e.clientY - r.top) ?? null;
          if (pick) toggle(pick);
          else setSelected(null);
        }}
      />

      {ordered.map(({ a, s }) => {
        if (!s) return null;
        const active = selected?.kind === "system" && selected.name === s.name;
        // Labels sit just outside the form, on the side facing away from
        // the centre of the field, so text never lies on the brightest pixels.
        const {left, top} = fieldLabelPosition(a, anchors?.width ?? 0, anchors?.height ?? 0);
        return (
          <button
            key={s.name}
            type="button"
            className={styles.label}
            data-active={active || undefined}
            data-pressure={s.pressure || undefined}
            style={{ transform: `translate(${left}px, ${top}px)` }}
            aria-pressed={active}
            aria-label={`${s.name}, ${number(s.count)} events${s.pressure ? ", bottleneck" : ""}. Show evidence`}
            onClick={() => toggle({ kind: "system", name: s.name })}
            onPointerEnter={() => setHovered({ kind: "system", name: s.name })}
            onPointerLeave={() => setHovered(null)}
          >
            <strong>{s.name}</strong>
            <span>
              {number(s.count)} events
              {s.pressure && <em>Bottleneck</em>}
            </span>
          </button>
        );
      })}

      {anchors?.links.map((l) => {
        const h = evidence.handoffs.get(l.id);
        if (!h) return null;
        const active = selected?.kind === "link" && selected.id === l.id;
        return (
          <button
            key={l.id}
            type="button"
            className={styles.route}
            data-active={active || undefined}
            data-pressure={h.pressure || undefined}
            style={{ transform: `translate(${l.x}px, ${l.y}px)` }}
            aria-pressed={active}
            aria-label={`Handoff ${h.source} to ${h.target}, ${number(h.count)} handoffs. Show evidence`}
            onClick={() => toggle({ kind: "link", id: l.id })}
            onPointerEnter={() => setHovered({ kind: "link", id: l.id })}
            onPointerLeave={() => setHovered(null)}
          >
            <i aria-hidden="true" />
          </button>
        );
      })}

      {hoverLink && pointer && !handoff && (
        <div
          className={styles.tip}
          style={{ transform: `translate(${pointer.x + 14}px, ${pointer.y - 12}px)` }}
          aria-hidden="true"
        >
          {hoverLink.source} <ArrowRight size={11} /> {hoverLink.target}
          <b>{number(hoverLink.count)}</b>
        </div>
      )}

      {(system || handoff) && (
        <aside className={styles.evidence} aria-live="polite" aria-label="Selected evidence">
          <header>
            <span className={styles.evidenceKind} data-pressure={(system?.pressure || handoff?.pressure) || undefined}>
              {system ? (system.pressure ? "System · bottleneck" : "System") : handoff?.pressure ? "Handoff · into bottleneck" : "Handoff"}
            </span>
            <button type="button" className={styles.close} aria-label="Clear selection" onClick={() => setSelected(null)}>
              <X size={14} />
            </button>
          </header>
          {system && (
            <>
              <h3>{system.name}</h3>
              <dl className={styles.stats}>
                <div>
                  <dt>Events</dt>
                  <dd>{number(system.count)}</dd>
                </div>
                <div>
                  <dt>Cases</dt>
                  <dd>{number(system.cases)}</dd>
                </div>
                <div>
                  <dt>Share</dt>
                  <dd>{Math.round(system.share * 100)}%</dd>
                </div>
              </dl>
              {system.pressure && evidence.bottleneck && (
                <p className={styles.note}>
                  Cited in the slowest interval: {evidence.bottleneck.first} → {evidence.bottleneck.last},{" "}
                  {hours(evidence.bottleneck.hours)} median across {number(evidence.bottleneck.count)} cases.
                </p>
              )}
              <div className={styles.flows}>
                <span>
                  In {system.inbound.map((f) => `${f.system} ${number(f.count)}`).join(" · ") || "none"}
                </span>
                <span>
                  Out {system.outbound.map((f) => `${f.system} ${number(f.count)}`).join(" · ") || "none"}
                </span>
              </div>
              {system.activities.length > 0 && (
                <p className={styles.note}>
                  Most recorded: {system.activities.map((a) => `${a.name} (${number(a.count)})`).join(", ")}
                </p>
              )}
              <ul className={styles.records} aria-label="Source records">
                {system.samples.slice(0, 2).map((r) => (
                  <EvidenceRow key={r.id} r={r} />
                ))}
              </ul>
              <button type="button" className={styles.open} onClick={() => onOpenSystem(system.name)}>
                Open in business map <ArrowUpRight size={13} />
              </button>
            </>
          )}
          {handoff && (
            <>
              <h3>
                {handoff.source} <ArrowRight size={15} aria-hidden="true" /> {handoff.target}
              </h3>
              <dl className={styles.stats}>
                <div>
                  <dt>Handoffs</dt>
                  <dd>{number(handoff.count)}</dd>
                </div>
                <div>
                  <dt>Median wait</dt>
                  <dd>{hours(handoff.medianHours)}</dd>
                </div>
                <div>
                  <dt>Cases</dt>
                  <dd>{number(handoff.cases)}</dd>
                </div>
              </dl>
              <p className={styles.note}>
                {Math.round(handoff.share * 100)}% of all observed handoffs. Each is a consecutive pair of events in
                one case where the recording system changes.
              </p>
              <ul className={styles.records} aria-label="Source records">
                {handoff.samples.slice(0, 2).map((p) => (
                  <li key={p.case} className={styles.pair}>
                    <span className={styles.recordAct}>
                      {p.case}: {p.from.activity} <ArrowRight size={11} aria-hidden="true" /> {p.to.activity}
                    </span>
                    <span className={styles.recordMeta}>
                      <code>{p.from.id}</code> → <code>{p.to.id}</code> · {p.to.source} row {p.to.row}
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className={styles.open} onClick={() => onOpenSystem(handoff.target)}>
                Inspect {handoff.target} in business map <ArrowUpRight size={13} />
              </button>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
