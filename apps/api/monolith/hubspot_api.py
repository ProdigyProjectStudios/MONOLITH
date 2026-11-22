"""Tenant-authenticated connection management and first-party OAuth browser callbacks."""

import html
import secrets
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from . import hubspot_service as service
from .connectors import ProviderError

connection_status = service.connection_status
HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
}


def _call(fn, *args):
    try:
        return JSONResponse(fn(*args), headers=HEADERS)
    except ProviderError as exc:
        headers = {
            **HEADERS,
            **({"Retry-After": str(exc.retry_after)} if exc.retry_after else {}),
        }
        raise HTTPException(exc.status, str(exc), headers=headers) from None


def _cookie(state):
    return "monolith_hs_" + service.hashed(state)[:24]


def _message(text, status=200):
    safe = html.escape(text)
    return HTMLResponse(
        f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MONOLITH · HubSpot</title><main><h1>MONOLITH · HubSpot</h1><p>{safe}</p><p>Return to Data sources and refresh the connection status.</p></main></html>',
        status_code=status,
        headers=HEADERS,
    )


def make_hubspot_router(tenant_dependency):
    router = APIRouter(prefix="/api/connectors/hubspot")

    @router.get("/status")
    def status(t: str = Depends(tenant_dependency)):
        return _call(connection_status, t)

    @router.post("/oauth/start")
    def start(t: str = Depends(tenant_dependency)):
        return _call(service.start, t)

    @router.get("/oauth/launch")
    def prepare():
        nonce = secrets.token_urlsafe(24)
        headers = {
            **HEADERS,
            "Content-Security-Policy": f"default-src 'none'; script-src 'nonce-{nonce}'; form-action 'self' https://app.hubspot.com; frame-ancestors 'none'; base-uri 'none'",
        }
        # The one-use ticket is submitted in the form body and removed from history.
        return HTMLResponse(
            f"""<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect HubSpot · MONOLITH</title>
        <p id="status">Opening the read-only HubSpot connection…</p><form method="post"><input type="hidden" name="ticket"></form>
        <script nonce="{nonce}">const ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);
        if (/^[A-Za-z0-9_-]{{43}}$/.test(ticket)){{const form=document.forms[0];form.elements.ticket.value=ticket;form.submit();}}
        else document.getElementById('status').textContent='Start this connection from Data sources in MONOLITH.';</script></html>""",
            headers=headers,
        )

    @router.post("/oauth/launch")
    def launch(request: Request, ticket: str = Form("")):
        uri = service.redirect_uri()
        if not uri:
            return _message("The registered OAuth callback is unavailable.", 409)
        origin = urlsplit(uri)
        posted_origin = request.headers.get("origin")
        # Browsers may suppress Origin on a no-referrer form navigation. Fetch
        # metadata still distinguishes a first-party form from a foreign POST.
        first_party = (
            posted_origin in (None, "null")
            and request.headers.get("sec-fetch-site") == "same-origin"
            and request.headers.get("sec-fetch-mode") == "navigate"
        )
        if posted_origin != f"{origin.scheme}://{origin.netloc}" and not first_party:
            return _message("Open the first-party launch page from MONOLITH.", 400)
        try:
            url, binding = service.launch(ticket)
        except ProviderError as exc:
            return _message(str(exc), exc.status)
        state = parse_qs(urlsplit(url).query)["state"][0]
        response = RedirectResponse(url, status_code=303, headers=HEADERS)
        response.set_cookie(
            _cookie(state),
            binding,
            max_age=service.STATE_TTL,
            path=service.CALLBACK,
            httponly=True,
            secure=origin.scheme == "https",
            samesite="lax",
        )
        return response

    @router.get("/oauth/callback")
    def callback(request: Request, state: str = "", code: str = "", error: str = ""):
        try:
            service.complete(
                state, request.cookies.get(_cookie(state)), code, bool(error)
            )
            response = _message(
                "The HubSpot account is connected with deals read access."
            )
        except ProviderError as exc:
            response = _message(str(exc), exc.status)
        response.delete_cookie(
            _cookie(state),
            path=service.CALLBACK,
            httponly=True,
            samesite="lax",
            secure=bool((service.redirect_uri() or "").startswith("https:")),
        )
        return response

    @router.post("/sync")
    def sync(full: bool = False, t: str = Depends(tenant_dependency)):
        return _call(service.sync, t, full)

    @router.post("/disconnect")
    def disconnect(t: str = Depends(tenant_dependency)):
        return _call(service.disconnect, t)

    @router.post("/revoke")
    def revoke(t: str = Depends(tenant_dependency)):
        return _call(service.revoke, t)

    @router.post("/enable")
    def enable(t: str = Depends(tenant_dependency)):
        return _call(service.enable, t)

    return router
