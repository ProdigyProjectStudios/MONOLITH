"""Tenant-scoped document retrieval using hashed lexical features and cosine similarity."""

from collections import Counter
import hashlib
import json
import math
import re
from sqlalchemy import text

MODEL = "hashed-terms-v1"
DIM = 1536


def features(value):
    counts = Counter(
        int.from_bytes(hashlib.blake2b(t.encode(), digest_size=4).digest(), "big") % DIM
        for t in re.findall(r"\w+", value.casefold())
        if len(t) > 2
    )
    norm = math.sqrt(sum(v * v for v in counts.values())) or 1
    vector = [0.0] * DIM
    for i, n in counts.items():
        vector[i] = n / norm
    return vector


def index_page(conn, tenant, doc):
    if conn.dialect.name == "postgresql":
        conn.execute(
            text("""INSERT INTO document_vectors(tenant,evidence_id,model,embedding)
        VALUES(:tenant,:id,:model,CAST(:vector AS vector))
        ON CONFLICT(tenant,evidence_id,model) DO UPDATE SET embedding=EXCLUDED.embedding"""),
            {
                "tenant": tenant,
                "id": doc["id"],
                "model": MODEL,
                "vector": json.dumps(features(doc["text"])),
            },
        )


def search(conn, tenant, query, limit):
    q = features(query)
    if not any(q):
        return []
    if conn.dialect.name == "postgresql":
        result = conn.execute(
            text("""SELECT evidence_id,1-(embedding <=> CAST(:q AS vector)) AS similarity
          FROM document_vectors WHERE tenant=:tenant AND model=:model AND vector_norm(embedding)>0
          ORDER BY embedding <=> CAST(:q AS vector),evidence_id LIMIT :limit"""),
            {"q": json.dumps(q), "tenant": tenant, "model": MODEL, "limit": limit},
        )
        return [{"id": i, "score": round(s, 4)} for i, s in result if s > 0.00001]
    rows = conn.execute(
        text("SELECT payload FROM records WHERE tenant=:tenant AND kind='docs'"),
        {"tenant": tenant},
    ).scalars()
    return _rank((json.loads(row) for row in rows), q, limit)


def _rank(documents, vector, limit):
    result = []
    for doc in documents:
        score = sum(a * b for a, b in zip(vector, features(doc["text"])))
        if score > 0:
            result.append({"id": doc["id"], "score": round(score, 4)})
    return sorted(result, key=lambda r: (-r["score"], r["id"]))[:limit]


def search_snapshot(documents, query, limit=6):
    """Rank frozen pages, so subsequent imports cannot displace the original sources."""
    vector = features(query)
    return _rank(documents, vector, limit) if any(vector) else []
