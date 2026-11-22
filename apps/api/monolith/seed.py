"""Reproducible synthetic multi-system source exports."""

import csv
import io
import random
from pathlib import Path
from pypdf import PdfReader
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from .core import parse_csv, document, merge


def make_seed():
    data = {"events": [], "docs": [], "sources": []}
    rng = random.Random(731)
    systems = defaultdict(list)
    base = datetime(2026, 10, 21, 8, tzinfo=timezone.utc)
    for i in range(328):
        ts = base + timedelta(hours=i * 2.05 + rng.uniform(0, 2))
        case = f"NS-{4100 + i}"
        path = [("CRM", "Order confirmed", 0)]
        if i % 5 in (0, 2):
            path.extend(
                [
                    ("Support", "Return requested", rng.uniform(1, 9)),
                    ("Operations", "Return inspected", rng.uniform(1, 6)),
                    ("Finance", "Invoice rekeyed", rng.uniform(0.2, 2.7)),
                    ("Finance", "Refund authorised", rng.uniform(18, 42)),
                ]
            )
            if i % 7 == 0:
                path.insert(3, ("Support", "Details requested", rng.uniform(1, 5)))
            path.append(("CRM", "Customer notified", rng.uniform(0.2, 2)))
        elif i % 5 == 1:
            path.extend(
                [
                    ("Support", "Dispute opened", rng.uniform(1, 6)),
                    ("Finance", "Evidence collected", rng.uniform(2, 7)),
                    ("Support", "Dispute reviewed", rng.uniform(6, 16)),
                    ("CRM", "Case closed", rng.uniform(0.2, 1)),
                ]
            )
        else:
            path.extend(
                [
                    ("Operations", "Picking assigned", rng.uniform(3, 11)),
                    ("Operations", "Parcel dispatched", rng.uniform(1, 5)),
                ]
            )
            if i % 3 == 0:
                path.append(("Finance", "Invoice rekeyed", rng.uniform(0.2, 2)))
            path.append(("CRM", "Delivery confirmed", rng.uniform(3, 14)))
        for j, (system, activity, hours) in enumerate(path):
            ts += timedelta(hours=hours)
            systems[system].append(
                [
                    case if system != "Finance" else case.lower(),
                    activity,
                    ts.isoformat(),
                    system,
                    f"{i}-{j}",
                ]
            )
    for system, rows in systems.items():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["case_id", "activity", "timestamp", "system", "event_id"])
        w.writerows(rows)
        source, events = parse_csv(
            buf.getvalue(), f"northstar-{system.lower()}.csv", True
        )
        merge(data, source, events)
    policy = Path(__file__).with_name("fixtures") / "northstar-controls.pdf"
    source, docs = document(
        [page.extract_text() for page in PdfReader(policy).pages], policy.name, True
    )
    return merge(data, source, docs)
