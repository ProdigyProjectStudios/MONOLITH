"""Repeatable synthetic weekly exports for the opt-in Northstar monitoring exercise."""

import csv
import io
from datetime import UTC, datetime, timedelta

# Each export starts after the preceding dataset's last observation. The analytics
# engine determines consequences from event timestamps and does not read wave names.
WAVES = {
    "backlog": (
        datetime(2026, 11, 21, 0, 20, tzinfo=UTC),
        "synthetic-change-stream.csv",
    ),
    "recovery": (
        datetime(2026, 11, 28, 0, 20, tzinfo=UTC),
        "synthetic-recovery-stream.csv",
    ),
}


def fixture_csv(wave: str) -> str:
    if wave not in WAVES:
        raise ValueError("Unknown synthetic wave")
    start, _ = WAVES[wave]
    backlog = wave == "backlog"
    rows = []

    def record_case(group, idx, start_minutes, steps):
        case = f"NS-SYN-{wave.upper()}-{group}-{idx + 1:03}"
        ts = start + timedelta(minutes=start_minutes)
        for step, (system, activity, wait_minutes) in enumerate(steps, start=1):
            ts += timedelta(minutes=wait_minutes)
            rows.append(
                (
                    case,
                    activity,
                    ts.isoformat().replace("+00:00", "Z"),
                    system,
                    f"{case}-E{step:02}",
                    "Synthetic Northstar Commerce training data",
                    wave,
                )
            )

    for i in range(42):
        path = [
            ("CRM", "Order confirmed", 0),
            ("Support", "Return requested", 80 + i % 4 * 18),
            ("Operations", "Return inspected", 70 + i % 3 * 15),
        ]
        # A temporary billing exception desk receives most returned orders in
        # the backlog export. A smaller residual workload remains a week later.
        if (backlog and i % 5 != 0) or (not backlog and i in (1, 12)):
            path.extend(
                [
                    ("Billing desk", "Billing exception queued", 35),
                    ("Support", "Billing details checked", 50 + i % 4 * 15),
                ]
            )
        path.append(("Finance", "Invoice rekeyed", 45 + i % 5 * 9))
        if (backlog and i % 4 != 0) or (not backlog and i == 12):
            path.append(("Finance", "Invoice rekeyed", 50 + i % 6 * 12))
        wait = 64 * 60 + (i % 9) * 95 if backlog else 23 * 60 + (i % 8) * 44
        path.extend(
            [
                ("Finance", "Refund authorised", wait),
                ("CRM", "Customer notified", 26 + i % 4 * 7),
            ]
        )
        record_case("R", i, i * (115 if backlog else 181), path)

    # Disputes continue through a human review in both periods. They never
    # receive an invented refund approval to inflate the refund cohort.
    for i in range(16):
        record_case(
            "D",
            i,
            230 + i * 505,
            [
                ("CRM", "Order confirmed", 0),
                ("Support", "Dispute opened", 140 + i % 4 * 20),
                ("Finance", "Evidence collected", 170 + i % 5 * 17),
                ("Support", "Dispute reviewed", 490 + i % 3 * 40),
                ("CRM", "Case closed", 39),
            ],
        )
    for i in range(14):
        record_case(
            "F",
            i,
            180 + i * 621,
            [
                ("CRM", "Order confirmed", 0),
                ("Operations", "Picking assigned", 210 + i % 5 * 15),
                ("Operations", "Parcel dispatched", 80 + i % 3 * 14),
                ("CRM", "Delivery confirmed", 310 + i % 6 * 30),
            ],
        )
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(
        [
            "case_id",
            "activity",
            "timestamp",
            "system",
            "event_id",
            "data_origin",
            "wave",
        ]
    )
    writer.writerows(sorted(rows, key=lambda r: (r[2], r[4])))
    return out.getvalue()
