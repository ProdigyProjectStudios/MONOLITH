def mine(data, report):
    import pandas as pd
    import pm4py

    ids = set(report["case_ids"])
    rows = [
        (r["case"], r["activity"], r["timestamp"])
        for r in sorted(data["events"], key=lambda e: (e["timestamp"], e["id"]))
        if r["case"] in ids
    ]
    if rows:
        frame = pd.DataFrame(
            rows, columns=["case:concept:name", "concept:name", "time:timestamp"]
        )
        frame["time:timestamp"] = pd.to_datetime(frame["time:timestamp"], utc=True)
        dfg, _, _ = pm4py.discover_dfg(frame)
        for step in report["bottlenecks"]:
            if dfg.get((step["first"], step["last"])) != step["count"]:
                raise ValueError("Process discovery disagreement")
    report["mining"] = "PM4Py"
    return report
