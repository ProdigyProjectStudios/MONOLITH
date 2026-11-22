# Workspace accessibility and interaction audit

## Acceptance run

Chromium exercised the production static export at 1440 × 960, 820 × 1180 and 390 × 844, with reduced motion enabled. Each context had independent browser storage. The audit used axe-core 4.11.1 with the WCAG 2.0, 2.1 and 2.2 A/AA tags supported by axe. The initial sweep found an unnamed search button on every mobile route. The repeated sweep reported zero automated violations across 40 page and overlay states. All 104 interaction, layout and isolation assertions passed.

The browser loaded only loopback assets and ran the shipped Python worker against synthetic records. The recovery test served one HTTP 503 for the demo dataset and then returned the real Python engine’s report for an empty organization. A separate interaction rejected a malformed CSV, imported the published backlog CSV under a new filename and enabled the matching recovery stream.

| Workspace | Interaction and result |
|---|---|
| Overview | First Tab exposes the skip link. It focuses the page heading. Search traps keyboard focus, announces an empty result and restores the opener on Escape. A missing observation now shows a dash for cycle time. Sparklines expose their series and metric to assistive technology. |
| Business map | The history range accepts keyboard movement and disables Previous at the earliest epoch. The graph inspector exposes canonical relationships and source evidence. Fit-to-view respects reduced motion. |
| Process explorer | Choosing another variant updates the case selector. The graph has an ordered text equivalent for its observed sequence. |
| Opportunities | The row action opens the detail dialog by keyboard. Escape returns focus to the same row. |
| Technical blueprint | The opportunity selector changes the displayed design. An empty organization explains the evidence requirement. The architecture steps have an ordered text equivalent. |
| Intelligence studio and Observatory | A fresh Observatory shows its empty-run state. The live archive reports that no verified capture is available. Global search cannot open underneath its modal dialog. |
| Continuous intelligence | The revision selector and comparison view respond to keyboard input. Missing timestamps produce an empty-period explanation. The synthetic ingestion workflow recognises a renamed, byte-verified training file by its canonical event identity. |
| Agent activity | A specialist record expands with Enter. The trace and audit trail each explain their empty state. |
| Data sources | A rejected import can be dismissed and followed by a successful import. Source rows announce expanded state. Empty registries are explicit. The UI checks source-write and connector-management permissions before exposing those operations. |

The mobile menu is excluded from the accessibility tree while closed. Opening it focuses the active workspace. Reverse Tab stays inside the menu and Escape restores the hamburger button. Desktop, tablet and mobile checks found no document-level horizontal overflow in the sampled states.

## Reproduction

From the repository root, install the pinned packages and the API test environment, build the static export, then run:

```sh
MONOLITH_QA_OUTPUT=/tmp/monolith-accessibility node scripts/test-workspace-accessibility.mjs
```

Use `CHROMIUM_PATH` to select the Chromium executable and `MONOLITH_QA_DIST` to select another built export. The output directory contains the versioned axe results, individual checks, viewport measurements and screenshots. Independent production-authentication, authenticated API, investigation, continuous-monitoring and portfolio checks cover those paths separately. This audit did not include spoken-output testing with a screen reader, Safari/Firefox compatibility or paid model execution.

A separate specialist-pipeline smoke test ran in Firefox desktop and phone-sized Playwright WebKit. Both completed the WASM investigation and restored its state after a reload. Those engine tests are recorded in [browser-engines.json](evidence/browser-engines.json). Native iOS hardware and spoken assistive-technology output remain untested.
