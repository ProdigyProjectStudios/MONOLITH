"""Bounded source parsing and transactional custom-event receipts."""

import csv
import hashlib
import json
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Annotated

from fastapi import HTTPException, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
)
from sqlalchemy import select
from starlette.formparsers import MultiPartException, MultiPartParser

from . import store
from .core import digest, document, parse_csv, stamp

FILE_BYTES = 6 * 1024 * 1024
JSON_BYTES = 1024 * 1024
_PDF_SLOTS = threading.BoundedSemaphore(2)
KEY = re.compile(r"[A-Za-z0-9._:+\-]{1,128}\Z")
Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
]
Identifier = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    event_id: Identifier
    case_id: Text
    activity: Text
    timestamp: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    system: Text
    department: Text | None = None

    @field_validator("*")
    @classmethod
    def printable(cls, value):
        if isinstance(value, str) and not value.isprintable():
            raise ValueError("Use printable characters")
        return value

    @field_validator("case_id")
    @classmethod
    def canonical_case(cls, value):
        return value.upper()

    @field_validator("timestamp")
    @classmethod
    def utc_time(cls, value):
        return stamp(value)


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: Text
    synthetic: bool = False
    events: list[Event] = Field(min_length=1, max_length=1000)

    @field_validator("source")
    @classmethod
    def printable(cls, value):
        if not value.isprintable():
            raise ValueError("Use a printable source label")
        return value


class EventReceipt(BaseModel):
    source_id: str
    received: int
    added: int
    event_ids: list[str]
    replayed: bool


def event_schema():
    schema = EventBatch.model_json_schema()
    schema["properties"]["events"]["items"] = schema.pop("$defs")["Event"]
    return schema


class BodyLimit(MultiPartException):
    """Starlette closes open multipart spool files on MultiPartException."""


async def _bounded(request, limit):
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise BodyLimit("Source exceeds the request size limit")
        yield chunk


def _require_media(request, media):
    if (
        request.headers.get("content-type", "").partition(";")[0].strip().lower()
        != media
    ):
        raise HTTPException(415, f"Use {media} for this endpoint")


async def uploaded_source(request: Request):
    _require_media(request, "multipart/form-data")
    try:
        form = await MultiPartParser(
            request.headers,
            _bounded(request, FILE_BYTES + 65536),
            max_files=1,
            max_fields=0,
        ).parse()
    except BodyLimit:
        raise HTTPException(413, "Maximum upload size is 6 MiB") from None
    except (MultiPartException, ValueError):
        raise HTTPException(422, "Supply one file in the file field") from None
    try:
        file = form.get("file")
        if file is None or not hasattr(file, "filename"):
            raise HTTPException(422, "Supply a CSV or PDF in the file field")
        raw_name = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        if not raw_name or len(raw_name) > 200 or not raw_name.isprintable():
            raise HTTPException(
                422, "Supply a printable filename of at most 200 characters"
            )
        body = await file.read(FILE_BYTES + 1)
        if len(body) > FILE_BYTES:
            raise HTTPException(413, "Maximum upload size is 6 MiB")
        return raw_name, body
    finally:
        await form.close()


def parse_source(name, body):
    suffix = Path(name).suffix.lower()
    if suffix == ".csv":
        try:
            return parse_csv(body.decode("utf-8-sig"), name)
        except (UnicodeError, csv.Error):
            raise ValueError(
                "Supply a valid UTF-8 CSV with consistent quoting"
            ) from None
    if suffix != ".pdf":
        raise ValueError("Choose a CSV or PDF")
    if not body.startswith(b"%PDF-"):
        raise ValueError("The file is missing its PDF header")
    if not _PDF_SLOTS.acquire(blocking=False):
        raise HTTPException(
            429,
            "All PDF parsers are busy. Retry this upload.",
            headers={"Retry-After": "2"},
        )
    try:
        result = subprocess.run(
            [
                sys.executable,
                "-I",
                str(Path(__file__).with_name("pdf_extract.py")),
                name,
            ],
            input=body,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={},
            timeout=12,
            check=True,
        )
        parsed = json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError, OSError):
        raise ValueError(
            "PDF processing exceeded the parser limits or encountered an unreadable document"
        ) from None
    finally:
        _PDF_SLOTS.release()
    if "error" in parsed:
        raise ValueError(parsed["error"])
    return document(parsed["pages"], name, source_id=parsed["source_id"])


def _unique_fields(pairs):
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise ValueError("Duplicate JSON property")
    return fields


async def event_batch(request: Request):
    _require_media(request, "application/json")
    try:
        payload = bytearray()
        async for chunk in _bounded(request, JSON_BYTES):
            payload.extend(chunk)
        value = json.loads(
            payload.decode("utf-8-sig"), object_pairs_hook=_unique_fields
        )
        return EventBatch.model_validate(value)
    except BodyLimit:
        raise HTTPException(413, "Maximum JSON event batch is 1 MiB") from None
    except ValidationError as exc:
        issue = exc.errors(
            include_input=False, include_url=False, include_context=False
        )[0]
        location = ".".join(str(i) for i in issue["loc"])
        raise HTTPException(
            422, f"Invalid event batch field at {location[:128]} ({issue['type']})"
        ) from None
    except (UnicodeError, ValueError, RecursionError):
        raise HTTPException(
            422, "Supply a valid JSON event batch with unique property names"
        ) from None


def _saved(conn, tenant, kind, ident):
    value = conn.execute(
        select(store.records.c.payload).where(
            store.records.c.tenant == tenant,
            store.records.c.kind == kind,
            store.records.c.id == ident,
        )
    ).scalar()
    return json.loads(value) if value is not None else None


def save_events(tenant, batch, key):
    if key is not None and not KEY.fullmatch(key):
        raise HTTPException(
            422,
            "Idempotency-Key must contain 1–128 letters, digits, dots, colons, plus signs, underscores or hyphens",
        )
    body = batch.model_dump(exclude_none=True)
    normalized = json.dumps(
        body, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    fingerprint = hashlib.sha256(normalized).hexdigest()
    receipt_id = hashlib.sha256(key.encode()).hexdigest() if key else None
    ident = "SRC-" + digest("custom-events", batch.source, batch.synthetic)
    source = {
        "id": ident,
        "name": batch.source,
        "kind": "API",
        "synthetic": batch.synthetic,
    }
    events = []
    for index, item in enumerate(batch.events, 1):
        events.append(
            {
                "id": "EV-" + digest(item.system.casefold(), item.event_id),
                "case": item.case_id,
                "activity": item.activity,
                "timestamp": item.timestamp,
                "system": item.system,
                "source": ident,
                "row": index,
                "synthetic": batch.synthetic,
                "provenance": {
                    "external_id": item.event_id,
                    "batch_sha256": fingerprint,
                    "position": index,
                },
                **({"department": item.department} if item.department else {}),
            }
        )
    with store.locked(tenant) as conn:
        if receipt_id:
            receipt = _saved(conn, tenant, "event-ingest-receipt", receipt_id)
            if receipt:
                if receipt["fingerprint"] != fingerprint:
                    raise HTTPException(
                        409,
                        "This idempotency key already belongs to a different event batch",
                    )
                return {**receipt["result"], "replayed": True}
        # A source-row locator stays unique across submissions to the same feed.
        # The original batch position remains in each event's provenance.
        last_row = _saved(conn, tenant, "event-feed-offset", ident) or 0
        for event in events:
            event["row"] += last_row
        try:
            added = store.save_batch(
                tenant, [(source, events)], "Custom events ingested", connection=conn
            )
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        if added:
            store.put(conn, tenant, "event-feed-offset", ident, last_row + len(events))
        result = {
            "source_id": ident,
            "received": len(events),
            "added": added,
            "event_ids": [e["id"] for e in events],
            "replayed": False,
        }
        if receipt_id:
            store.put(
                conn,
                tenant,
                "event-ingest-receipt",
                receipt_id,
                {"fingerprint": fingerprint, "result": result},
            )
    return result
