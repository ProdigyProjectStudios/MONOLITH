export type Path = "refund" | "monitor";
export type Runtime = "api" | "browser";
export type Layer = {
  id: string;
  label: string;
  component: string;
  input: string;
  output: string;
  api: string;
  browser: string;
  invariant: string;
  files: string[];
};
export const paths: Record<
  Path,
  { name: string; description: string; layers: Layer[] }
> = {
  refund: {
    name: "Refund investigation",
    description:
      "Follow a refund investigation from canonical source rows to a human decision.",
    layers: [
      {
        id: "source",
        label: "Ingestion",
        component: "Source register",
        input: "CSV events and PDF pages",
        output: "Canonical events and page references",
        api: "FastAPI accepts an authenticated import. The parser validates event timestamps and normalises case identifiers before the transaction commits.",
        browser:
          "The Python worker processes CSV records. PDF.js extracts pages. Source and row identities follow the same analysis contract as the API.",
        invariant:
          "Conflicting event payloads cannot silently replace an existing event with the same identifier.",
        files: [
          "core.py · parse_csv / merge",
          "main.py · upload",
          "runtime-worker.js",
        ],
      },
      {
        id: "snapshot",
        label: "Frozen scope",
        component: "Investigation snapshot",
        input: "Workspace records and case window",
        output: "Immutable inputs scoped to a saved run",
        api: "The service writes a new run and its source snapshot under a tenant-scoped transaction. Repeats reuse those frozen inputs.",
        browser:
          "IndexedDB stores the run and its inputs. A replay can inspect its original evidence after the current workspace changes.",
        invariant:
          "A later import cannot change the denominator of a historical run.",
        files: [
          "investigation_api.py · _create",
          "investigations.ts · getSnapshot",
        ],
      },
      {
        id: "stages",
        label: "Specialists",
        component: "Six-stage investigation",
        input: "Frozen evidence and validated handoffs",
        output: "Structured findings, tool results and sequence numbers",
        api: "The deterministic engine executes bounded Python stages. A configured live run uses the Agents SDK and stage-specific tools. Independent architecture reviewers contribute their own recorded assessments on that path.",
        browser:
          "A Web Worker runs the deterministic Python investigation in Pyodide. Specialist roles, tool results and handoffs are recorded without a model request.",
        invariant:
          "An inferred cause stays an inference. Each finding retains the source identifiers its specialist cited.",
        files: [
          "investigator.py · validate",
          "portable_investigation.py · investigate_deterministic",
          "architecture_review.py",
        ],
      },
      {
        id: "scenario",
        label: "Simulation",
        component: "Counterfactual routing model",
        input: "Measured intervals and explicit routing assumptions",
        output: "Queue and batch trials with a sensitivity range",
        api: "The scenario function evaluates eligible cases under success, fallback, reviewer time and batch cadence. Costs depend on staffing and routing assumptions.",
        browser:
          "The worker runs the shared Python scenario function. Changing an assumption computes a fresh trial over the measured population.",
        invariant:
          "Elapsed interval savings and labour savings are separate measurements. A modelled gain requires subsequent pilot evidence.",
        files: [
          "flagship.py · simulate_scenario",
          "evaluation.py · _expected_trial",
        ],
      },
      {
        id: "evaluation",
        label: "Evaluation",
        component: "Independent snapshot replay",
        input: "Stage findings, source snapshot and candidate trials",
        output: "Objective checks, coverage, weaknesses and review items",
        api: "The evaluator recalculates objective measurements from original records. It compares the expected and recorded values stage by stage.",
        browser:
          "The same evaluator runs over the saved snapshot in the worker. Observatory can replay legacy results and display the checks separately.",
        invariant:
          "Resolving a citation establishes provenance. Causal and financial conclusions can still require review.",
        files: ["evaluation.py · evaluate", "Observatory.tsx · Evaluation"],
      },
      {
        id: "decision",
        label: "Decision",
        component: "Human approval and blueprint",
        input: "Verified eligible approach and independent checks",
        output: "Approved approach, time and linked engineering dossier",
        api: "The approval endpoint checks the run and proposed approach before storing the operator decision. The dossier reads the saved design, evidence and implementation artifacts.",
        browser:
          "The local approval transaction enforces the saved run's verification and design eligibility. A preview is available before a human approves the design.",
        invariant:
          "Selecting a blueprint records a design decision. Implementation and financial authority stay with the operator.",
        files: [
          "investigation_api.py · approve",
          "investigations.ts · approveApproach",
          "BlueprintDossier.tsx",
        ],
      },
    ],
  },
  monitor: {
    name: "Continuous monitoring",
    description:
      "Trace one stream revision through an observed change, checkpoint history and a later reassessment.",
    layers: [
      {
        id: "revision",
        label: "Revision",
        component: "Continuous monitor",
        input: "Changed tenant event stream",
        output: "An immutable analysis revision",
        api: "The persistent monitor records input revisions and processes queued work. Its history records the source fingerprint and comparison period.",
        browser:
          "A local sync reads the current dataset, stores a revision and publishes updated state to the workspace.",
        invariant:
          "Reimporting an identical stream preserves the existing revision history.",
        files: ["continuous_service.py", "continuousLocal.ts"],
      },
      {
        id: "window",
        label: "Windows",
        component: "Two-period detector",
        input: "Canonical events ordered by source timestamp",
        output: "Comparable previous and recent seven-day cohorts",
        api: "Two adjacent UTC windows expose latency, variant, activity mix, duplication and handoff changes. Each detector applies its own support and change criteria.",
        browser:
          "Pyodide executes the shared detector code and stores its exact window boundaries and sample source rows.",
        invariant:
          "A percentage-point change needs its denominator. Missing measurements stay unavailable.",
        files: [
          "continuous_engine.py · analyze_stream",
          "continuous_engine.py · _measurement",
        ],
      },
      {
        id: "graph",
        label: "Twin",
        component: "Historical relationship graph",
        input: "Events and unambiguous same-case transitions",
        output: "Entity and relationship counts for each observed epoch",
        api: "The snapshot stores typed nodes, directed edges, supporting cases and epoch-specific counts. Different revisions retain their historical topology.",
        browser:
          "The same snapshot feeds the twin's epoch selector and relationship inspector. The selected revision travels with the signal link.",
        invariant:
          "Source-backed ownership and inferred ownership have distinct origin labels.",
        files: [
          "continuous_engine.py",
          "HistoricalTwin.tsx",
          "graphHistory.ts",
        ],
      },
      {
        id: "checkpoint",
        label: "Checkpoints",
        component: "Change investigation",
        input: "Qualified signal, source witnesses and decision memory",
        output: "Six deterministic specialist checkpoints",
        api: "A worker advances the investigation one stage at a time. Each checkpoint binds its inputs and predecessor. A retry continues from the saved chain.",
        browser:
          "The browser saves the investigation as checkpoints complete. The same specialist functions compare the original subject and check the proposed designs.",
        invariant:
          "Historical constraints and rejected approaches remain available to the next specialist.",
        files: [
          "continuous_investigation.py · advance_investigation",
          "continuous_service.py",
          "continuousLocal.ts",
        ],
      },
      {
        id: "memory",
        label: "Memory",
        component: "Decision record",
        input: "Completed investigation or eligible refund dossier",
        output:
          "Decision, selected and rejected designs, evidence and authority",
        api: "Normalisation associates a decision with the original measurement, the selected proposal and any actual approval. Each tenant's records remain separate.",
        browser:
          "The local ledger retains original reasoning and evidence. The decision view distinguishes a proposal from a human approval.",
        invariant:
          "A successful verification alone cannot become an operator approval.",
        files: [
          "continuous_investigation.py · normalize_decision",
          "ContinuousTimeline.tsx",
        ],
      },
      {
        id: "outcome",
        label: "Reassessment",
        component: "Later observation",
        input: "Saved subject and newer source witnesses",
        output: "A comparison linked to the earlier decision",
        api: "The worker measures the original subject again, including signals that have cleared their alert threshold. It records the observed values and a new evidence set.",
        browser:
          "The shared reassessment function runs against the later imported stream. Both the decision and the later observation can be inspected.",
        invariant:
          "An improving measurement is an observation. Attributing it to a proposed change requires additional evidence.",
        files: [
          "continuous_investigation.py · reassess_decision",
          "continuous_engine.py · observe_subject",
        ],
      },
    ],
  },
};
