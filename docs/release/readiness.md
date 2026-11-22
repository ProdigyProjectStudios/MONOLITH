# MONOLITH V1 release acceptance

## Release decision

The V1 scope is a single persistent installation serving multiple workspaces through FastAPI, PostgreSQL, Redis/RQ and a same-origin gateway. The private Site separately serves the portable Northstar showcase. General production sign-off is withheld. A permanent host, public TLS, external operations and two provider acceptance runs still require owner-controlled infrastructure or authorisation.

On 22 November 2026, the retained staging installation completed a 30-day Northstar refund investigation on its RQ worker. It persisted six completed stages, five handoffs and seven tool results. All eight findings cited evidence, spanning 21 distinct records. Independent replay reported 40 passing checks and two requiring review, with one recorded disagreement. The saved design awaits human approval. The investigation used deterministic analysis and made zero model calls. [Staging investigation receipt](evidence/staging-investigation.json)

The release acceptance suite passed all 14 executable application gates. After correcting a PostgreSQL-specific grouping error found in the first load drill, the final backend passed all 205 tests again in 67.96 seconds. The final container passed the PostgreSQL metrics, traffic and restore checks.

### Application and intelligence

| Gate | Status | What was exercised |
| --- | --- | --- |
| Source ingestion and provenance | PASSED | CSV, PDF, read-only connector records and validated JSON event batches. Tests cover duplicate and conflicting writes, bounded parsing, provenance and tenant isolation. |
| Persistent process and business memory | PASSED | Source revisions, process and dependency graphs, backlog and recovery windows, drift alerts, cited records, historical replay and reassessment. The Northstar business data and added streams are synthetic. |
| Six-specialist investigation | PASSED | Deterministic engine and controlled OpenAI SDK transport tests. Evidence retrieval, staged handoffs, qualifications, independent checks, rejection of unsupported output and trace replay. |
| Architecture, simulations and authority | PASSED | Competing routing proposals, measured source intervals, labelled scenario assumptions, protected approval, vetoes and blueprint generation. No external refund or dispute execution is enabled. |
| Authentication and tenant permissions | PASSED | Named viewer, analyst, approver and administrator identities, rotation, server-side authorisation, empty tenants, scoped reads and exports and actor attribution. |
| Queues, streaming and failure recovery | PASSED | Idempotent dispatch, worker fencing, stranded work reconciliation, stage recovery, ordered SSE and cursor replay. Explicit model jobs are protected against unintended automatic re-execution. |
| HubSpot connector implementation | PASSED | Controlled OAuth, refresh, encrypted storage, read-only scopes, checkpoints, rate limits, deduplication, revocation and tenant binding. |
| HubSpot sandbox acceptance | BLOCKED | Owner deferred sandbox consent. Provision the read-only app and encryption material on the backend, register the HTTPS callback, consent on a test portal, sync twice including a changed record, revoke and confirm isolation and audit. |
| Official OpenAI investigation and zero-credit live replay archive | BLOCKED | Paid calls are disabled. When explicitly authorised, mount a newly issued server secret, set a finite budget, run the live verifier, inspect all six execution receipts and citations, then review the design and export an approved redacted replay. |

The functional gate receipts include the command results. The application report identifies the base Git revision and whether candidate changes were present. The artifact manifest fingerprints the actual application and frontend used during acceptance. [Application receipts](evidence/application.json) · [Artifact manifest](evidence/manifest.json) · [Job reliability](job-reliability.md) · [Live verification](../live-runtime.md)

### Platform and operations

| Gate | Status | Evidence and boundary |
| --- | --- | --- |
| Telemetry, limits and health | PASSED | HTTP and worker spans, OTLP HTTP export to a controlled collector, redacted structured events, per-actor limiting and readiness on dependency loss. Loopback monitoring delivered an incident and recovery and suppressed repeats. |
| Export, retention and erasure | PASSED | Tenant-scoped paginated export, audit expiration, workspace erasure, queue cleanup and prevention of erased demo reseeding. Archived backups have a separate retention policy. |
| Dependency and image scan policy | PASSED | 171 npm and 80 Python packages audited. No application dependency advisories and no fixable HIGH/CRITICAL image findings at scan time. Remaining HIGH/CRITICAL advisory records without a published fix were 50 for the app, 1 for the gateway, 117 for PostgreSQL and 0 for Redis. Re-scan at promotion and review the unresolved records with the deploying operator. |
| Retained staging frontend and backend | PASSED | Chromium signed in as a viewer on the production-profile gateway, reloaded a persisted report, paged authenticated records, signed out and connected as administrator. Observed zero third-party or browser-demo requests. Private loopback TLS 1.3 verified the host certificate, API readiness and production entry document. |
| Five-service deployment and restart recovery | PASSED | Staging exercised real PostgreSQL, Redis, API, worker and gateway. A queued job survived Redis restart and worker outage. Cursor replay returned the saved events from a deterministic investigation with 34 frames. |
| Verified backup, restore, migrations and rollback | PASSED | A coordinated PostgreSQL/Redis backup took 9.93 s. A clean-project rollback took 66.51 s. Checks reconciled 1,772 record rows and the audit, vector and migration tables. A corrupted backup and an unsafe in-place restore were rejected. |
| Concurrent load | PASSED | 72/72 authenticated requests completed at concurrency six. Median 88.70 ms, p95 162.58 ms, maximum 192.92 ms. This sample is for the workspace installation. |
| Service limit configuration | PASSED | Compose and Docker reported the configured CPU, memory and PID ceilings for all five services. |
| Per-service isolation under resource exhaustion | NOT TESTED | The workspace Docker daemon runs without a cgroup driver. The strict CI and production release commands reject this daemon before deployment. Verify enforcement and headroom on the persistent host under representative load. |
| Persistent public backend, external DNS and publicly trusted TLS | BLOCKED | Owner selected workspace staging. Provision a Linux host, DNS, persistent storage and secret manager, then deploy the tested gateway/application/database digests and exercise the production origin. |
| Protected CI/CD promotion | NOT TESTED | Workflow definitions were statically checked. Register the protected environments and runners, publish the tested images, perform an actual staging promotion and require an independent production approval. |
| External incident delivery and off-host backup durability | NOT TESTED | Configure an independent monitor and operator-owned receiver, replicate an encrypted backup to separate storage, and restore from that copy. |
| Extended soak, hardware loss and production capacity | NOT TESTED | Run representative tenant sizes and traffic through the intended host over the agreed observation period. Workspace measurements cover the recorded short traffic and recovery drill only. |

[Retained staging entry](evidence/staging-entry.json) · [Loopback TLS](evidence/staging-tls.json) · [Docker drill and timings](production-drill.json) · [Unresolved image advisories](evidence/dependency-advisories.json) · [Infrastructure runbook](../production-operations.md) · [Monitoring and lifecycle](operations.md) · [Scan receipts](security-gate.json) · [Ingestion](../ingestion.md) · [Workspace access](../workspace-access.md)

### Portfolio and browser acceptance

| Gate | Status | Verified behaviour |
| --- | --- | --- |
| Nine existing workspace views | PASSED | Desktop, tablet and mobile navigation, focus management, loading, empty and error states, evidence/revision drill-through and reduced motion. |
| Guided Northstar investigation | PASSED | 90 seconds of chapter timing, six saved stage receipts, source evidence, architecture comparison, simulation trials and blueprint. All visitor evidence is synthetic or locally computed. |
| Architecture explorer, Observatory and case study | PASSED | Interactive component contracts, context-dependent trace and evaluation views, saved-run comparison and technical explanation of 132 source intervals with a 31.15-hour median. |
| Desktop and mobile browser engines | PASSED | Chromium exercised the full flows. Firefox desktop and WebKit mobile emulation completed and restored a six-stage WASM investigation. |
| Automated accessibility | PASSED | 40 axe-scanned states and 104 interaction/layout checks, with no reported violations or failed interactions in this matrix. |
| Native iOS Safari and spoken screen reader | NOT TESTED | Exercise real hardware and assisted technology before claiming device or accessibility certification. |

[Guided showcase](showcase.md) · [Accessibility coverage](workspace-accessibility.md) · [Browser engine receipts](evidence/browser-engines.json) · [Accessibility receipts](evidence/accessibility.json) · [Original audit and acceptance criteria](completion-matrix.md)
