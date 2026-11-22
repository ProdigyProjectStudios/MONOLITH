"""Validate the service's identity boundary before serving requests."""

import json
import os
from functools import lru_cache


def _json_map(raw, name):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result

    try:
        value = json.loads(raw or "{}", object_pairs_hook=unique)
    except ValueError:
        raise RuntimeError(f"{name} must be a JSON object with unique keys") from None
    if not isinstance(value, dict):
        raise RuntimeError(f"{name} must be a JSON object with unique keys")  # noqa: TRY004 - deployment configuration error.
    return value


def _principal_id(value):
    return (
        isinstance(value, str)
        and 0 < len(value) <= 128
        and value == value.strip()
        and value.isprintable()
    )


def _token(value):
    return (
        isinstance(value, str)
        and 0 < len(value) <= 4096
        and value.isascii()
        and value.isprintable()
        and value == value.strip()
    )


@lru_cache(maxsize=4)
def _registry(legacy_raw, named_raw, production):
    import hashlib

    legacy = _json_map(legacy_raw, "TENANT_TOKENS")
    named = _json_map(named_raw, "TENANT_IDENTITIES")
    if set(legacy) & set(named):
        raise RuntimeError(
            "A workspace must use either shared or actor-specific credentials"
        )
    members = []

    def register(t, actor, role, value, shared):
        if not _principal_id(t) or not _token(value):
            raise RuntimeError("Each workspace requires a valid bearer token")
        fingerprint = hashlib.sha256(value.encode("ascii")).digest()
        members.append((fingerprint, t, actor, role, shared))

    for tenant, value in legacy.items():
        register(tenant, "shared-workspace-token", "admin", value, True)
    for tenant, actors in named.items():
        if not isinstance(actors, dict) or not actors:
            raise RuntimeError("Each named workspace requires actor credentials")
        for actor, config in actors.items():
            if not _principal_id(actor) or actor in {
                "system",
                "development-demo",
                "shared-workspace-token",
            }:
                raise RuntimeError("Configure a distinct named actor ID")
            if not isinstance(config, dict) or set(config) != {"token", "role"}:
                raise RuntimeError("Each named actor requires a token and role")
            if config["role"] not in ("viewer", "analyst", "approver", "admin"):
                raise RuntimeError("Unsupported workspace role")
            register(tenant, actor, config["role"], config["token"], False)
    if len({row[0] for row in members}) != len(members):
        raise RuntimeError("Workspace bearer tokens must be unique")
    if production and not members:
        raise RuntimeError(
            "A production API requires authenticated workspaces in TENANT_IDENTITIES or TENANT_TOKENS"
        )
    return {row[0]: row[1:] for row in members}


def identity_registry():
    return _registry(
        os.getenv("TENANT_TOKENS", ""),
        os.getenv("TENANT_IDENTITIES", ""),
        os.getenv("MONOLITH_ENV", "development") == "production",
    )


def authenticated_workspaces():
    return frozenset(row[0] for row in identity_registry().values())


def workspace_tokens():
    """Validate the full identity configuration and preserve the legacy mapping interface."""
    identity_registry()
    return _json_map(os.getenv("TENANT_TOKENS", ""), "TENANT_TOKENS")


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
