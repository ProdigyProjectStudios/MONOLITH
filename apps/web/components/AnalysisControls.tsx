import {
  CalendarDays,
  Check,
  ChevronDown,
  LoaderCircle,
  Play,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Report } from "../lib/types";

export default function AnalysisControls({
  report,
  busy,
  changeWindow,
  run,
}: {
  report: Report;
  busy: string;
  changeWindow: (days: number) => void;
  run: () => void;
}) {
  const [open, setOpen] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    group.current?.addEventListener("keydown", escape);
    const node = group.current;
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      node?.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="head-actions">
      <div
        className="range-wrap"
        ref={group}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        <button
          className="btn range-btn"
          ref={trigger}
          disabled={!!busy}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <CalendarDays size={15} /> Last {report.days} days{" "}
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="popover" role="group" aria-label="Analysis window">
            <small>Through {report.asof?.slice(0, 10) || "latest event"}</small>
            {[7, 14, 30, 90].map((days) => (
              <button
                key={days}
                aria-pressed={days === report.days}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                  changeWindow(days);
                }}
              >
                Last {days} days {days === report.days && <Check size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn primary" disabled={!!busy} onClick={run}>
        {busy ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Play size={13} />
        )}
        {busy || "Run analysis"}
      </button>
    </div>
  );
}
