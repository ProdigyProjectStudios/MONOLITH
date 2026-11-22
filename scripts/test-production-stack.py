#!/usr/bin/env python3
"""Exercise two disposable release projects. Input images must already exist locally."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
import json
import math
import os
import re
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deploy"))
from operations import Stack, cgroup_status, output, verify  # noqa: E402


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def token():
    return secrets.token_hex(24)


def get(origin, path, bearer=None, body=None, expected=200, key=None):
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    if key:
        headers["Idempotency-Key"] = key
    req = urllib.request.Request(
        origin + path,
        headers=headers,
        data=None if body is None else json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as res:
        status, raw = res.code, res.read()
    assert status == expected, (path, status, expected)
    return json.loads(raw) if path.startswith("/api/") else raw.decode()


def until(fn, seconds=60):
    end = time.monotonic() + seconds
    while True:
        try:
            value = fn()
            if value:
                return value
        except (AssertionError, OSError, ValueError):
            if time.monotonic() >= end:
                raise
        if time.monotonic() >= end:
            raise AssertionError("Timed out waiting for expected state")
        time.sleep(0.5)


def setup(base, project, ids, env):
    config = base / (project + ".env")
    http_port, api_port = port(), port()
    while api_port == http_port:
        api_port = port()
    origin = "http://127.0.0.1:" + str(http_port)
    fake_secret = base / (project + ".secret-fixture")
    fake_secret.write_text("DRILL-ONLY-NOT-A-PROVIDER-KEY\n")
    fake_secret.chmod(0o600)
    # Compose bind-mounts this synthetic fixture with its host ownership. The
    # release image runs as UID 1000, including on CI runners owned by UID 1001.
    if fake_secret.stat().st_uid != 1000:
        subprocess.run(
            [
                "docker", "run", "--rm", "--network", "none", "--user", "0:0",
                "--mount", f"type=bind,source={fake_secret},target=/fixture",
                "--entrypoint", "chown", ids[0], "1000:1000", "/fixture",
            ],
            check=True,
        )
    values = {
        "MONOLITH_OPENAI_SECRET_PATH": str(fake_secret),
        "DB_PASSWORD": token(),
        "TENANT_IDENTITIES": "'" + json.dumps(env, separators=(",", ":")) + "'",
        "MONOLITH_DB_IMAGE": ids[2],
        "MONOLITH_HTTP_PORT": str(http_port),
        "MONOLITH_API_PORT": str(api_port),
        "WEB_ORIGINS": origin,
        "MONOLITH_API_HOST": ":80",
        "MONOLITH_APP_IMAGE": ids[0],
        "MONOLITH_GATEWAY_IMAGE": ids[1],
        "MONOLITH_MODEL_CALLS_ENABLED": "0",
        "MONOLITH_RATE_LIMIT_PER_MINUTE": "600",
    }
    config.write_text("".join(k + "=" + v + "\n" for k, v in values.items()))
    args = argparse.Namespace(
        project=project, env_file=config, stage="staging", openai_secret=True
    )
    return Stack(args), origin, config


def cli(stack, cfg, *arguments, succeed=True):
    res = subprocess.run(
        [
            sys.executable,
            str(ROOT / "deploy/operations.py"),
            "--project",
            stack.project,
            "--env-file",
            str(cfg),
            "--stage",
            "staging",
            "--openai-secret",
            *map(str, arguments),
        ],
        check=False,
    )
    assert (res.returncode == 0) == succeed, (arguments[0], res.returncode)


def benchmark(origin, auth):
    routes = [
        ("/api/workspace", auth["tenant"]),
        ("/api/continuous/status", auth["tenant"]),
        ("/api/workspace", auth["empty"]),
        ("/api/operations/metrics", auth["tenant"]),
    ]

    def request(i):
        path, ident = routes[i % len(routes)]
        start = time.perf_counter()
        get(origin, path, ident)
        return (time.perf_counter() - start) * 1000

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=6) as pool:
        samples = sorted(pool.map(request, range(72)))
    duration = time.perf_counter() - start

    def pct(p):
        return round(samples[math.ceil(len(samples) * p) - 1], 2)

    assert pct(0.95) < 4000, "Local release smoke p95 exceeded 4 seconds"
    return {
        "requests": len(samples),
        "concurrency": 6,
        "routes": [r[0] for r in routes],
        "p50_ms": pct(0.50),
        "p95_ms": pct(0.95),
        "max_ms": pct(1),
        "success": len(samples),
        "requests_per_second": round(len(samples) / duration, 2),
        "p95_gate_ms": 4000,
    }


def kernel_limits(stack, role):
    script = """
if test -f /sys/fs/cgroup/cgroup.controllers; then
    cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max
else
    cat /sys/fs/cgroup/memory/memory.limit_in_bytes
    echo "$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us) $(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)"
    cat /sys/fs/cgroup/pids/pids.max
fi"""
    memory, cpu, pids = stack.read("exec", "-T", role, "sh", "-ec", script).splitlines()
    quota, period = cpu.split()
    return {
        "memory_bytes": int(memory),
        "nano_cpus": int(quota) * 1_000_000_000 // int(period),
        "pids": int(pids),
    }


def run(main, recover, root, refs, auth, cgroups):
    stack, origin, cfg = main
    target, restored, cfg2 = recover
    archive = root / "backup"
    cli(
        stack,
        cfg,
        "release",
        "--app",
        refs[0],
        "--gateway",
        refs[1],
        "--database",
        refs[2],
        "--backup",
        root / "initial",
    )
    checks = {}
    limits = {}
    for role in ("api", "worker", "db", "redis", "gateway"):
        cid = stack.read("ps", "-q", role)
        inspect = json.loads(output(["docker", "inspect", cid]))[0]
        host, state = inspect["HostConfig"], inspect["State"]
        assert state["Health"]["Status"] == "healthy"
        limits[role] = {
            "memory_bytes": host["Memory"],
            "nano_cpus": host["NanoCpus"],
            "pids": host["PidsLimit"],
        }
        assert all(v > 0 for v in limits[role].values()), (role, limits[role])
        if cgroups["available"]:
            assert kernel_limits(stack, role) == limits[role], (
                role,
                "Configured limits differ from kernel cgroup files",
            )
        if role in ("api", "worker"):
            assert inspect["Config"]["User"].split(":")[0] == "1000"
            assert (
                host["ReadonlyRootfs"]
                and "ALL" in host["CapDrop"]
                and "no-new-privileges:true" in host["SecurityOpt"]
            )
        if role in ("db", "redis", "worker"):
            assert not host["PortBindings"]
    cgroups["kernel_limits_verified"] = cgroups["available"]
    for role in ("api", "worker"):
        code = (
            "from pathlib import Path; from monolith.runtime_config import openai_secret,model_calls_enabled; "
            "p=Path('/run/secrets/openai_api_key'); assert p.stat().st_mode & 0o777 == 0o600; "
            "assert openai_secret() == 'DRILL-ONLY-NOT-A-PROVIDER-KEY' and not model_calls_enabled()"
        )
        stack.dc("exec", "-T", role, "python", "-c", code)
    checks["restricted_file_read_by_unprivileged_services"] = True
    assert 'data-runtime="production"' in get(origin, "/")
    assert get(origin, "/api/health/ready")["status"] == "ready"
    get(origin, "/api/workspace", expected=401)
    get(origin, "/api/events", auth["viewer"], {}, 403)
    assert get(origin, "/api/workspace", auth["empty"])["data"]["events"] == []
    checks["authenticated_gateway_and_scoped_roles"] = True
    body = {
        "synthetic": True,
        "source": "Synthetic release drill",
        "events": [
            {
                "event_id": "QA-evt-1",
                "case_id": "QA-process-1",
                "activity": "Release drill observed",
                "system": "Drill ledger",
                "timestamp": "2026-11-22T10:00:00Z",
            }
        ],
    }
    one = get(origin, "/api/events", auth["tenant"], body, key="drill-event")
    two = get(origin, "/api/events", auth["tenant"], body, key="drill-event")
    assert (
        one.get("added") == 1
        and two.get("replayed") is True
        and len(
            [
                e
                for e in get(origin, "/api/workspace", auth["tenant"])["data"]["events"]
                if e["case"] == "QA-PROCESS-1"
            ]
        )
        == 1
    )
    assert get(origin, "/api/workspace", auth["empty"])["data"]["events"] == []
    checks["tenant_scoped_idempotent_ingestion"] = True
    stack.dc("stop", "worker")
    until(lambda: get(origin, "/api/health/ready", expected=503))
    intent = {"mode": "deterministic", "days": 30, "request_id": "drill-" + token()}
    queued = get(origin, "/api/investigations", auth["tenant"], intent)
    assert queued["status"] == "queued"
    route = "/api/investigations/" + queued["id"]
    get(origin, route, auth["empty"], expected=404)
    job = get(origin, "/api/analysis", auth["tenant"], {"days": 7})["job"]
    assert get(origin, "/api/jobs/" + job, auth["tenant"])["status"] == "queued"
    get(origin, "/api/jobs/" + job, auth["empty"], expected=404)
    stack.dc("restart", "redis")
    until(lambda: get(origin, "/api/jobs/" + job, auth["tenant"])["status"] == "queued")
    stack.dc("restart", "api")
    stack.dc("start", "worker")
    until(lambda: get(origin, "/api/health/ready")["status"] == "ready", 90)
    assert (
        get(origin, "/api/investigations", auth["tenant"], intent)["id"] == queued["id"]
    )
    until(lambda: get(origin, route, auth["tenant"])["status"] == "completed", 120)
    run = get(origin, route, auth["tenant"])
    frames = run["events"]
    assert run["result"]["verified"] and not run.get("approval")
    assert [f["seq"] for f in frames] == list(range(1, len(frames) + 1))
    kinds = [f["kind"] for f in frames]
    assert (
        kinds.count("run_started") == 1
        and kinds[-1] == "run_completed"
        and "model_call" not in kinds
    )
    req = urllib.request.Request(
        origin + route + "/events?after=" + str(frames[-2]["seq"]),
        headers={"Authorization": "Bearer " + auth["tenant"]},
    )
    with urllib.request.urlopen(req, timeout=20) as stream:
        resumed = [
            json.loads(line[6:]) for line in stream if line.startswith(b"data: ")
        ]
    assert [f["kind"] for f in resumed] == ["run_completed"]
    checks["deterministic_run_and_sse_cursor_after_api_worker_restart"] = len(frames)
    until(
        lambda: get(origin, "/api/jobs/" + job, auth["tenant"])["status"] == "finished",
        90,
    )
    until(lambda: get(origin, "/api/health/ready")["status"] == "ready")
    checks["queued_job_survives_redis_restart_and_worker_outage"] = True
    stack.dc("stop", "redis")
    assert get(origin, "/api/health")["status"] == "ok"
    until(lambda: get(origin, "/api/health/ready", expected=503))
    stack.dc("start", "redis")
    # A worker may continue reconnecting with backoff. Restarting it is part of this recovery drill.
    stack.dc("restart", "worker")
    until(lambda: get(origin, "/api/health/ready")["status"] == "ready", 90)
    stack.dc("restart", "db")
    until(lambda: get(origin, "/api/health/ready")["status"] == "ready", 90)
    checks["dependency_restart_and_readiness_recovery"] = True
    load = benchmark(origin, auth)
    marker = token()
    stack.read(
        "exec", "-T", "redis", "redis-cli", "SET", "monolith:qa:restore-proof", marker
    )
    t = time.perf_counter()
    cli(stack, cfg, "backup", archive)
    backup_seconds = round(time.perf_counter() - t, 2)
    manifest = verify(archive)
    bad = root / "invalid"
    shutil.copytree(archive, bad)
    with (bad / "redis.rdb").open("ab") as f:
        f.write(b"incomplete")
    try:
        verify(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("Corrupted archive accepted")
    cli(stack, cfg, "restore", archive, succeed=False)
    # Create a deliberately incompatible post-checkpoint marker in the disposable source only.
    stack.sql(
        "CREATE TABLE release_drill_later_revision (id integer PRIMARY KEY); "
        "INSERT INTO schema_migrations(name) VALUES ('900_release_drill_marker.sql')"
    )
    # Create a genuinely distinct, explicitly test-only gateway image. Its only
    # change is a release label; no application code or upstream registry is used.
    tag = stack.project + ":post-checkpoint"
    base_tag = "monolith-local:" + refs[1].removeprefix("sha256:")
    subprocess.run(
        ["docker", "build", "--quiet", "--tag", tag, "-"],
        input=(
            "FROM "
            + base_tag
            + "\nLABEL org.monolith.synthetic-drill="
            + stack.project
            + "\n"
        ).encode(),
        check=True,
    )
    stack.env["MONOLITH_GATEWAY_IMAGE"] = tag
    stack.dc(
        "up", "-d", "--no-build", "--pull", "never", "--no-deps", "--wait", "gateway"
    )
    later_gateway = stack.release()["gateway"]["id"]
    assert later_gateway != refs[1]

    assert (
        stack.sql(
            "SELECT to_regclass('public.release_drill_later_revision') IS NOT NULL"
        )
        == "t"
    )
    stack.dc("down")  # Retain original database and queue volumes.
    subprocess.run(["docker", "image", "rm", tag], check=True)
    t = time.perf_counter()
    cli(target, cfg2, "rollback", archive)
    recovery_seconds = round(time.perf_counter() - t, 2)
    assert (
        target.sql("SELECT to_regclass('public.release_drill_later_revision') IS NULL")
        == "t"
    )
    assert (
        target.sql(
            "SELECT count(*) FROM schema_migrations WHERE name='900_release_drill_marker.sql'"
        )
        == "0"
    )
    assert (
        target.read(
            "exec", "-T", "redis", "redis-cli", "GET", "monolith:qa:restore-proof"
        )
        == marker
    )
    assert get(restored, "/api/jobs/" + job, auth["tenant"])["status"] == "finished"
    assert any(
        e["case"] == "QA-PROCESS-1"
        for e in get(restored, "/api/workspace", auth["tenant"])["data"]["events"]
    )
    assert get(restored, "/api/workspace", auth["empty"])["data"]["events"] == []
    assert (
        target.release()["api"]["id"] == refs[0]
        and target.release()["gateway"]["id"] == refs[1]
    )
    checks["prior_release_schema_data_redis_and_http_rollback"] = True
    checks["corrupt_backup_and_in_place_restore_rejected"] = True
    return {
        "status": "passed",
        "environment": "isolated local Docker Compose staging projects",
        "utc": datetime.now(UTC).isoformat(),
        "provider_calls_enabled": False,
        "image_ids": dict(zip(("app", "gateway", "db"), refs)),
        "checks": checks,
        "limits": limits,
        "resource_enforcement": cgroups,
        "load": load,
        "recovery": {
            "backup_wall_seconds": backup_seconds,
            "rollback_wall_seconds": recovery_seconds,
            "migrations": manifest["inventory"]["migrations"],
            "discarded_test_only_gateway": later_gateway,
            "rows_checked": {
                k: v["rows"] for k, v in manifest["inventory"]["tables"].items()
            },
            "archive_bytes": {k: v["bytes"] for k, v in manifest["files"].items()},
        },
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--app", required=True)
    p.add_argument("--gateway", required=True)
    p.add_argument("--database", required=True)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument(
        "--require-cgroups",
        action="store_true",
        help="Fail when per-service kernel limits cannot be verified",
    )
    args = p.parse_args()
    cgroups = cgroup_status()
    if args.require_cgroups and not cgroups["available"]:
        p.exit(
            1,
            "The deployment gate requires a Docker daemon with active cgroup enforcement.\n",
        )
    os.umask(0o077)
    refs = [
        output(["docker", "image", "inspect", "--format", "{{.Id}}", a])
        for a in (args.app, args.gateway, args.database)
    ]
    auth = {k: token() for k in ("tenant", "empty", "viewer")}
    ids = {
        "northstar": {
            "qa-admin": {"token": auth["tenant"], "role": "admin"},
            "qa-view": {"token": auth["viewer"], "role": "viewer"},
        },
        "drill-empty": {"qa-admin": {"token": auth["empty"], "role": "admin"}},
    }
    prefix = "mono-drill-" + secrets.token_hex(4)
    with tempfile.TemporaryDirectory(prefix=prefix + "-") as tmp:
        root = Path(tmp)
        released = [
            setup(root, prefix + s, (args.app, args.gateway, args.database), ids)
            for s in ("-primary", "-restore")
        ]
        try:
            result = run(*released, root, refs, auth, cgroups)
        except Exception:
            for stack, _, _ in released:
                logs = stack.read("logs", "--no-color", "--tail", "100", "api")
                diagnostics = re.findall(
                    r"(?:psycopg\.errors\.|sqlalchemy\.exc\.)[A-Za-z]+: [^\n]{1,300}",
                    logs,
                )
                for message in sorted(set(diagnostics)):
                    print(message, file=sys.stderr)
            raise
        finally:
            for stack, _, _ in reversed(released):
                assert stack.project.startswith(prefix + "-")
                stack.dc("down", "-v", "--remove-orphans")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
