# Connect the hosted Studio to a persistent backend

The private MONOLITH Site serves a static Next.js export. It can run Northstar locally in WebAssembly, read a published investigation archive, or connect to a separately operated HTTPS FastAPI server. API secrets belong on that server and the RQ worker. A visitor does not need a workspace token or a model key to explore the browser workspace or a curated archive.

## Deploy the API and worker

1. Choose a persistent Docker Compose host with storage for PostgreSQL, Redis and TLS state. Point a DNS hostname you control at it and allow inbound TCP 80 and 443. Work from the same MONOLITH revision as the hosted client. The site hostname belongs to the frontend. Give the API its own hostname.
2. On a fresh host, run `(umask 077; cp -n .env.example .env)` and set the entries below using the host's secret manager or restricted editor. Generate separate database and workspace secrets with `openssl rand -hex 32`. For an existing database keep its current database password, project name, volumes and workspace-token mapping.

   | Setting | Value |
   | --- | --- |
   | `DB_PASSWORD` | Database password |
   | `TENANT_TOKENS` | JSON mapping, e.g. `{"northstar":"<independently generated workspace token>"}` |
   | `MONOLITH_API_HOST` | Your API hostname, e.g. `api.example.org`, without a scheme or path |
   | `WEB_ORIGINS` | `https://monolith-northstar-intelligence.claritysystemsstudio.chatgpt.site` |
   | `MONOLITH_OPENAI_SECRET_PATH` | Absolute path to a restricted, single-line OpenAI project key file outside the source checkout |

3. Mount the key on both services and start the persistent stack. The gateway provisions TLS, forwards SSE frames as they arrive and exposes the API routes. The database and queue live on the internal network.

   ```sh
   docker compose -f compose.yaml -f compose.hosted.yaml -f compose.openai-secret.yaml up -d --build
   docker compose -f compose.yaml -f compose.hosted.yaml -f compose.openai-secret.yaml ps
   ```

   For a backend without provider credentials, omit `-f compose.openai-secret.yaml` and leave the provider environment variables empty. The authenticated deterministic path and runtime diagnostics work independently of OpenAI. The [runtime guide](live-runtime.md) covers secret file setup, limits, worker checks and key rotation.

4. Check `https://YOUR_API_HOST/api/health` returns JSON with `status: "ok"`. In the hosted Studio, open **Data sources → Investigation runtime**, enter your actual HTTPS origin, then **Connect API**. Enter the Northstar workspace bearer when prompted. **Check runtime** reads the authenticated API, queue and worker report. An OpenAI response receipt appears only after a model returns one. This connection applies to the current browser tab. To set a fleet-wide default, set `NEXT_PUBLIC_API_URL` to the verified API origin at frontend build time and republish the static export. The browser always receives the value of a `NEXT_PUBLIC_` variable.

5. In **Agent Intelligence Studio**, choose **Investigate with AI** to run the six specialists and two architecture reviewers against the Northstar snapshot. Inspect the evaluation and evidence before approving a design. **Repeat** on a completed run schedules new execution on the original snapshot. Live repeats consume model credits. Replay and comparison read saved results.

## Operations

PostgreSQL holds tenant evidence, snapshots, traces and decisions. The hosted overlay enables Redis append-only persistence for queued jobs, uses restart policies and retains Caddy TLS state. Back up the database and operator-managed keys. Retain the same Compose project name and volumes across upgrades. Worker leases record interruptions and support a linked retry through the Studio. The read-only readiness endpoint is `GET /api/runtime/readiness`, authenticated with the workspace bearer.

For account-free replay, use the live acceptance verifier and export procedure in the [project README](../README.md). Only a completed, independently checked and human-approved canonical Northstar run qualifies for publication in the showcase archive.
