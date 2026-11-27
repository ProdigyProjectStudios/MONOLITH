"use client";
import { AnimatePresence, MotionPanel } from "./WorkspaceMotion";
import {
  Activity,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Database,
  FlaskConical,
  GitFork,
  LayoutDashboard,
  Layers3,
  Menu,
  Orbit,
  Radio,
  ScanLine,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Page, Rec } from "../lib/types";
import { Mark, number, RecGlyph } from "./UI";
import styles from "./WorkspaceNav.module.css";

/** The four primary sections live in the bottom dock. */
export const dockSections: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "Overview", label: "Overview", icon: LayoutDashboard },
  { page: "Business map", label: "Map", icon: Orbit },
  { page: "Process explorer", label: "Explorer", icon: GitFork },
  { page: "Intelligence studio", label: "Studio", icon: BrainCircuit },
];
/** Remaining destinations sit in the slim top bar. */
const barLinks: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "Continuous intelligence", label: "Continuous", icon: Radio },
  { page: "Agent activity", label: "Agents", icon: Activity },
  { page: "Data sources", label: "Sources", icon: Database },
];
const opportunityLinks: { page: Page; label: string; note: string; icon: LucideIcon }[] = [
  { page: "Opportunities", label: "Opportunity register", note: "Every measured opportunity", icon: ScanLine },
  { page: "Technical blueprint", label: "Technical blueprint", note: "Architectures and roadmaps", icon: Layers3 },
];

/** Closes a popup on outside pointer, Escape, or when focus leaves it. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        ref.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open, close, ref]);
}

export function TopBar({
  page,
  navigate,
  recs,
  openRec,
  datasetLabel,
  org,
  openSearch,
}: {
  page: Page;
  navigate: (p: Page) => void;
  recs: Rec[];
  openRec: (r: Rec) => void;
  datasetLabel?: string;
  org: string;
  openSearch: () => void;
}) {
  const [opps, setOpps] = useState(false);
  const [more, setMore] = useState(false);
  const oppsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const oppsId = useId();
  const moreId = useId();
  const closeOpps = () => setOpps(false);
  const closeMore = () => setMore(false);
  useDismiss(opps, closeOpps, oppsRef);
  useDismiss(more, closeMore, moreRef);
  const go = (p: Page) => {
    setOpps(false);
    setMore(false);
    navigate(p);
  };
  const oppActive = page === "Opportunities" || page === "Technical blueprint";
  const top = recs.slice(0, 3);

  return (
    <header className={styles.topbar}>
      <button className={styles.brand} aria-label={`MONOLITH overview, ${org}`} onClick={() => go("Overview")}>
        <Mark />
        <b>MONOLITH</b>
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <nav className={styles.links} aria-label="More workspaces" data-workspace-nav="">
        <div className={styles.menuWrap} ref={oppsRef}>
          <button
            className={styles.link}
            data-active={oppActive || undefined}
            aria-expanded={opps}
            aria-controls={oppsId}
            aria-current={oppActive ? "page" : undefined}
            onClick={() => setOpps((v) => !v)}
          >
            <ScanLine size={15} strokeWidth={1.6} />
            Opportunities
            <ChevronDown size={13} className={styles.chev} />
          </button>
          <AnimatePresence>
            {opps && (
              <MotionPanel kind="menu" className={styles.mega} id={oppsId}>
                <div className={styles.megaIntro}>
                  <svg viewBox="0 0 160 60" aria-hidden="true">
                    {Array.from({ length: 7 }, (_, i) => (
                      <path
                        key={i}
                        d={`M0 ${44 - i * 2} C 40 ${10 + i * 5}, 90 ${58 - i * 6}, 160 ${18 + i * 3}`}
                      />
                    ))}
                  </svg>
                  <strong>Opportunities</strong>
                  <p>Identify, quantify and prioritise improvement opportunities.</p>
                  <span>{number(recs.length)} in this analysis window</span>
                </div>
                <ul className={styles.megaList}>
                  {opportunityLinks.map((l) => (
                    <li key={l.page}>
                      <button
                        className={styles.megaItem}
                        aria-current={page === l.page ? "page" : undefined}
                        onClick={() => go(l.page)}
                      >
                        <l.icon size={15} strokeWidth={1.6} />
                        <span>
                          <b>{l.label}</b>
                          <small>{l.note}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                  {top.length > 0 && <li className={styles.megaLabel}>Top findings</li>}
                  {top.map((r) => (
                    <li key={r.id}>
                      <button
                        className={styles.megaItem}
                        onClick={() => {
                          setOpps(false);
                          openRec(r);
                        }}
                      >
                        <span className={styles.megaGlyph}>
                          <RecGlyph r={r} />
                        </span>
                        <span>
                          <b>{r.title}</b>
                          <small>
                            {r.kind} · {r.score}/100
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </MotionPanel>
            )}
          </AnimatePresence>
        </div>
        {barLinks.map((l) => (
          <button
            key={l.page}
            className={styles.link}
            data-active={page === l.page || undefined}
            aria-current={page === l.page ? "page" : undefined}
            title={l.page}
            onClick={() => go(l.page)}
          >
            <l.icon size={15} strokeWidth={1.6} />
            {l.label}
          </button>
        ))}
      </nav>
      <div className={styles.right}>
        {datasetLabel && (
          <span className={styles.dataset}>
            <FlaskConical size={12} />
            {datasetLabel}
          </span>
        )}
        <button
          className={styles.search}
          aria-label="Search workspace"
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={openSearch}
        >
          <Search size={14} />
          <span>Search workspace</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className={styles.moreWrap} ref={moreRef}>
          <button
            className={styles.moreBtn}
            aria-label="More workspaces"
            aria-expanded={more}
            aria-controls={moreId}
            onClick={() => setMore((v) => !v)}
          >
            <Menu size={18} />
          </button>
          <AnimatePresence>
            {more && (
              <MotionPanel
                kind="menu"
                className={styles.moreMenu}
                id={moreId}
                data-workspace-nav=""
              >
                {[
                  ...opportunityLinks.map(({ page: p, label, icon }) => ({
                    page: p,
                    label,
                    icon,
                  })),
                  ...barLinks,
                ].map((l) => (
                  <button
                    key={l.page}
                    aria-current={page === l.page ? "page" : undefined}
                    onClick={() => go(l.page)}
                  >
                    <l.icon size={15} strokeWidth={1.6} />
                    {l.page}
                  </button>
                ))}
              </MotionPanel>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

/**
 * Bottom dock for the four primary sections. It rests as a slim handle and
 * slides up on hover or keyboard focus; the handle toggles it for touch.
 */
export function Dock({ page, navigate }: { page: Page; navigate: (p: Page) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const id = useId();
  useDismiss(open, () => setOpen(false), ref);
  const current = dockSections.find((s) => s.page === page);
  return (
    <nav
      ref={ref}
      className={styles.dock}
      data-open={open || undefined}
      aria-label="Primary sections"
      data-workspace-nav=""
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onFocus={(e) => {
        // Keyboard focus reveals the dock; pointer focus is handled by the
        // hover and handle-toggle paths so a tap does not open-then-close.
        if ((e.target as HTMLElement).matches(":focus-visible")) setOpen(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        className={styles.handle}
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Hide primary sections" : "Show primary sections"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.grip} aria-hidden="true" />
        <span className={styles.handleText}>{current ? current.label : "Sections"}</span>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronUp size={13} aria-hidden="true" />}
      </button>
      <div className={styles.dockItems} id={id}>
        {dockSections.map((s) => (
          <button
            key={s.page}
            className={styles.dockItem}
            aria-current={page === s.page ? "page" : undefined}
            title={s.page}
            onClick={() => {
              navigate(s.page);
              setOpen(false);
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            <s.icon size={19} strokeWidth={1.5} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
