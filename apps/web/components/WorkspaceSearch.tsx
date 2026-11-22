import { Focus, Search, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import type { Page, Rec } from "../lib/types";
import { menu } from "./UI";

const aliases: Partial<Record<Page, string>> = {
  "Intelligence studio": "investigations observatory replay",
  "Business map": "topology systems handoffs",
  "Process explorer": "processes paths cases",
  "Technical blueprint": "blueprints implementation",
  "Continuous intelligence": "monitoring changes",
  "Agent activity": "agents traces",
  "Data sources": "connections imports",
};

export default function WorkspaceSearch({
  recs,
  close,
  navigate,
  inspect,
}: {
  recs: Rec[];
  close: () => void;
  navigate: (page: Page) => void;
  inspect: (rec: Rec) => void;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const matches = (value: string) =>
    value.toLowerCase().includes(query.trim().toLowerCase());
  const views = menu.filter((item) =>
    matches(item.page + " " + (aliases[item.page] || "")),
  );
  const signals = recs.filter((rec) => matches(rec.title + " " + rec.area));
  const results = useRef<HTMLDivElement>(null);
  function move(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const buttons = Array.from(
      results.current?.querySelectorAll("button") ?? [],
    );
    if (!buttons.length) return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === "Enter" && event.target === search.current) {
      event.preventDefault();
      buttons[0].click();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = index + (event.key === "ArrowDown" ? 1 : -1);
      (next < 0 || next >= buttons.length
        ? search.current
        : buttons[next]
      )?.focus();
    }
  }
  return (
    <div
      className="overlay search-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="command"
        role="dialog"
        aria-label="Search workspace"
        aria-modal="true"
        onKeyDown={move}
      >
        <div className="command-input">
          <Search size={20} aria-hidden="true" />
          <input
            ref={search}
            aria-label="Search views and opportunities"
            placeholder="Search views and opportunities…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="icon-btn"
            aria-label="Close search"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div className="command-results" ref={results}>
          {views.map((item) => (
            <button key={item.page} onClick={() => navigate(item.page)}>
              <item.icon size={16} /> {item.page} <small>Workspace</small>
            </button>
          ))}
          {signals.map((rec) => (
            <button key={rec.id} onClick={() => inspect(rec)}>
              <Focus size={16} /> {rec.title} <small>Opportunity</small>
            </button>
          ))}
          {!views.length && !signals.length && (
            <p className="empty" role="status">
              No matching views or opportunities.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
