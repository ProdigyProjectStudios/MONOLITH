# Reviewing MONOLITH

MONOLITH demonstrates the engineering path from an operational question to an evidence-backed automation design. Start with one complete investigation, then inspect the architecture and execution evidence.

[Open live Monolith](https://monolith.digitalprodigy.dev/) · [Repository overview](../README.md) · [Screenshot gallery](screenshots/README.md) · [Engineering overview](engineering-overview.md)

## A three-minute review

| Step | Open | What to inspect |
| --- | --- | --- |
| 1. Establish the problem | Overview → Intelligence feed → Open investigation | The observed 31.15-hour median between invoice re-entry and finance authorisation in 132 synthetic refund cases. |
| 2. Follow execution | Studio → Run deterministic investigation | Discovery, process intelligence, automation strategy, solution architecture, simulation and verification. Open tool results and their source records. |
| 3. Compare designs | Investigation outcome → Event-driven review queue / Scheduled review digest | Different coverage, reduction and failure assumptions. The reference projected medians are 22.34 and 26.55 hours, not observed production improvements. |
| 4. Challenge the answer | Observatory → Evaluation | Source checks, evidence coverage, interpretive review items and disagreements. A percentage for objective checks is not a probability that the entire recommendation is correct. |
| 5. Inspect the handoff | Architecture explorer; Technical blueprint after an eligible design is approved | Data contracts, implementation constraints, failure recovery, rollout and acceptance criteria. Approval records a design decision; it does not deploy an external automation. |

The **90-second walkthrough** in Studio offers a guided deterministic replay. To run the standalone workspace, follow [the README setup](../README.md#run-the-demo); no provider credential is required.

## Why this matters for client automation

Clients often know which questions they need answered before they know which system to build. MONOLITH makes that discovery work inspectable: reconstruct the process, identify where cases wait, examine supporting records, compare interventions and produce an engineering plan. A client-facing bot or integration could expose a narrower part of that workflow; Slack, Teams and Google Chat integrations are not claimed by this demonstration.

## Evidence and current scope

- **Real computation, synthetic inputs:** Northstar contains 1,706 events, 328 cases and five process variants. Intervals are calculated from event timestamps. Simulation outputs depend on editable assumptions.
- **Recorded staging execution:** [The saved receipt](release/evidence/staging-investigation.json) records six completed stages, seven tool results, 21 distinct evidence records, 40 objective checks passed, two for review and one disagreement. That run was deterministic and awaiting human approval.
- **Live provider path:** The server contains bounded OpenAI Agents SDK orchestration, typed stage outputs and receipt validation. The official live six-specialist run and accepted replay archive remain outstanding acceptance items.
- **Connectors and hosting:** HubSpot integration has controlled-provider coverage; live sandbox consent and synchronisation remain outstanding. Browser showcase, backend staging and permanent production hosting have separate acceptance boundaries.

For implementation and test detail, continue to [Investigation internals](refund-investigation.md), [Live runtime](live-runtime.md), [Workspace roles](workspace-access.md) and [Release readiness](release/readiness.md).
