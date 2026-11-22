import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine,
    Column,
    String,
    Text,
    Integer,
    MetaData,
    Table,
    select,
    insert,
)
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
audit = Table(
    "audit",
    meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tenant", String, nullable=False, index=True),
    Column("action", String, nullable=False),
    Column("detail", Text, nullable=False),
    Column("at", String, nullable=False),
)


def init():
    if engine.dialect.name != "postgresql":
        meta.create_all(engine)
        return
    from sqlalchemy import text
    from pathlib import Path

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
    c.execute(
        insert(audit).values(
            tenant=tenant,
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
                select(audit.c.action, audit.c.detail, audit.c.at)
                .where(audit.c.tenant == tenant)
                .order_by(audit.c.id.desc())
                .limit(30)
            ).mappings()
        ]


def save_batch(tenant, parts, action):
    with locked(tenant) as c:
        data = dataset(tenant, c)
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
        log(c, tenant, action, f"{count} new records")
    return count


def seed_demo():
    from .seed import make_seed

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
