#!/usr/bin/env python3
"""Poll deployed health and tenant metrics; notify the operator's configured webhook on transitions."""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def target(raw):
    u = urlsplit(raw)
    if (
        u.username
        or u.password
        or u.fragment
        or not u.hostname
        or (
            u.scheme != "https"
            and not (
                u.scheme == "http" and u.hostname in {"127.0.0.1", "localhost", "::1"}
            )
        )
    ):
        raise ValueError("Use an HTTPS endpoint or loopback HTTP.")
    return raw.rstrip("/")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(url, *, token="", body=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, headers=headers, data=json.dumps(body).encode() if body else None
    )
    with urllib.request.build_opener(NoRedirect).open(req, timeout=8) as res:
        return json.load(res) if body is None else res.status


def check(origin, token, previous):
    reasons = []
    try:
        if request(origin + "/api/health/ready").get("status") != "ready":
            reasons.append("dependencies_unready")
        metrics = request(origin + "/api/operations/metrics", token=token)
        stats = metrics["http_process"]
        if metrics["worker"]["status"] == "offline":
            reasons.append("worker_offline")
        if (
            metrics["queue"]["pending"] is not None
            and metrics["queue"]["pending"] >= 100
        ):
            reasons.append("queue_depth")
        if previous.get("start") == stats["process_started_at_unix"]:
            total = stats["requests"] - previous["requests"]
            errors = stats["server_errors"] - previous["errors"]
            if total >= 10 and errors / total >= 0.05:
                reasons.append("api_error_rate")
        sample = {
            "start": stats["process_started_at_unix"],
            "requests": stats["requests"],
            "errors": stats["server_errors"],
        }
    except (OSError, KeyError, TypeError, ValueError):
        reasons.append("health_or_metrics_unavailable")
        sample = {}
    return reasons, sample


def cycle(origin, token, hook, state):
    prior = json.loads(state.read_text()) if state.exists() else {}
    reasons, sample = check(origin, token, prior)
    status = "alert" if reasons else "healthy"
    event = {"service": "monolith", "status": status, "conditions": reasons}
    if hook and prior.get("conditions", []) != reasons:
        request(hook, body=event)
    state.parent.mkdir(parents=True, exist_ok=True)
    tmp = state.with_suffix(".tmp")
    tmp.write_text(json.dumps({**sample, **event}))
    tmp.replace(state)
    print(json.dumps(event), flush=True)
    return 2 if reasons else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    origin = target(os.environ["MONOLITH_API_URL"])
    hook = (
        target(os.environ["MONOLITH_ALERT_WEBHOOK"])
        if os.getenv("MONOLITH_ALERT_WEBHOOK")
        else None
    )
    token = Path(os.environ["MONOLITH_MONITOR_TOKEN_FILE"]).read_text().strip()
    while True:
        try:
            status = cycle(origin, token, hook, args.state)
        except (OSError, ValueError):
            print(
                '{"service":"monolith","status":"notification_failed"}',
                file=sys.stderr,
                flush=True,
            )
            status = 3
        if args.once:
            return status
        time.sleep(60)


if __name__ == "__main__":
    sys.exit(main())
