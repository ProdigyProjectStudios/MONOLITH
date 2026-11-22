# Production operations

Production releases require a Docker daemon with cgroups enabled. The CI drill reads each service’s kernel CPU, memory and PID quotas and compares them with its configured limits. Rootless Docker needs cgroup delegation on its host.

The production profile serves the frontend and API on one TLS origin through Caddy. PostgreSQL stores tenant records, migrations and audit history. Redis carries RQ jobs and uses append-only persistence. The gateway, API, worker, database and queue each have a health probe, a CPU cap, a memory cap, a PID cap and rotating logs. The API and worker run with UID 1000, a read-only root filesystem and an isolated writable temporary directory.

## Host and credentials

Use a dedicated Linux Docker Engine host with the Compose v2 plugin (2.24.4+ for the overlay syntax), Python 3.12+, persistent volume storage and a monitored, separately protected backup destination. Keep production and staging in separate projects, with different credentials, volumes, ports and ingress hostnames. Staging binds to loopback and disables model calls. Production exposes only the gateway on TCP 80/443. Configure the host kernel for Redis background saves, including `vm.overcommit_memory=1` as recommended by Redis. Size the host using observed peak memory, CPU and storage growth, including backups and temporary space for recovery. Copy-on-copy Docker storage such as VFS needs extra space per running container.

Keep the environment file outside the checkout, mode 0600. Supply a random URL-safe database password, the exact HTTPS origin in `WEB_ORIGINS`, the hostname in `MONOLITH_API_HOST`, and an independent `TENANT_IDENTITIES` entry for each operator. Give people individual roles and revoke by rotating or removing their entries. `TENANT_TOKENS` supplies legacy tenant administrator access. Set `MONOLITH_SEED_DEMO=0` on a new customer host to skip the synthetic Northstar dataset. Store connector encryption and OAuth secrets in the host's secret manager. Protect release-registry pull credentials and the keys needed to decrypt both backups and connector records separately.

Live provider calls default off. Hosts enabling them should mount the secret overlay via `--openai-secret`, set the runtime budget explicitly, and provision `MONOLITH_OPENAI_SECRET_PATH` outside the source checkout. Its file owner must map to container UID 1000 for a 0600 file. With user namespaces, verify the mapping on the target host. Both API and worker read the mounted file; the gateway receives no provider key. Confirm availability through the authenticated runtime diagnostics. Backups contain tenant data and may contain encrypted connector credentials, traces and queued jobs. Use encrypted storage, separate access controls, retention and an off-host copy. The archive includes neither the secret manager nor TLS state. Preserve them separately or reprovision TLS through Caddy.

## Release through CI

Pull requests and pushes to main run the locked dependency build, API tests, Chromium tests, dependency audits, image scans, and the disposable release/restore drill on a GitHub-hosted runner. The release gate blocks HIGH/CRITICAL npm advisories, Python advisories, unaudited Python packages and fixable HIGH/CRITICAL runtime image advisories. All image HIGH/CRITICAL findings, including those without a published fix, are retained in the scan reports.

Configure protected GitHub environments named `staging` and `production`, with main-only deployment and an independent required reviewer on production. Provide dedicated Linux runners labelled `monolith-staging` and `monolith-production` that accept only trusted deployment workflow jobs, with registry pull access. Configure these host variables in the runner service:

| Variable | Host value |
| --- | --- |
| `MONOLITH_ENV_FILE` | Absolute private deployment environment file |
| `MONOLITH_PROJECT` | Stable Compose project name for this host |
| `MONOLITH_BACKUP_ROOT` | Existing restricted backup directory with independent replication |
| `MONOLITH_ORIGIN` | Reachable HTTPS origin or staging loopback HTTP origin |
| `MONOLITH_MOUNT_OPENAI_SECRET` | Set to 1 only on a host configured for mounted credentials |

Select **Verify and promote MONOLITH** on main and enable **Publish tested images and deploy through protected environments**. After the verification job passes, a separate job publishes its exact saved application, gateway and database images to GHCR and resolves registry digests. Staging deploys those digests, checks the same-origin production document and readiness, then production waits for its protected environment. Preserve previous registry digests for the full rollback retention period. GitHub environment protection and runner registration are operator-owned settings.

## Local release and health

From the repository root, build from a clean locked checkout on an approved builder. The gateway packages the production frontend from `dist/`. The app build uses the digest-pinned Python and uv images, the frozen Python lock, and a pinned zlib security update fetched with Debian's signed package metadata.

```sh
npm ci
npm run build
docker build -t monolith-candidate:app apps/api
docker build -f deploy/gateway.Dockerfile -t monolith-candidate:gateway .
docker build -f deploy/database.Dockerfile -t monolith-candidate:db .
APP_REF=$(docker image inspect -f '{{.Id}}' monolith-candidate:app)
GATEWAY_REF=$(docker image inspect -f '{{.Id}}' monolith-candidate:gateway)
DB_REF=$(docker image inspect -f '{{.Id}}' monolith-candidate:db)
python deploy/operations.py --env-file "$MONOLITH_ENV_FILE" --project "$MONOLITH_PROJECT" --stage staging release --app "$APP_REF" --gateway "$GATEWAY_REF" --database "$DB_REF" --backup "$MONOLITH_BACKUP_ROOT/pre-release-$(date -u +%Y%m%dT%H%M%SZ)"
curl -fsS "$MONOLITH_ORIGIN/api/health/ready"
```

Use registry digests for cross-host operations. The release command validates immutable references, pauses the API and worker on an existing deployment, checkpoints its data first, runs pending SQL migrations in the chosen app image, then waits for healthy services. A new empty deployment starts with the tracked migrations. A failed migration or readiness check exits nonzero and stops promotion. The runner serializes release, backup and rollback operations by project. A failed release can need the operator's cutover decision.

`GET /api/health` is process liveness. `GET /api/health/ready` returns 200 when the database, queue and eligible worker are available and 503 for a dependency failure. The worker's container probe checks its own registered RQ heartbeat. The authenticated operator metrics expose queue/worker state, HTTP timings and tenant-scoped record counts. Configure `OTEL_EXPORTER_OTLP_ENDPOINT` on trusted internal infrastructure for trace export. Defaults are 180 authenticated requests per minute and 90 days of audit retention. Change them with `MONOLITH_RATE_LIMIT_PER_MINUTE` and `MONOLITH_AUDIT_RETENTION_DAYS`. Set CPU/memory limits through the per-service `MONOLITH_*_CPUS` and `MONOLITH_*_MEMORY` overlay settings and rerun the traffic drill after changes.

## Backup, verify, restore and roll back

The maintenance backup stops API admission and drains the worker before dumping PostgreSQL and saving Redis. It resumes services after a standalone backup. Schedule it during an announced maintenance period on a cadence that meets the operator's recovery-point objective. The archive directory must be new. The command sets private permissions and writes its manifest only after both dumps complete.

```sh
CHECKPOINT="$MONOLITH_BACKUP_ROOT/checkpoint-$(date -u +%Y%m%dT%H%M%SZ)"
python deploy/operations.py --env-file "$MONOLITH_ENV_FILE" --project "$MONOLITH_PROJECT" --stage production backup "$CHECKPOINT"
python deploy/operations.py --env-file "$MONOLITH_ENV_FILE" --project "$MONOLITH_PROJECT" --stage production verify "$CHECKPOINT"
```

Copy the complete directory to an encrypted immutable destination and authenticate it through your backup system. Manifest checksums detect corruption. Trust in the manifest and the release registry belongs to the operator.

For a restore rehearsal, provide a distinct private recovery env file, different ports on the same host, an empty project, and independently restored secrets. Recovery restores PostgreSQL transactionally, converts a verified Redis snapshot to append-only files before opening its network listener, then compares every public table's row count and ordered row-content hash, the migration ledger, sequence positions, extension versions and queued job IDs. Restore leaves application services stopped.

```sh
python deploy/operations.py --env-file "$RECOVERY_ENV_FILE" --project "$RECOVERY_PROJECT" --stage staging restore "$CHECKPOINT"
```

For a production rollback, use an empty project and the same application/worker, gateway, database and queue images identified by the checkpoint. Use `rollback` directly on that fresh target; it includes the verified restore. It reinstates the prior database migration state, starts the earlier app and runs its idempotent migration check. Prior application writes after the checkpoint belong to the old source volume. Review or reconcile those before switching ingress. Restore refuses a nonempty target and keeps original data volumes.

```sh
python deploy/operations.py --env-file "$RECOVERY_ENV_FILE" --project "$RECOVERY_PROJECT" --stage production rollback "$CHECKPOINT"
curl -fsS "$RECOVERY_ORIGIN/api/health/ready"
```

The protected **Restore prior release** workflow runs this same procedure on a trusted main revision. Set `MONOLITH_RECOVERY_ENV_FILE`, `MONOLITH_RECOVERY_PROJECT` and `MONOLITH_RECOVERY_ORIGIN` on the dedicated runner, then select the host stage and an existing checkpoint directory name.

After validating a scoped read, a deterministic job and correct tenant identity on the recovery origin, direct ingress there in the approved window. Keep the source volume and release images until the business owner accepts recovery. For a new PostgreSQL major version, plan and test a separate database upgrade and rollback rehearsal. The release profile runs PostgreSQL 17.

## Repeatable acceptance evidence

```sh
python scripts/test-production-stack.py --app monolith-candidate:app --gateway monolith-candidate:gateway --database monolith-candidate:db --output /tmp/monolith-drill.json
python deploy/security.py --app monolith-candidate:app --gateway monolith-candidate:gateway --database monolith-candidate:db --redis redis@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe --out /tmp/monolith-security
```

The drill allocates its own loopback ports, credentials, synthetic events, projects and volumes. It uses production resource settings, checks 0600 credential mounts with a test value and disables provider calls. The test tenant uses a 600 request/minute quota to keep throughput measurements independent of throttling. It measures a 72-request concurrent traffic sample through the actual gateway, queues real RQ work across restarts, checks independent tenant reads, restores a complete checkpoint after a new test-only gateway image and a simulated incompatible schema migration, and validates the restored application and Redis data. The included measurements were taken on a rootless daemon with cgroups disabled. The recorded limits are its Docker configuration; the environment-level memory and CPU constraints applied to the whole test host. Its timing is a local release baseline. A production capacity commitment requires representative data volumes, concurrency and host characteristics.

Read the machine-generated [drill measurements](release/production-drill.json) and [security gate summary](release/security-gate.json). The [unfixed advisory inventory](release/evidence/dependency-advisories.json) lists affected packages and severities for review. The [Debian update verification](release/evidence/debian-security-update.json) records the archive signers and installed package checksum. CI preserves each release's full audit reports.
