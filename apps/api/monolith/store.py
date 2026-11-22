import json
import os
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    insert,
    select,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .core import merge
from .retrieval import index_page

engine = create_engine(os.getenv("DATABASE_URL", "sqlite:///./monolith.db"))
meta = MetaData()
records = Table(
    "records",
    meta,
    Column("tenant", String, primary_key=True),
    Column("kind", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("payload", Text, nullable=False),
)
# Scheduler polling is keyed by record kind across organizations. The primary
# key remains tenant-first for tenant-scoped business data access.
records_by_kind = Index("ix_records_kind_tenant", records.c.kind, records.c.tenant)
audit = Table(
    "audit",
    meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tenant", String, nullable=False, index=True),
    Column("actor", String),
    Column("role", String),
    Column("action", String, nullable=False),
    Column("detail", Text, nullable=False),
    Column("at", String, nullable=False),
)


def init():
    if engine.dialect.name != "postgresql":
        with engine.connect() as c:
            c.exec_driver_sql("BEGIN IMMEDIATE")
            meta.create_all(c)
            records_by_kind.create(c, checkfirst=True)
            columns = {r[1] for r in c.exec_driver_sql("PRAGMA table_info(audit)")}
            for name in ("actor", "role"):
                if name not in columns:
                    c.exec_driver_sql(f"ALTER TABLE audit ADD COLUMN {name} varchar")
            c.commit()
        return
    from pathlib import Path

    from sqlalchemy import text

    with engine.begin() as c:
        c.execute(text("SELECT pg_advisory_xact_lock(712544103)"))
        c.execute(
            text("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)")
        )
        done = set(c.execute(text("SELECT name FROM schema_migrations")).scalars())
        for migration in sorted(
            (Path(__file__).parents[1] / "migrations").glob("*.sql")
        ):
            if migration.name in done:
                continue
            for statement in migration.read_text().split(";"):
                if statement.strip():
                    c.execute(text(statement))
            if migration.name == "002_vectors.sql":
                for t, p in c.execute(
                    text("SELECT tenant,payload FROM records WHERE kind='docs'")
                ):
                    index_page(c, t, json.loads(p))
            c.execute(
                text("INSERT INTO schema_migrations(name) VALUES(:name)"),
                {"name": migration.name},
            )


@contextmanager
def locked(tenant):
    with engine.connect() as c:
        if engine.dialect.name == "sqlite":
            c.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            from sqlalchemy import text

            c.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:tenant,0))"),
                {"tenant": tenant},
            )
        try:
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise


def put(c, tenant, kind, key, value):
    factory = sqlite_insert if engine.dialect.name == "sqlite" else pg_insert
    stmt = factory(records).values(
        tenant=tenant, kind=kind, id=key, payload=json.dumps(value)
    )
    c.execute(
        stmt.on_conflict_do_update(
            index_elements=["tenant", "kind", "id"],
            set_={"payload": stmt.excluded.payload},
        )
    )


def dataset(tenant, c=None):
    if c is None:
        with engine.connect() as conn:
            return dataset(tenant, conn)
    data = {"events": [], "docs": [], "sources": []}
    for k, p in c.execute(
        select(records.c.kind, records.c.payload)
        .where(records.c.tenant == tenant, records.c.kind.in_(list(data)))
        .order_by(records.c.id)
    ):
        data[k].append(json.loads(p))
    return data


def log(c, tenant, action, detail):
    from .access import current_principal

    who = current_principal()
    actor = who.actor if who and who.tenant == tenant else "system"
    role = who.role if who and who.tenant == tenant else "system"
    c.execute(
        insert(audit).values(
            tenant=tenant,
            actor=actor,
            role=role,
            action=action,
            detail=detail,
            at=datetime.now(timezone.utc).isoformat(),
        )
    )


def history(tenant):
    with engine.connect() as c:
        return [
            dict(row)
            for row in c.execute(
                select(audit.c.action, audit.c.detail, audit.c.at, audit.c.actor, audit.c.role)
                .where(audit.c.tenant == tenant)
                .order_by(audit.c.id.desc())
                .limit(30)
            ).mappings()
        ]


def save_batch(tenant, parts, action, connection=None):
    with (locked(tenant) if connection is None else nullcontext(connection)) as c:
        from .continuous_service import capture, capture_legacy_baseline

        data = dataset(tenant, c)
        capture_legacy_baseline(c, tenant, data)
        before = {k: {x["id"] for x in rows} for k, rows in data.items()}
        for source, rows in parts:
            merge(data, source, rows)
        count = 0
        for k, rows in data.items():
            for x in rows:
                if x["id"] not in before[k]:
                    put(c, tenant, k, x["id"], x)
                    if k == "docs":
                        index_page(c, tenant, x)
                    count += k != "sources"
        if count or len(before["sources"]) != len(data["sources"]):
            capture(c, tenant, action, data)
        log(c, tenant, action, f"{count} new records")
    return count


def seed_demo():
    from .seed import make_seed

    with engine.connect() as c:
        erased = c.execute(select(records.c.id).where(records.c.tenant=="northstar",records.c.kind=="lifecycle",records.c.id=="erased")).first()
    if erased or os.getenv("MONOLITH_SEED_DEMO","1")=="0":
        return
    if dataset("northstar")["sources"]:
        return
    data = make_seed()
    save_batch(
        "northstar",
        [
            (s, [r for r in data["docs"] + data["events"] if r["source"] == s["id"]])
            for s in data["sources"]
        ],
        "Synthetic workspace seeded",
    )
