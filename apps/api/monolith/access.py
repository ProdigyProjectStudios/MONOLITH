"""Authenticate the bearer, select its tenant and enforce server-owned permissions."""

import hashlib
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette._utils import get_route_path
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.routing import compile_path

from .settings import identity_registry

READ = frozenset({"workspace:read", "reports:read"})
ANALYZE = READ | {"investigations:run", "sources:write", "monitor:manage"}
APPROVE = READ | {"decisions:approve"}
PERMISSIONS = {
    "viewer": READ,
    "analyst": ANALYZE,
    "approver": APPROVE,
    "demo": ANALYZE | APPROVE,
    "admin": ANALYZE
    | APPROVE
    | {"models:run", "connectors:manage", "operations:manage"},
}
# New protected routes require a declared capability. POST by itself does not imply mutation.
ROUTES = {
    "workspace:read": {
        "GET": [
            "workspace",
            "records",
            "jobs/{id}",
            "investigations",
            "investigations/{id}",
            "investigations/{id}/snapshot",
            "investigations/{id}/evaluation",
            "investigations/{id}/events",
            "correlations/hubspot",
            "correlations/hubspot/{id}",
            "continuous",
            "continuous/status",
            "continuous/snapshots/{id}",
            "continuous/snapshots/{id}/records",
            "continuous/snapshots/{id}/evidence/{eid}",
            "continuous/history",
            "continuous/signals/{id}",
            "continuous/nodes",
            "continuous/nodes/{id}",
            "continuous/decisions",
            "continuous/investigations/{id}",
        ],
        "POST": ["evidence/search"],
    },
    "reports:read": {
        "GET": ["report"],
        "POST": ["flagship/package", "flagship/simulate"],
    },
    "investigations:run": {
        "POST": [
            "analysis",
            "investigations",
            "investigations/{id}/resume",
            "investigations/{id}/repeat",
        ]
    },
    "sources:write": {"POST": ["upload", "events", "continuous/fixtures/{wave}"]},
    "monitor:manage": {
        "POST": ["continuous/refresh", "continuous/investigations/{id}/resume"]
    },
    "decisions:approve": {"POST": ["review", "investigations/{id}/approve"]},
    "connectors:manage": {
        "GET": ["connectors/hubspot/status"],
        "POST": [
            "connectors/hubspot/oauth/start",
            "connectors/hubspot/sync",
            "connectors/hubspot/enable",
            "connectors/hubspot/disconnect",
            "connectors/hubspot/revoke",
        ],
    },
    "operations:manage": {"GET": ["runtime/readiness"]},
}
POLICIES = [
    (method, compile_path("/api/" + route)[0], permission)
    for permission, methods in ROUTES.items()
    for method, paths in methods.items()
    for route in paths
]
PUBLIC = {
    ("GET", "/api/health"),
    ("GET", "/api/health/ready"),
    ("GET", "/api/connectors/hubspot/oauth/launch"),
    ("POST", "/api/connectors/hubspot/oauth/launch"),
    ("GET", "/api/connectors/hubspot/oauth/callback"),
}


@dataclass(frozen=True)
class Principal:
    tenant: str
    actor: str
    role: str
    legacy: bool = False

    @property
    def permissions(self):
        return PERMISSIONS[self.role]

    def public(self):
        return {
            "actor": self.actor,
            "role": self.role,
            "permissions": sorted(self.permissions),
            "legacy": self.legacy,
        }


CURRENT = ContextVar("monolith_principal", default=None)


def current_principal():
    return CURRENT.get()


@contextmanager
def as_principal(who):
    token = CURRENT.set(who)
    try:
        yield who
    finally:
        CURRENT.reset(token)


def resolve_identity(authorization):
    registry = identity_registry()
    if not registry and not authorization:
        return Principal("northstar", "development-demo", "demo")
    scheme, _, value = authorization.partition(" ")
    if scheme.casefold() == "bearer" and value.isascii() and 0 < len(value) <= 4096:
        member = registry.get(hashlib.sha256(value.encode("ascii")).digest())
        if member:
            return Principal(*member)
    raise HTTPException(
        401,
        "A valid workspace access token is required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def configured_actor(tenant, actor):
    return next(
        (
            Principal(*row)
            for row in identity_registry().values()
            if row[:2] == (tenant, actor)
        ),
        None,
    )


def policy(method, path):
    if path.startswith("/api/operations/") or path == "/api/operations":
        return "operations:manage"
    return next(
        (
            permission
            for verb, pattern, permission in POLICIES
            if method == verb and pattern.fullmatch(path)
        ),
        None,
    )


def require_capability(permission, who=None):
    who = who or current_principal()
    if who is None or (who.role == "demo" and permission not in who.permissions):
        raise HTTPException(
            401,
            "A configured workspace access token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if permission not in who.permissions:
        raise HTTPException(403, "Your workspace role does not permit this action")


def admitted(scope):
    credentials = Headers(scope=scope).getlist("authorization")
    if len(credentials) > 1:
        raise HTTPException(
            401,
            "Provide one workspace bearer credential",
            headers={"WWW-Authenticate": "Bearer"},
        )
    who = resolve_identity(credentials[0] if credentials else "")
    path = get_route_path(scope).rstrip("/")
    capability = policy(scope["method"], path)
    if capability is None:
        raise HTTPException(404, "API resource not found")
    require_capability(capability, who)
    return who


bearer = HTTPBearer(
    scheme_name="WorkspaceBearer",
    auto_error=False,
    description="Operator-provisioned tenant and actor credential",
)


async def tenant(
    request: Request,
    _credential: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    # Standalone routers use the same gate as the full application's pre-body middleware.
    who = getattr(request.state, "principal", None) or admitted(request.scope)
    with as_principal(who):
        yield who.tenant


class AccessMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = get_route_path(scope).rstrip("/")
        if (
            not path.startswith("/api/")
            or scope["method"] == "OPTIONS"
            or (scope["method"], path) in PUBLIC
        ):
            return await self.app(scope, receive, send)
        try:
            who = admitted(scope)
        except HTTPException as exc:
            response = JSONResponse(
                {"detail": exc.detail},
                status_code=exc.status_code,
                headers={**(exc.headers or {}), "Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)
        scope.setdefault("state", {})["principal"] = who

        async def private_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "no-store"
                headers.add_vary_header("Authorization")
            await send(message)

        with as_principal(who):
            await self.app(scope, receive, private_send)
