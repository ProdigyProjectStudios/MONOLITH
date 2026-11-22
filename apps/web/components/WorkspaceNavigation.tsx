import { Expand, Menu, Minimize2, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Page, State } from "../lib/types";
import { menu } from "./UI";
import ObservationWindow from "./ObservationWindow";

const shortcuts: { label: string; page: Page }[] = [
  { label: "Overview", page: "Overview" },
  { label: "Investigations", page: "Intelligence studio" },
  { label: "Processes", page: "Process explorer" },
  { label: "Blueprints", page: "Technical blueprint" },
];
const sections: { label: string; pages: Page[] }[] = [
  { label: "Explore", pages: ["Overview", "Business map", "Process explorer"] },
  {
    label: "Investigate",
    pages: ["Opportunities", "Intelligence studio", "Continuous intelligence"],
  },
  {
    label: "Operate",
    pages: ["Technical blueprint", "Agent activity", "Data sources"],
  },
];

export default function WorkspaceNavigation({
  page,
  state,
  org,
  runtimeLabel,
  datasetLabel,
  opened,
  focused,
  onNavigate,
  onToggle,
  onFocus,
  onSearch,
  controls,
}: {
  page: Page;
  state: State | null;
  org: string;
  runtimeLabel: string;
  datasetLabel: string;
  opened: boolean;
  focused: boolean;
  onNavigate: (page: Page) => void;
  onToggle: (opened: boolean) => void;
  onFocus: (focused: boolean) => void;
  onSearch: () => void;
  controls?: ReactNode;
}) {
  return (
    <>
      <header id="workspace-masthead" className="masthead">
        {focused ? (
          <button
            className="restore-mast"
            onClick={() => onFocus(false)}
            aria-label="Restore navigation"
          >
            <Minimize2 size={16} /> Restore navigation
          </button>
        ) : (
          <>
            <button
              type="button"
              className="wordmark"
              aria-label="MONOLITH overview"
              onClick={() => onNavigate("Overview")}
            >
              MONOLITH <i aria-hidden="true">/</i>
            </button>
            <nav className="primary-nav" aria-label="Primary navigation">
              {shortcuts.map((item) => (
                <a
                  key={item.page}
                  href={"#" + item.page.toLowerCase().replaceAll(" ", "-")}
                  aria-current={item.page === page ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    onNavigate(item.page);
                  }}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mast-tools">
              <div className="workspace-scope">
                <strong title={org}>{org}</strong>
                {state && <span title={datasetLabel}>{runtimeLabel}</span>}
              </div>
              <button
                className="mast-icon"
                aria-label="Search workspace"
                aria-haspopup="dialog"
                aria-keyshortcuts="Control+K Meta+K"
                onClick={onSearch}
              >
                <Search size={17} />
              </button>
              <button
                className="workspace-index-button"
                type="button"
                aria-label="Open navigation"
                aria-controls="workspace-navigation"
                aria-expanded={opened}
                aria-haspopup="dialog"
                onClick={() => onToggle(true)}
              >
                <Menu size={18} />
                <span>Workspaces</span>
              </button>
            </div>
          </>
        )}
      </header>
      {opened && (
        <div
          className="index-scrim"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onToggle(false);
          }}
        >
          <aside
            id="workspace-navigation"
            className="sidebar mobile-open"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
          >
            <div className="index-title">
              <h2>Workspaces</h2>
              <button
                className="icon-btn"
                aria-label="Close navigation"
                onClick={() => onToggle(false)}
              >
                <X size={20} />
              </button>
            </div>
            <nav className="index-groups" aria-label="Workspaces">
              {sections.map((group) => (
                <section className="nav-group" key={group.label}>
                  <h3>{group.label}</h3>
                  {group.pages.map((view) => {
                    const item = menu.find((entry) => entry.page === view)!;
                    return (
                      <button
                        key={view}
                        className="navitem"
                        aria-current={page === view ? "page" : undefined}
                        onClick={() => onNavigate(view)}
                      >
                        <item.icon size={16} strokeWidth={1.5} />
                        {view}
                      </button>
                    );
                  })}
                </section>
              ))}
            </nav>
            <div className="index-context">
              <div>
                <strong>{org}</strong>
                <p>
                  {datasetLabel}
                  {state?.identity && " · " + state.identity.role}
                </p>
              </div>
              {state && <ObservationWindow state={state} />}
            </div>
            <div className="index-utilities">
              {controls}
              <button
                className="text-btn focus-action"
                onClick={() => {
                  onToggle(false);
                  onFocus(true);
                }}
              >
                <Expand size={15} /> Expand workspace
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
