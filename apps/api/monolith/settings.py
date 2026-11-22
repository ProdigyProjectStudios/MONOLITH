"""Validate the service's identity boundary before serving requests."""

import json
import os
from functools import lru_cache


@lru_cache(maxsize=4)
def _tokens(raw, production):
    try:
        tokens = json.loads(raw or "{}")
    except ValueError as exc:
        raise RuntimeError("TENANT_TOKENS must be a JSON object") from exc
    if not isinstance(tokens, dict) or any(
        not isinstance(t, str)
        or not t.strip()
        or not isinstance(k, str)
        or not k.strip()
        for t, k in tokens.items()
    ):
        raise RuntimeError("Each workspace requires a nonempty bearer token")
    if len(set(tokens.values())) != len(tokens):
        raise RuntimeError("Workspace bearer tokens must be unique")
    if production and not tokens:
        raise RuntimeError(
            "A production API requires authenticated workspaces in TENANT_TOKENS"
        )
    return tokens


def workspace_tokens():
    return _tokens(
        os.getenv("TENANT_TOKENS", ""),
        os.getenv("MONOLITH_ENV", "development") == "production",
    )


def web_origins():
    return [
        o.strip()
        for o in os.getenv(
            "WEB_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if o.strip()
    ]


def redact_oauth_access_logs():
    """Uvicorn logs its request target as positional argument 3, including query strings."""
    import logging

    logger = logging.getLogger("uvicorn.access")
    if any(f.name == "monolith.oauth" for f in logger.filters):
        return

    class RedactCallback(logging.Filter):
        def filter(self, record):
            args = record.args
            if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
                path, separator, _ = args[2].partition("?")
                if separator and "/connectors/hubspot/oauth/" in path:
                    record.args = (*args[:2], path, *args[3:])
            return True

    logger.addFilter(RedactCallback("monolith.oauth"))
