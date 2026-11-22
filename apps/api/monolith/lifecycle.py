"""Offline operator maintenance. Deprovision credentials and stop writers before erasure."""

import argparse
import json
import os

from redis import Redis
from rq.job import Job
from rq.exceptions import NoSuchJobError
from sqlalchemy import select, text, func

from . import store
from .operations import prune_audit
from .settings import authenticated_workspaces


def erase(tenant, *, confirm=None):
    with store.engine.connect() as c:
        counts = dict(
            c.execute(
                select(store.records.c.kind, func.count())
                .where(store.records.c.tenant == tenant)
                .group_by(store.records.c.kind)
            ).all()
        )
    if confirm is None:
        return {"tenant": tenant, "dry_run": True, "records": sum(counts.values())}
    if confirm != tenant:
        raise ValueError("Confirmation must equal the exact workspace identifier.")
    if tenant in authenticated_workspaces():
        raise ValueError("Remove this workspace's credentials before offline erasure.")
    # Both stores are idempotent. Clearing disposable jobs first permits a safe retry after a crash.
    jobs = 0
    if url := os.getenv("REDIS_URL"):
        with Redis.from_url(url, socket_timeout=5) as conn:
            for key in conn.scan_iter(match="rq:job:*", count=200):
                jid = key.decode().removeprefix("rq:job:")
                if ":" in jid:
                    continue
                try:
                    job = Job.fetch(jid, connection=conn)
                except NoSuchJobError:
                    continue
                if job.meta.get("tenant") == tenant or (
                    job.func_name == "monolith.investigation_api.execute_investigation"
                    and list(job.args[:1]) == [tenant]
                ):
                    job.delete()
                    jobs += 1
    with store.locked(tenant) as c:
        if c.dialect.name == "postgresql":
            c.execute(
                text("DELETE FROM document_vectors WHERE tenant=:tenant"),
                {"tenant": tenant},
            )
        c.execute(store.records.delete().where(store.records.c.tenant == tenant))
        c.execute(store.audit.delete().where(store.audit.c.tenant == tenant))
        store.put(c, tenant, "lifecycle", "erased", {"erased": True})
    return {"tenant": tenant, "erased": True, "jobs_removed": jobs}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="command", required=True)
    delete = commands.add_parser("erase")
    delete.add_argument("tenant")
    delete.add_argument("--confirm")
    retention = commands.add_parser("prune-audit")
    retention.add_argument("--days", required=True, type=int)
    retention.add_argument("--tenant")
    args = cli.parse_args()
    if args.command == "erase":
        print(json.dumps(erase(args.tenant, confirm=args.confirm)))
    else:
        print(json.dumps({"expired": prune_audit(args.days, args.tenant)}))


if __name__ == "__main__":
    main()
