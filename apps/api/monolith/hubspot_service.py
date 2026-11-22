"""HubSpot OAuth lifecycle, verified deal observations and transactional checkpoints."""

import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import time
from datetime import UTC, datetime
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select

from . import store
from .access import as_principal, configured_actor, current_principal
from .connectors import HubSpot, ProviderError, configured
from .settings import authenticated_workspaces

SCOPES = HubSpot.scopes
CONNECTION = "hubspot-connection"
TICKET = "hubspot-launch"
STATE = "hubspot-state"
CHECKPOINT = "hubspot-checkpoint"
STATE_TTL = 600
LEASE = 90
PAGES = 20
LOOKBACK_MS = 120_000
CALLBACK = "/api/connectors/hubspot/oauth/callback"


def transport():
    return httpx.Client(follow_redirects=False, timeout=15)


def now():
    return datetime.now(UTC).isoformat(timespec="seconds")


def hashed(s):
    return hashlib.sha256(s.encode()).hexdigest()


def _rows(t, kind, key=None):
    cond = (store.records.c.tenant == t) & (store.records.c.kind == kind)
    return cond if key is None else cond & (store.records.c.id == key)


def _get(c, t, kind, key):
    raw = c.execute(select(store.records.c.payload).where(_rows(t, kind, key))).scalar()
    return json.loads(raw) if raw else {}


def _delete(c, t, kind, key=None):
    c.execute(delete(store.records).where(_rows(t, kind, key)))


def _save(c, t, state):
    store.put(c, t, CONNECTION, "deals", state)


def _cipher():
    try:
        return Fernet(os.environ["HUBSPOT_TOKEN_KEY"].encode())
    except (KeyError, ValueError, TypeError):
        raise ProviderError(
            "Configure a valid server-side HubSpot token encryption key.", 409
        ) from None


def redirect_uri():
    value = os.getenv("HUBSPOT_REDIRECT_URI", "")
    try:
        parts = urlsplit(value)
        host = parts.hostname
        if (
            not host
            or parts.path != CALLBACK
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
        ):
            return None
        if parts.scheme != "https" and not (
            parts.scheme == "http" and host == "localhost"
        ):
            return None
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return value
    except ValueError:
        pass
    return None


def _oauth_ready(t):
    if not redirect_uri() or not all(
        os.getenv(k) for k in ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"]
    ):
        return False
    try:
        _cipher()
        return t in authenticated_workspaces()
    except (ProviderError, ValueError, AttributeError):
        return False


def _env(t):
    return t == os.getenv("HUBSPOT_TENANT", "northstar") and configured()


def _env_fingerprint():
    return hashed(
        os.getenv("HUBSPOT_ACCESS_TOKEN") or os.getenv("HUBSPOT_REFRESH_TOKEN") or ""
    )


def _view(c, t):
    state = _get(c, t, CONNECTION, "deals")
    oauth = bool(state.get("credential"))
    env = bool(_env(t) and not state.get("disabled") and not oauth)
    pending_revoke = state.get("revocation") in {"pending", "retry_required"}
    verified = bool(
        not pending_revoke
        and state.get("portal_id")
        and not state.get("needs_reconnect")
        and (oauth or env and state.get("fingerprint") == _env_fingerprint())
    )
    portal = state.get("portal_id") if verified else None
    checkpoint = _get(c, t, CHECKPOINT, portal) if portal else {}
    latest = state.get("last_sync")
    if (
        latest
        and latest["status"] == "syncing"
        and state.get("lease_until", 0) <= time.time()
    ):
        latest = {
            **latest,
            "status": "interrupted",
            "error": "The worker stopped. Resume the sync from its last committed page.",
        }
    return {
        "connected": verified,
        "verified": verified,
        "verified_at": state.get("verified_at") if verified else None,
        "configured": oauth or env,
        "can_sync": bool((oauth or env) and not pending_revoke),
        "revocation": state.get("revocation"),
        "retry_at": datetime.fromtimestamp(state["retry_until"], UTC).isoformat()
        if state.get("retry_until", 0) > time.time()
        else None,
        "mode": "oauth" if oauth else "environment" if env else "none",
        "oauth_available": _oauth_ready(t),
        "portal_id": portal,
        "scopes": state.get("scopes", []) if verified else [],
        "disabled": bool(state.get("disabled")),
        "environment_available": bool(_env(t)),
        "redirect_uri": redirect_uri(),
        "checkpoint": checkpoint.get("watermark"),
        "pending_page": bool(checkpoint.get("window")),
        "last_sync": latest,
    }


def connection_status(t):
    with store.engine.connect() as c:
        return _view(c, t)


def _issue(c, t, kind, payload):
    nonce = secrets.token_urlsafe(32)
    store.put(
        c, t, kind, hashed(nonce), {**payload, "expires": int(time.time()) + STATE_TTL}
    )
    return nonce


def _owner(kind, nonce):
    if not re.fullmatch(r"[\w-]{43}", nonce or "", re.ASCII):
        raise ProviderError("This connection request is invalid or expired.", 400)
    with store.engine.connect() as c:
        t = c.execute(
            select(store.records.c.tenant).where(
                store.records.c.kind == kind, store.records.c.id == hashed(nonce)
            )
        ).scalar()
    if not t:
        raise ProviderError("This connection request is invalid or expired.", 400)
    return t


def _pending(c, t, kind, nonce):
    state = _get(c, t, kind, hashed(nonce))
    actor = configured_actor(t, state.get("actor", "shared-workspace-token"))
    if (
        state.get("expires", 0) < time.time()
        or not _oauth_ready(t)
        or not actor
        or "connectors:manage" not in actor.permissions
    ):
        raise ProviderError("This connection request is invalid or expired.", 400)
    return state


def start(t):
    if not _oauth_ready(t):
        raise ProviderError(
            "Configure the HubSpot OAuth app, exact callback, encryption key and an authenticated workspace.",
            409,
        )
    with store.locked(t) as c:
        if _get(c, t, CONNECTION, "deals").get("revocation") in {
            "pending",
            "retry_required",
        }:
            raise ProviderError(
                "Finish revocation or disconnect the local credential before reconnecting.",
                409,
            )
        _delete(c, t, TICKET)
        _delete(c, t, STATE)
        who = current_principal()
        if not who or who.tenant != t or "connectors:manage" not in who.permissions:
            raise ProviderError("A workspace connector administrator is required.", 403)
        ticket = _issue(c, t, TICKET, {"redirect": redirect_uri(), "actor": who.actor})
        # A new browser authorisation also invalidates any in-flight exchange.
        state = _get(c, t, CONNECTION, "deals")
        state["authorisation"] = hashed(ticket)
        _save(c, t, state)
        store.log(c, t, "HubSpot authorisation requested", "Read-only deals")
    base = redirect_uri().removesuffix("/callback")
    return {"authorization_url": base + "/launch#" + ticket, "expires_in": STATE_TTL}


def launch(ticket):
    t = _owner(TICKET, ticket)
    with store.locked(t) as c:
        data = _pending(c, t, TICKET, ticket)
        _delete(c, t, TICKET, hashed(ticket))
        cookie = secrets.token_urlsafe(32)
        state = _issue(
            c,
            t,
            STATE,
            {
                "binding": hashed(cookie),
                "redirect": data["redirect"],
                "attempt": hashed(ticket),
                "actor": data.get("actor", "shared-workspace-token"),
            },
        )
    url = "https://app.hubspot.com/oauth/authorize?" + urlencode(
        {
            "client_id": os.environ["HUBSPOT_CLIENT_ID"],
            "scope": " ".join(SCOPES),
            "redirect_uri": data["redirect"],
            "state": state,
        }
    )
    return url, cookie


def _identity(meta, private=False):
    if not isinstance(meta, dict):
        raise ProviderError("HubSpot did not return account metadata.")
    portal = str(meta.get("hubId" if private else "hub_id", ""))
    scopes = meta.get("scopes")
    if (
        not re.fullmatch(r"[1-9][0-9]{0,29}", portal)
        or not isinstance(scopes, list)
        or not all(isinstance(s, str) for s in scopes)
    ):
        raise ProviderError("HubSpot did not return a verified account and scopes.")
    if not set(SCOPES) <= set(scopes):
        raise ProviderError("The HubSpot account did not grant deals read access.", 403)
    if set(scopes) - {"oauth", *SCOPES}:
        raise ProviderError(
            "The credential grants more than deals read access. Configure a least-privilege credential.",
            403,
        )
    return portal, sorted(set(scopes))


def _tokens(t, meta, old_refresh=None):
    portal, scopes = _identity(meta)
    access, refresh = meta.get("access_token"), meta.get("refresh_token") or old_refresh
    expires = meta.get("expires_in")
    if (
        not all(isinstance(v, str) and v for v in (access, refresh))
        or type(expires) not in (int, float)
        or not 0 < expires <= 31536000
    ):
        raise ProviderError("HubSpot returned an incomplete credential or expiry.")
    return {
        "tenant": t,
        "portal_id": portal,
        "scopes": scopes,
        "access": access,
        "refresh": refresh,
        "expires": time.time() + expires,
    }


def _store_token(state, token, key="credential"):
    state.update(
        verified_at=now(),
        needs_reconnect=False,
        portal_id=token["portal_id"],
        scopes=token["scopes"],
        disabled=False,
    )
    state[key] = _cipher().encrypt(json.dumps(token).encode()).decode()


def _decrypt(t, state, key="credential"):
    try:
        obj = json.loads(_cipher().decrypt(state[key].encode()))
        if obj["tenant"] != t or obj["portal_id"] != state.get("portal_id"):
            raise ValueError
        return obj
    except (InvalidToken, ValueError, KeyError):
        raise ProviderError(
            "The stored credential cannot be opened for this tenant. Restore the key or reconnect.",
            409,
        ) from None


def _same_account(state, portal):
    if state.get("portal_id") and state["portal_id"] != portal:
        raise ProviderError(
            "HubSpot returned a different account. Disconnect before selecting a different portal.",
            409,
        )


def complete(state_value, cookie, code, denied):
    t = _owner(STATE, state_value)
    with store.locked(t) as c:
        pending = _pending(c, t, STATE, state_value)
        if not cookie or not hmac.compare_digest(pending["binding"], hashed(cookie)):
            raise ProviderError(
                "This callback must use the browser that opened the connection.", 400
            )
        _delete(c, t, STATE, hashed(state_value))
    if denied or not code:
        raise ProviderError(
            "HubSpot authorisation was declined or did not return a code.", 400
        )
    with transport() as client:
        reply = HubSpot(client).grant(
            grant_type="authorization_code", code=code, redirect_uri=pending["redirect"]
        )
    token = _tokens(t, reply)
    with store.locked(t) as c:
        state = _get(c, t, CONNECTION, "deals")
        if state.get("authorisation") != pending["attempt"]:
            raise ProviderError("This connection was superseded or disconnected.", 409)
        _same_account(state, token["portal_id"])
        actor = configured_actor(t, pending.get("actor", "shared-workspace-token"))
        if not actor or "connectors:manage" not in actor.permissions:
            raise ProviderError("Connector administrator access is required.", 403)
        _store_token(state, token)
        state.pop("authorisation", None)
        state.pop("revocation", None)
        state.pop("retry_until", None)
        state.pop("lease", None)
        state.pop("lease_until", None)
        state.pop("last_sync", None)
        _save(c, t, state)
        with as_principal(actor):
            store.log(c, t, "HubSpot account connected", "Portal " + token["portal_id"])


def disconnect(t):
    with store.locked(t) as c:
        state = _get(c, t, CONNECTION, "deals")
        if (
            state.get("revocation") == "pending"
            and state.get("lease_until", 0) > time.time()
        ):
            raise ProviderError(
                "Wait for the active revocation attempt to finish.", 409
            )
        _delete(c, t, TICKET)
        _delete(c, t, STATE)
        _save(c, t, {"disabled": True})
        store.log(
            c,
            t,
            "HubSpot disconnected",
            "Local credential removed; imported evidence retained",
        )
        return _view(c, t)


def revoke(t):
    """Suspend reads before revocation and retain a retryable encrypted grant on failure."""
    attempt = secrets.token_hex(16)
    with store.locked(t) as c:
        state = _get(c, t, CONNECTION, "deals")
        if state.get("revocation") == "revoked":
            return _view(c, t)
        wait = state.get("retry_until", 0) - time.time()
        if wait > 0:
            raise ProviderError(
                "The HubSpot rate-limit delay is still active.", 429, math.ceil(wait)
            )
        if not state.get("credential"):
            raise ProviderError(
                "Only a workspace-managed OAuth grant can be revoked here.", 409
            )
        if state.get("lease_until", 0) > time.time() and state.get("lease"):
            raise ProviderError(
                "Wait for the active connector operation to finish.", 409
            )
        if not os.getenv("HUBSPOT_CLIENT_ID") or not os.getenv("HUBSPOT_CLIENT_SECRET"):
            raise ProviderError(
                "Configure the OAuth app credentials before revoking its grant.", 409
            )
        credential = _decrypt(t, state)
        _delete(c, t, TICKET)
        _delete(c, t, STATE)
        state.pop("authorisation", None)
        state.update(
            revocation="pending", lease=attempt, lease_until=time.time() + LEASE
        )
        _save(c, t, state)
        store.log(
            c, t, "HubSpot revocation requested", "Portal " + credential["portal_id"]
        )
    try:
        with transport() as client:
            HubSpot(client).revoke(credential["refresh"])
    except Exception as exc:
        delay = exc.retry_after if isinstance(exc, ProviderError) else None
        with store.locked(t) as c:
            current = _get(c, t, CONNECTION, "deals")
            if current.get("lease") == attempt:
                current.pop("lease", None)
                current["revocation"] = "retry_required"
                if delay:
                    current["retry_until"] = time.time() + delay
                _save(c, t, current)
                store.log(
                    c,
                    t,
                    "HubSpot revocation unconfirmed",
                    "Sync suspended until the grant is resolved",
                )
        raise ProviderError(
            "HubSpot revocation was not confirmed. Sync is suspended. Retry revocation.",
            429 if delay else 502,
            delay,
        ) from None
    with store.locked(t) as c:
        current = _get(c, t, CONNECTION, "deals")
        if current.get("lease") == attempt:
            _save(c, t, {"disabled": True, "revocation": "revoked"})
        store.log(
            c, t, "HubSpot refresh grant revoked", "Portal " + credential["portal_id"]
        )
        return _view(c, t)


def enable(t):
    if not _env(t):
        raise ProviderError(
            "This tenant has no server-supplied HubSpot credential.", 409
        )
    with store.locked(t) as c:
        state = _get(c, t, CONNECTION, "deals")
        if state.get("credential"):
            raise ProviderError("Disconnect the current OAuth account first.", 409)
        state["disabled"] = False
        _save(c, t, state)
        store.log(
            c, t, "HubSpot server credential enabled", "Verification will occur at sync"
        )
        return _view(c, t)


def _owned(c, t, lease):
    state = _get(c, t, CONNECTION, "deals")
    if state.get("lease") != lease or state.get("lease_until", 0) < time.time():
        raise ProviderError(
            "This sync was interrupted. Resume the latest connection.", 409
        )
    return state


def _access(t, lease, client, force=False):
    with store.locked(t) as c:
        state = _owned(c, t, lease)
    adapter = HubSpot(client)
    oauth = bool(state.get("credential"))
    private = os.getenv("HUBSPOT_ACCESS_TOKEN")
    cached_env = (
        not private
        and state.get("fingerprint") == _env_fingerprint()
        and state.get("env_credential")
    )
    if oauth or cached_env:
        token = _decrypt(t, state, "credential" if oauth else "env_credential")
        if force or token["expires"] <= time.time() + 60:
            token = _tokens(
                t,
                adapter.grant(
                    grant_type="refresh_token", refresh_token=token["refresh"]
                ),
                token["refresh"],
            )
        access, portal, scopes = token["access"], token["portal_id"], token["scopes"]
    elif private:
        portal, scopes = _identity(adapter.private_info(private), True)
        access = private
    else:
        _cipher()  # A rotating refresh grant must be persisted before its next use.
        refresh = os.environ["HUBSPOT_REFRESH_TOKEN"]
        token = _tokens(
            t, adapter.grant(grant_type="refresh_token", refresh_token=refresh), refresh
        )
        access, portal, scopes = token["access"], token["portal_id"], token["scopes"]
    with store.locked(t) as c:
        current = _owned(c, t, lease)
        _same_account(current, portal)
        if current.get("credential"):
            _store_token(current, token)
        else:
            current.update(
                portal_id=portal, scopes=scopes, fingerprint=_env_fingerprint()
            )
        if not oauth and not private and os.getenv("HUBSPOT_TOKEN_KEY"):
            _store_token(current, token, "env_credential")
        current.update(verified_at=now(), needs_reconnect=False)
        current["lease_until"] = time.time() + LEASE
        _save(c, t, current)
    return HubSpot(client, access, portal, os.getenv("HUBSPOT_CASE_PROPERTY") or None)


def sync(t, full=False):
    lease = secrets.token_hex(16)
    with store.locked(t) as c:
        if not _view(c, t)["can_sync"]:
            raise ProviderError(
                "No HubSpot credential is configured for this workspace.", 409
            )
        state = _get(c, t, CONNECTION, "deals")
        wait = state.get("retry_until", 0) - time.time()
        if wait > 0:
            raise ProviderError(
                "The HubSpot rate-limit delay is still active.", 429, math.ceil(wait)
            )
        state.pop("retry_until", None)
        if state.get("lease") and state.get("lease_until", 0) > time.time():
            raise ProviderError("A HubSpot sync is already running.", 409)
        state.update(
            lease=lease,
            lease_until=time.time() + LEASE,
            last_sync={"status": "syncing", "at": now(), "added": 0},
        )
        _save(c, t, state)
    try:
        with transport() as client:
            adapter = _access(t, lease, client)
            portal = adapter.portal_id
            with store.locked(t) as c:
                _owned(c, t, lease)
                cp = _get(c, t, CHECKPOINT, portal)
                window = cp.get("window") if not full else None
                if not window:
                    base = int(cp.get("watermark") or 0)
                    window = {
                        "lower": str(max(0, base - LOOKBACK_MS))
                        if base and not full
                        else None,
                        "upper": str(int(time.time() * 1000)),
                        "last_id": None,
                        "high": cp.get("watermark"),
                    }
                    cp["window"] = window
                    store.put(c, t, CHECKPOINT, portal, cp)
            source = {
                "id": f"SRC-hubspot-{portal}",
                "name": f"HubSpot deals · {portal}",
                "kind": "CRM",
                "synthetic": False,
                "provider": "hubspot",
                "portal_id": portal,
                "scopes": list(SCOPES),
            }
            added = 0
            refreshed = False
            for page_number in range(1, PAGES + 1):

                def fetch(reader):
                    return reader.read(
                        watermark=window["lower"],
                        upper=window["upper"],
                        last_id=window["last_id"],
                    )

                try:
                    page = fetch(adapter)
                except ProviderError as e:
                    if (
                        refreshed
                        or e.status != 401
                        or not (
                            state.get("credential")
                            or not os.getenv("HUBSPOT_ACCESS_TOKEN")
                        )
                    ):
                        raise
                    adapter = _access(t, lease, client, True)
                    refreshed = True
                    page = fetch(adapter)
                with store.locked(t) as c:
                    current = _owned(c, t, lease)
                    from .continuous_service import capture, capture_legacy_baseline

                    capture_legacy_baseline(c, t)
                    changed = _get(c, t, "sources", source["id"]) != source
                    store.put(c, t, "sources", source["id"], source)
                    for row in page.records:
                        existing = _get(c, t, "events", row["id"])
                        if not existing:
                            store.put(c, t, "events", row["id"], row)
                            added += 1
                            changed = True
                        elif row["provenance"]["case_property"] and not existing.get(
                            "provenance", {}
                        ).get("case_property"):
                            store.put(c, t, "events", row["id"], row)
                            changed = True
                    if changed:
                        capture(c, t, "HubSpot page ingested")
                    if page.records:
                        window["last_id"] = page.records[-1]["row"]
                    high = max(int(window.get("high") or 0), int(page.watermark or 0))
                    if high:
                        window["high"] = str(high)
                    complete = not page.cursor
                    if complete:
                        cp = {"watermark": window.get("high"), "finished": now()}
                    else:
                        cp["window"] = window
                    store.put(c, t, CHECKPOINT, portal, cp)
                    done = complete or page_number == PAGES
                    current.update(
                        lease_until=time.time() + LEASE,
                        last_sync={
                            "status": "complete"
                            if complete
                            else "partial"
                            if done
                            else "syncing",
                            "at": now(),
                            "added": added,
                            "pages": page_number,
                        },
                    )
                    if done:
                        current.pop("lease", None)
                    _save(c, t, current)
                    store.log(
                        c,
                        t,
                        "HubSpot page ingested",
                        f"Portal {portal} · {len(page.records)} observations · request page {page_number}",
                    )
                if done:
                    return {
                        "added": added,
                        "pages": page_number,
                        "complete": complete,
                        "checkpoint": cp.get("watermark"),
                    }
    except Exception as exc:
        reason = (
            str(exc)
            if isinstance(exc, ProviderError)
            else "The sync could not commit its current page. Resume from the last checkpoint."
        )
        with store.locked(t) as c:
            current = _get(c, t, CONNECTION, "deals")
            if current.get("lease") == lease:
                current.pop("lease", None)
                if isinstance(exc, ProviderError) and exc.retry_after:
                    current["retry_until"] = time.time() + exc.retry_after
                if isinstance(exc, ProviderError) and exc.status in (401, 403):
                    current["needs_reconnect"] = True
                current["last_sync"] = {
                    **current["last_sync"],
                    "status": "failed",
                    "at": now(),
                    "error": reason,
                }
                _save(c, t, current)
                store.log(c, t, "HubSpot sync failed", reason)
        if isinstance(exc, ProviderError):
            raise
        raise ProviderError(reason) from None
