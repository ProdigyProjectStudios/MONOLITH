# The refund investigation

The Studio follows a frozen set of events and policy pages through six specialist stages. Use this guide to inspect the evidence, the simulated alternatives and the decision a human can approve. [Northstar walkthrough](release/showcase.md) · [Staging run receipt](release/evidence/staging-investigation.json)

## Execution modes

**Live mode** requires an operator to enable `MONOLITH_MODEL_CALLS_ENABLED=1` and configure a backend `OPENAI_API_KEY` or secret file on both services. The default is disabled. Continuous monitoring always uses deterministic algorithms. **Investigate with AI** starts an explicit provider-backed run. Six SDK specialists handle discovery, process intelligence, automation strategy, solution architecture, simulation and verification. Each has typed outputs and a read-only tool allowlist. The orchestrator requires actual tool receipts, binds citations to the current stage's retrieved records and checks reported case counts, timing and scenario estimates against measured or computed values. The verifier can withhold a recommendation.

The stage sequence is fixed. The model chooses how to inspect records, evaluates causal hypotheses, writes proposed engineering contracts, chooses simulation inputs and challenges preceding findings. Deterministic tools supply the process graph, measurements, simulation receipts and source records. Provider failure is persisted and displayed as a failed live attempt. Within solution architecture, reliability and operations reviewers each start a separate SDK context, retrieve evidence independently and rate both designs. Their assessments record confidence, the basis for it, trade-offs and vetoes. The verifier records the proposed and enforced verdicts. A vetoed design cannot be approved. Each specialist has a bounded tool and turn budget. The six-stage workflow has a seven-minute limit, with 160 seconds for architecture and up to 90 seconds for each other stage.

The Studio streams started and completed model calls alongside tool calls and handoffs. Inspect the model, provider request and response IDs, duration and reported input, cached and output tokens. Estimated USD cost uses operator-supplied rates in `OPENAI_MODEL_PRICING_JSON`, indexed by the requested model recorded by the SDK hook. Each rate entry has `input_per_million_usd`, `cached_input_per_million_usd` and `output_per_million_usd`. Missing usage or pricing remains unavailable. A failed attempt retains available receipts. The run records structured findings and their evidence, without storing private model reasoning.

**Deterministic mode** runs the same evidence tools with a rule-based evaluator. The synthetic dataset produces two eligible designs. At the default assumptions the event-driven queue projects **22.34 hours** and the scheduled digest **26.55 hours**, against **31.15 hours measured**. The policy PDF and dispute logs are inspectable from the trace. Neither approval nor export calls an external business API.

The **Scenario** tab models each observed interval individually. Successful routing can shorten its reducible portion while preserving review time. Failed routing adds an exception delay. Batch routing adds an assumed half-cadence wait. Workload and net GBP savings depend on explicitly editable touch times, routing coverage, failures and costs. The sensitivity band varies effectiveness by ±20% relative to its input. It is a what-if range. The model excludes dispute-linked cases from routing and retains refund authorisation. The architecture comparison also ranks the reference scenarios by median elapsed time, projected cost and expected failed cases. Changing the comparison objective leaves the underlying receipts intact.

**Business map** retains the 3D system topology and adds an operational twin with systems, ownership, processes, events and opportunities. Inspect an entity or edge, focus its neighbours, follow a case timeline, and open the corresponding process or investigation. Inferred ownership carries a distinct label. The connected-records inspector groups verified HubSpot observations by portal and deal ID, shows timestamped provenance and distinguishes exact links from inferred matches. Its correlation index excludes synthetic records. Imported CSVs can identify the CRM record with paired `hubspot_portal_id` and `hubspot_deal_id` fields. A deal ID alone can suggest a relationship. A configured `HUBSPOT_CASE_PROPERTY` supports explicit case references.

**Technical blueprint** exposes a dossier once a human approves a verified design. It includes the proposed system path, dependencies, API and data contract, database migration, workflow, security, failure recovery, rollout and acceptance criteria. The live architect's structured proposals accompany the evidence-derived artifacts. The other opportunity blueprints remain accessible.

## AI Engineering Observatory

Open **Agent Intelligence Studio → Observatory**. **Evaluation** replays source checks against the saved input, including event intervals, document citations, architecture eligibility, simulation outputs and retained human authority. Each stage exposes expected and recorded values, finding-level citations, weaknesses and conflicting recommendations. The score is the percentage of objectively testable checks that passed. Causal explanations and realised savings require independent evidence. An objectively failed evaluation holds new approvals.

**Trace** follows recorded model, tool and handoff events. **Compare** examines the selected run and up to three other saved investigations in this workspace. Data fingerprints distinguish matching inputs from different populations. Costs and token totals expose incomplete coverage. **Repeat** starts a new investigation on the frozen input, including retrieval from the saved document pages. The original trace, approvals and conclusions remain available. Deterministic repeat runs use no model credits. Live repeats use the worker's configured model and budget.

**Live run archive** reads a curated same-origin archive without connecting to the worker. Only an authenticated, successful official OpenAI run on the canonical Northstar dataset with valid source checks, independent reviews and a recorded human design approval qualifies for export. An empty catalogue is a supported state. The fixture-driven test suite exercises the positive path in isolation.

For a persistent HTTPS backend, use the [host deployment instructions](hosting-api.md) and [server credential and budget guide](live-runtime.md). The Site defaults to browser execution unless an API origin is configured.

## Durable API and streaming

The API snapshots the tenant's inputs when creating a run. A worker commits tool calls, results, errors, handoffs, verification and approval decisions to tenant-scoped storage. PostgreSQL and SQLite use the existing record schema. RQ and local workers share the same transactional execution claim. Worker heartbeats and leases make abandoned attempts recoverable. A retry uses immutable inputs and preserves the earlier trace.

| Endpoint | Operation |
| --- | --- |
| `POST /api/investigations` | Start a refund investigation with `days`, `mode` and an optional idempotency `request_id` |
| `GET /api/investigations` | List the authenticated workspace's runs |
| `GET /api/investigations/{id}` | Retrieve status, ordered events, result and approval |
| `GET /api/investigations/{id}/snapshot` | Retrieve the immutable evidence and report used for this run |
| `GET /api/investigations/{id}/events?after=N` | Subscribe to SSE from a saved cursor using the same bearer credential |
| `GET /api/investigations/{id}/evaluation` | Read independent source checks or recompute a legacy evaluation from its frozen inputs |
| `POST /api/investigations/{id}/repeat` | Schedule a new attempt in the original mode on exactly the same immutable snapshot, with a required idempotency `request_id` |
| `GET /api/runtime/readiness` | Check authenticated API, queue, worker and last observed workspace OpenAI response |
| `POST /api/investigations/{id}/resume` | Recover a failed or interrupted run as a linked attempt |
| `POST /api/investigations/{id}/approve` | Record approval of a verified routing design |
| `POST /api/flagship/package` and `/api/flagship/simulate` | Compute prospective designs and re-evaluate transparent assumptions |

## Interpreting the measurements

- A time window ends at the latest event timestamp in the dataset. Cases whose final event falls inside the window retain their complete traces. Sparklines bucket cases by their final timestamp.
- Cycle time measures the interval between the first and last observed events. A partial case can therefore have a shorter observed duration.
- Suitability combines a base of 40, up to 30 points for matching case volume and up to 25 for median preceding interval. The human-led rule overrides the score to zero. Rule confidence is the support heuristic `cases / (cases + 4)`, displayed as a percentage.
- Observed events, inferred relationships, proposed designs and simulation assumptions have distinct labels. The modelled output is aggregate elapsed case-hours. Overlapping case intervals and staffing costs require separate validation.
- The deterministic evaluator recognises the four showcase patterns. Other activity names still produce paths, system relationships and timing metrics. PDF evidence links are explicit and page-level. Scanned PDFs require prior OCR.
- Approval records a decision in MONOLITH. External execution requires a separate implementation and permission boundary.

## Publishing a verified replay

To publish a real accepted run for zero-credit playback, approve the verified design using the Studio, then re-read its authenticated trace with the command below. This export performs no provider calls. Review the resulting static archive and rebuild the frontend to publish it. Request and response identifiers are pseudonymised. The exporter rejects noncanonical data, unsupported conclusions, missing approval, and provider fixtures.

```sh
apps/api/.venv/bin/python scripts/verify-live-investigation.py \
  --api-url "$MONOLITH_API_URL" --run-id "$MONOLITH_RUN_ID" \
  --export-replay apps/web/public/replays
```
