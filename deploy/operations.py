#!/usr/bin/env python3
"""Coordinated PostgreSQL/Redis backups and immutable Compose releases.

Archives can contain customer data and encrypted connector tokens. Restrict access
and supply encryption at rest with your backup destination. Only trusted archives
and trusted service images may be restored.
"""

import argparse
from datetime import UTC, datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
APP_SERVICES = ("api", "worker", "gateway")


def execute(args, *, env=None, **kwargs):
    return subprocess.run(args, check=True, env=env, **kwargs)


def output(args, **kwargs):
    return execute(args, stdout=subprocess.PIPE, text=True, **kwargs).stdout.strip()


def file_hash(p):
    with p.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def immutable(ref):
    return bool(re.fullmatch(r"(?:[a-z0-9./:_-]+@)?sha256:[a-f0-9]{64}", ref))


def cgroup_status():
    daemon = json.loads(output(["docker", "info", "--format", "{{json .}}"]))
    driver = daemon.get("CgroupDriver")
    return {
        "driver": driver,
        "version": daemon.get("CgroupVersion"),
        "available": driver in {"systemd", "cgroupfs"},
    }


class Stack:
    def __init__(self, args):
        self.project = args.project
        self.env = os.environ.copy()
        self.compose = [
            "docker",
            "compose",
            "--project-directory",
            str(ROOT),
            "-p",
            args.project,
            "--env-file",
            str(args.env_file.resolve()),
            "-f",
            str(ROOT / "compose.yaml"),
            "-f",
            str(ROOT / "compose.hosted.yaml"),
        ]
        if args.stage == "staging":
            self.compose += ["-f", str(ROOT / "compose.staging.yaml")]
        if args.openai_secret:
            self.compose += ["-f", str(ROOT / "compose.openai-secret.yaml")]

    def dc(self, *args, **kwargs):
        return execute([*self.compose, *args], env=self.env, **kwargs)

    def read(self, *args):
        return output([*self.compose, *args], env=self.env)

    def sql(self, query):
        return self.read(
            "exec",
            "-T",
            "db",
            "psql",
            "-XAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "monolith",
            "-d",
            "monolith",
            "-c",
            query,
        )

    def running(self):
        return set(self.read("ps", "--status", "running", "--services").splitlines())

    def release(self):
        result = {}
        for role in ("api", "gateway", "worker", "db", "redis"):
            cid = self.read("ps", "--all", "-q", role)
            if not cid:
                raise ValueError(
                    "Backup requires all application services to have been created"
                )
            ident = output(["docker", "inspect", "-f", "{{.Image}}", cid])
            digests = (
                json.loads(
                    output(
                        [
                            "docker",
                            "image",
                            "inspect",
                            "-f",
                            "{{json .RepoDigests}}",
                            ident,
                        ]
                    )
                )
                or []
            )
            result[role] = {"id": ident, "registry_digest": next(iter(digests), None)}
        if result["api"]["id"] != result["worker"]["id"]:
            raise ValueError("API and worker must run the same release image")
        return result

    def inventory(self):
        tables = self.sql(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        ).splitlines()
        data = {}
        for table in tables:
            ident = '"' + table.replace('"', '""') + '"'
            sql = f"SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM public.{ident} t ORDER BY digest"
            cmd = [
                *self.compose,
                "exec",
                "-T",
                "-e",
                "PGTZ=UTC",
                "db",
                "psql",
                "-XAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "monolith",
                "-d",
                "monolith",
                "-c",
                sql,
            ]
            digest = hashlib.sha256()
            count = 0
            with subprocess.Popen(cmd, env=self.env, stdout=subprocess.PIPE) as proc:
                for line in proc.stdout:
                    if not re.fullmatch(rb"[0-9a-f]{64}\n", line):
                        raise ValueError("Unexpected inventory row")
                    digest.update(line)
                    count += 1
                if proc.wait():
                    raise ValueError("Database inventory failed")
            data[table] = {"rows": count, "sha256": digest.hexdigest()}
        return {
            "tables": data,
            "sequences": self.sql(
                "SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename"
            ).splitlines(),
            "extensions": self.sql(
                "SELECT extname, extversion FROM pg_extension ORDER BY extname"
            ).splitlines(),
            "migrations": self.sql(
                "SELECT name FROM schema_migrations ORDER BY name"
            ).splitlines(),
            "queue_ids_sha256": hashlib.sha256(
                self.read(
                    "exec",
                    "-T",
                    "redis",
                    "redis-cli",
                    "--raw",
                    "LRANGE",
                    "rq:queue:monolith",
                    "0",
                    "-1",
                ).encode()
            ).hexdigest(),
        }

    def use_images(self, images):
        roles = {
            "api": "MONOLITH_APP_IMAGE",
            "gateway": "MONOLITH_GATEWAY_IMAGE",
            "db": "MONOLITH_DB_IMAGE",
            "redis": "MONOLITH_REDIS_IMAGE",
        }
        for role, ref in images.items():
            key = roles[role]
            if not immutable(ref):
                raise ValueError(
                    "Release images require immutable registry digests or an existing local sha256 image ID"
                )
            if subprocess.run(
                ["docker", "image", "inspect", ref],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode:
                if "@" not in ref:
                    raise ValueError("Required local image is unavailable")
                execute(["docker", "pull", ref])
            # Compose requires a named image reference, while Docker accepts a bare image ID.
            if ref.startswith("sha256:"):
                tag = "monolith-local:" + ref.removeprefix("sha256:")
                execute(["docker", "tag", ref, tag])
                ref = tag
            self.env[key] = ref


def snapshot(stack, path, hold=False):
    path.mkdir(mode=0o700, parents=False, exist_ok=False)
    before = stack.running()
    release = stack.release()
    finished = False
    key = "monolith-" + uuid.uuid4().hex + ".rdb"
    try:
        if "api" in before:
            stack.dc("stop", "-t", "90", "api")
        if "worker" in before:
            stack.dc("stop", "-t", "600", "worker")
        with (path / "postgres.dump").open("xb") as file:
            stack.dc(
                "exec",
                "-T",
                "db",
                "pg_dump",
                "--format=custom",
                "--no-owner",
                "--no-acl",
                "-U",
                "monolith",
                "monolith",
                stdout=file,
            )
        stack.dc(
            "exec",
            "-T",
            "redis",
            "redis-cli",
            "--rdb",
            "/tmp/" + key,
            stdout=subprocess.DEVNULL,
        )
        stack.dc(
            "exec",
            "-T",
            "redis",
            "redis-check-rdb",
            "/tmp/" + key,
            stdout=subprocess.DEVNULL,
        )
        cid = stack.read("ps", "-q", "redis")
        execute(["docker", "cp", cid + ":/tmp/" + key, str(path / "redis.rdb")])
        (path / "redis.rdb").chmod(
            0o600
        )  # docker cp preserves the container file mode.
        manifest = {
            "version": 1,
            "project": stack.project,
            "created": datetime.now(UTC).isoformat(),
            "images": release,
            "inventory": stack.inventory(),
            "files": {
                n: {"bytes": (path / n).stat().st_size, "sha256": file_hash(path / n)}
                for n in ("postgres.dump", "redis.rdb")
            },
        }
        (path / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        finished = True
        return manifest
    finally:
        stack.dc(
            "exec", "-T", "redis", "rm", "-f", "/tmp/" + key, stdout=subprocess.DEVNULL
        )
        if not (finished and hold):
            restart = [s for s in ("api", "worker") if s in before]
            if restart:
                stack.dc("start", *restart)


def verify(path):
    m = json.loads((path / "manifest.json").read_text())
    if m.get("version") != 1 or set(m["files"]) != {"postgres.dump", "redis.rdb"}:
        raise ValueError("Unsupported backup manifest")
    for filename, v in m["files"].items():
        p = path / filename
        if (
            not p.is_file()
            or p.is_symlink()
            or p.stat().st_size != v["bytes"]
            or file_hash(p) != v["sha256"]
        ):
            raise ValueError("Backup content failed validation")
    return m


def restore(stack, path):
    m = verify(path)
    if m["project"] == stack.project:
        raise ValueError("Restore requires a different empty target Compose project")
    label = "label=com.docker.compose.project=" + stack.project
    if output(["docker", "ps", "-aq", "--filter", label]) or output(
        ["docker", "volume", "ls", "-q", "--filter", label]
    ):
        raise ValueError("Target project already owns containers or volumes")
    select_archive(stack, m)
    stack.dc("up", "-d", "--no-build", "--wait", "db")
    with (path / "postgres.dump").open("rb") as dump:
        stack.dc(
            "exec",
            "-T",
            "db",
            "pg_restore",
            "--single-transaction",
            "--exit-on-error",
            "--no-owner",
            "--no-acl",
            "-U",
            "monolith",
            "-d",
            "monolith",
            stdin=dump,
        )
    # Redis gives AOF precedence over RDB; materialize the restored RDB into fresh
    # AOF files while the isolated helper has no network listener or clients.
    script = """
set -eu
test -z "$(ls -A /data)"
redis-check-rdb /restore.rdb >/dev/null
cp /restore.rdb /data/dump.rdb
redis-server --port 0 --unixsocket /tmp/restore.sock --dir /data --save '' --appendonly no --daemonize yes
trap 'redis-cli -s /tmp/restore.sock shutdown nosave >/dev/null 2>&1 || true' EXIT
redis-cli -s /tmp/restore.sock config set appendonly yes | grep -qx OK
n=0
while [ "$n" -lt 120 ]; do
 state=$(redis-cli -s /tmp/restore.sock info persistence | tr -d '\\r')
 if echo "$state" | grep -qx 'aof_enabled:1' && echo "$state" | grep -qx 'aof_rewrite_in_progress:0' && echo "$state" | grep -qx 'aof_last_bgrewrite_status:ok' && test -s /data/appendonlydir/appendonly.aof.manifest; then exit 0; fi
 n=$((n+1)); sleep 1
done
exit 1
"""
    stack.dc(
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "-v",
        str((path / "redis.rdb").resolve()) + ":/restore.rdb:ro",
        "--entrypoint",
        "sh",
        "redis",
        "-ec",
        script,
    )
    stack.dc("up", "-d", "--wait", "redis")
    restored = stack.inventory()
    if restored != m["inventory"]:
        raise ValueError(
            "Restored table hashes, migration ledger or queue IDs differ from the backup. Target remains offline."
        )
    return m


def select_archive(stack, manifest):
    images = manifest["images"]
    stack.use_images(
        {
            role: images[role]["registry_digest"] or images[role]["id"]
            for role in ("api", "gateway", "db", "redis")
        }
    )


def start_release(stack):
    stack.dc(
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "python",
        "api",
        "-c",
        "from monolith import store; store.init()",
    )
    stack.dc(
        "up",
        "-d",
        "--no-build",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "180",
        *APP_SERVICES,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--stage", choices=["staging", "production"], required=True)
    parser.add_argument("--openai-secret", action="store_true")
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("backup", "verify", "restore", "rollback"):
        sub.add_parser(action).add_argument("directory", type=Path)
    release = sub.add_parser("release")
    release.add_argument("--app", required=True)
    release.add_argument("--gateway", required=True)
    release.add_argument("--database", required=True)
    release.add_argument("--backup", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", args.project):
        raise ValueError("Invalid Compose project name")
    lockdir = Path(tempfile.gettempdir()) / ("monolith-operations-" + str(os.getuid()))
    lockdir.mkdir(mode=0o700, exist_ok=True)
    if lockdir.stat().st_uid != os.getuid() or lockdir.stat().st_mode & 0o077:
        raise ValueError("Invalid local operation-lock directory permissions")
    with (lockdir / (args.project + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        dispatch(args)


def dispatch(args):
    s = Stack(args)
    if (
        args.stage == "production"
        and args.action in {"release", "rollback"}
        and not cgroup_status()["available"]
    ):
        raise ValueError(
            "Production release requires a Docker daemon with working cgroups to enforce service limits"
        )
    if args.action == "backup":
        snapshot(s, args.directory)
    elif args.action == "verify":
        verify(args.directory)
    elif args.action in ("restore", "rollback"):
        manifest = restore(s, args.directory)
        if args.action == "rollback":
            select_archive(s, manifest)
            start_release(s)
    else:
        s.use_images({"api": args.app, "gateway": args.gateway, "db": args.database})
        if s.running() & {"api", "worker", "gateway"}:
            snapshot(s, args.backup, hold=True)
        elif s.read("ps", "--all", "--quiet"):
            if s.sql("SELECT to_regclass('public.schema_migrations')::text"):
                raise ValueError(
                    "Existing inactive deployment: resume it or roll back through an explicit verified restore"
                )
        s.dc("up", "-d", "--no-build", "--wait", "db", "redis")
        start_release(s)
    print(
        json.dumps(
            {"action": args.action, "result": "verified", "project": args.project}
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Operation failed: {exc}", file=sys.stderr)
        sys.exit(1)
