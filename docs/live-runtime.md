# Live investigation runtime

The API and RQ worker run on the server. The browser sends a workspace bearer token to the API and receives tenant-scoped status and investigation events. PostgreSQL stores snapshots, results and call receipts. Redis dispatches work to the `monolith` queue.

## Start with a mounted provider key

1. Set a random database password, a unique strong bearer token for each workspace in `TENANT_TOKENS`, `MONOLITH_ENV=production`, and the exact studio origin in `WEB_ORIGINS`. Keep the environment file outside version control with mode 0600. The seeded example workspace is `northstar`.
2. Have your secret manager write the OpenAI project key to a read-only file outside the repository. Set `MONOLITH_OPENAI_SECRET_PATH` to its absolute host path. The key must be one printable ASCII value. Restrict the host file and its parent directory to the deployment identity.
3. Start the services from the repository root.

```sh
docker compose -f compose.yaml -f compose.openai-secret.yaml up --build -d
```

This overlay mounts `/run/secrets/openai_api_key` in both server containers and clears the inline Docker environment setting. Immediately before starting FastAPI or RQ, the server entrypoint validates the file and exports `OPENAI_API_KEY` in the service process. The key value stays out of the Compose definition, container configuration metadata and frontend. On this workspace a hidden prompt can create the file: `python3 scripts/configure-openai-key.py /workspace/.monolith-secrets/openai_api_key`. Set `MONOLITH_OPENAI_SECRET_PATH=/workspace/.monolith-secrets/openai_api_key` for the Compose command. Outside Compose, set `OPENAI_API_KEY_FILE` for both processes. If the file is configured, unreadable or malformed contents fail closed. Without a configured file the server reads `OPENAI_API_KEY`. Keep both settings out of browser build variables. OpenAI requests use the Responses API with storage disabled and tracing disabled. An HTTPS reverse proxy must terminate public traffic and support long-lived SSE. Keep PostgreSQL and Redis on the private network.

For a manually started RQ process, use `rq worker --worker-class monolith.runtime_worker.MonolithWorker --url "$REDIS_URL" monolith`. The Compose worker already uses this class. Each new investigation reads its credential anew. Recreate both server containers after replacing a bind-mounted file so they see the new inode. Previously persisted receipts retain their timestamps after rotation.

## Check a deployment

In **Data sources → Investigation runtime**, connect the API origin, authenticate to your workspace and check runtime readiness. The authenticated `GET /api/runtime/readiness` endpoint runs read-only database and Redis checks. The following check uses a workspace token already loaded in the operator environment.

```sh
python - <<'PY'
import json, os, urllib.request
url = os.environ["MONOLITH_API_URL"].rstrip("/") + "/api/runtime/readiness"
request = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["MONOLITH_WORKSPACE_TOKEN"]})
with urllib.request.urlopen(request, timeout=10) as response:
    print(json.dumps(json.load(response), indent=2))
PY
```

- `api.status` confirms this authenticated request reached the API. A development API without a configured tenant bearer map returns HTTP 401 for these diagnostics.
- `queue` reports connectivity to Redis and the number of waiting jobs. `worker.active` counts registered workers with a current RQ heartbeat on the investigation queue. A crashed worker can still appear during its heartbeat TTL. The worker's own heartbeat also reports whether it can read its configured credential. Compare `worker.reported` and `worker.provider_configured` with `worker.active`. Older standard RQ workers can execute jobs but supply no credential attestation. An unset `REDIS_URL` uses the local in-process executor.
- `provider.configured` and `source` describe the current API process. `verification=observed_response` requires a stored completed model-call receipt, in the current workspace, with an OpenAI response ID and the official HTTPS Responses endpoint. Its timestamp and run ID identify historical evidence. Only a new successful provider request can establish access with the current key. The readiness check issues zero provider calls.
- To verify an authorized live investigation, follow `scripts/verify-live-investigation.py --help`. Reading an existing run is free of new model calls. Starting a new live run sends the scoped investigation evidence to the provider and consumes the project's budget. A protocol fixture or compatible endpoint has separate provenance.

## Bound spending and recover an attempt

| Server setting | Default | Enforcement |
| --- | ---: | --- |
| `OPENAI_MAX_CALLS_PER_RUN` | 64 | Maximum model requests across all specialists and reviewers, including failed requests. |
| `OPENAI_MAX_OUTPUT_TOKENS_PER_RUN` | 80000 | An attempt's shared generated-token allowance. The worker reserves the requested maximum before dispatch and refunds the unused portion only when the provider reports output usage. |
| `OPENAI_MAX_OUTPUT_TOKENS_PER_CALL` | 2500 | Maximum generated tokens per model request, lowered to the remaining run allowance. |

The API reports its configured limits. The worker enforces its own configuration. The supplied Compose file sets both from the same variables. All three accept positive integers. Upper bounds are 256 calls, 1,000,000 output tokens per run and 32,000 per call. Invalid limits block live execution. Input tokens and platform-specific charges remain billable. Configure project billing alerts and per-model pricing separately. Receipts include reported input/output counts and identify missing usage. Ambiguous failures consume their full output reservation locally.

The worker disables HTTP model retries and redirects, bounds each provider request and each stage, and retains completed receipts when a later call fails. A budget denial records `provider_budget_exhausted` and stops the attempt before another model request. After an interruption, denial or timeout, inspect the attempt and select **Resume** to start a fresh bounded attempt from the same immutable input snapshot. A new attempt can incur additional charges. Investigation creation supports a stable `request_id` for safe network retries, and resume returns the same retry child for repeated requests. The API's two-active-attempt limit applies per tenant.
