# Investigation recovery and verification

## What survives a restart

Studio saves its source snapshot, request ID, queued event and delivery record in one database transaction. The API scheduler reconciles outstanding delivery records at startup and every two seconds while it runs. SQL ownership checks let one worker execute a run even if the broker delivers it twice.

| Situation | Runtime behaviour | Operator-visible evidence |
|---|---|---|
| API exits after saving a deterministic run and before enqueue | A restarted API delivers the saved run. A missing worker claim is eligible for redelivery after the 180-second queue lease. | The same request ID returns the same run and frozen input. |
| Broker refuses or loses deterministic delivery | Up to three deliveries share one run. Explicit enqueue errors back off for two and four seconds before the next delivery. | A persistent failure ends the attempt and makes Resume available. |
| Deterministic worker dies after claiming a run | The 60-second worker lease expires. The scheduler preserves the partial attempt and starts at most one automatic child from its frozen input, subject to workspace concurrency. | The old trace ends in `run_interrupted`. Its `retry_id` links the child, whose `parent_id` points back. A further worker death leaves the child interrupted until an operator resumes it. |
| Live worker or delivery is interrupted | A scheduler pass expires the lease. Resubmitting live work requires a new authorized dispatch. | Previously recorded provider turns remain in the original attempt. An operator can inspect them before deciding whether to resume. |
| SSE reader disconnects | Send its last processed sequence through `Last-Event-ID` or `?after=`. A cursor beyond the run's current sequence returns HTTP 422. | The reader receives subsequent events in sequence. The exact terminal cursor returns an empty stream. |

A worker renews its lease every 20 seconds. A stale worker cannot add events or replace a completed result. New work runs within the two-active-investigation limit per workspace. RQ receives the workspace identifier and the available W3C trace parent as job metadata. The scheduler runs inside the API process.

## Model controls

Both the Studio investigation and the optional five-pass AI report require operator enablement and an authorized model caller. Each uses the server-owned Responses client, disables HTTP retries and redirects, checks the enable switch before sending a model turn, and enforces shared call/output-token limits. A five-pass report has a 300-second overall model deadline. An explicit request for AI fails if the worker lacks a valid credential. A report finding must cite evidence that its own specialist read.

The report endpoint used for ordinary viewing performs deterministic analysis. The finite-lived `/api/analysis` Redis result is for a requested report. Studio stores its investigation history, frozen inputs, approvals and SSE events in SQL.

## Independent checks before approval

Evaluation version 2 reconciles scenario output with the original source intervals. It checks elapsed hours, the baseline and projected medians, operating and staff costs, workload, reviewer counts, attempts, failures, retained approvals, hypothetical net savings and the sensitivity range. New approvals reconcile the frozen source again and respect reviewer vetoes. The historical decision and the stored evaluation remain available in the run record. The evaluation endpoint can recalculate older audits on read.

## Reproduce the offline acceptance checks

From `apps/api`, run the following command. Provider protocol tests use an in-process fixture transport.

```sh
MONOLITH_MODEL_CALLS_ENABLED=0 uv run pytest -q \
  tests/test_engine.py tests/test_evaluation.py tests/test_investigation_api.py \
  tests/test_live_runtime.py tests/test_provider_contract.py \
  tests/test_replay_capture.py tests/test_live_acceptance.py
```

The failure-injection suite uses SQLite with concurrent claims, deliberate broker delivery loss, a stale worker, source tampering and an operator-disabled provider. The deployment acceptance report tracks the separate PostgreSQL and Redis restart drill.
