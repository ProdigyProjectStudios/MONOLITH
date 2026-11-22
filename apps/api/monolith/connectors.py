"""Read-only HubSpot transport and source adapter contracts."""

import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

import httpx

from .core import digest


class ProviderError(Exception):
    """The message contains only operator-safe descriptions, never provider bodies."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


@dataclass
class SyncPage:
    records: list
    cursor: str | None
    watermark: str | None


class Connector(Protocol):
    scopes: tuple[str, ...]

    def read(self, cursor: str | None, watermark: str | None) -> SyncPage: ...


class OAuthConnector(Protocol):
    scopes: tuple[str, ...]

    def access_token(self) -> str: ...


class HubSpot:
    scopes = ("crm.objects.deals.read",)
    token_url = "https://api.hubspot.com/oauth/2026-09/token"
    deals_url = "https://api.hubapi.com/crm/objects/2026-09/deals/search"
    private_info_url = (
        "https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info"
    )

    def __init__(self, client=None, token=None, portal_id=None, case_property=None):
        self.post = client.post if client is not None else httpx.post
        self.token = token
        self.portal_id = portal_id
        self.case_property = case_property
        if case_property and not re.fullmatch(r"[a-z][a-z0-9_]{0,99}", case_property):
            raise ProviderError(
                "The configured case property must be a HubSpot internal property name.",
                409,
            )

    def _request(self, url, *, retry=False, **kwargs):
        for attempt in range(3 if retry else 1):
            try:
                response = self.post(url, timeout=15, **kwargs)
            except httpx.TransportError:
                if retry and attempt < 2:
                    time.sleep(0.25 * 2**attempt)
                    continue
                raise ProviderError(
                    "HubSpot did not respond. Retry the operation."
                ) from None
            if response.is_success:
                try:
                    result = response.json()
                    if not isinstance(result, dict):
                        raise TypeError
                except (TypeError, ValueError):
                    raise ProviderError(
                        "HubSpot returned an unreadable response."
                    ) from None
                return result
            if url == self.token_url and response.status_code == 400:
                raise ProviderError(
                    "HubSpot declined this token grant. Reconnect the account.", 401
                )
            if response.status_code in (401, 403):
                raise ProviderError(
                    "HubSpot declined the credential or read scope. Reconnect the account.",
                    response.status_code,
                )
            if response.status_code == 429 or response.status_code >= 500:
                try:
                    delay = float(
                        response.headers.get("Retry-After", 0.25 * 2**attempt)
                    )
                except ValueError:
                    delay = 1
                if retry and attempt < 2 and 0 <= delay <= 3:
                    time.sleep(delay)
                    continue
                raise ProviderError(
                    "HubSpot is temporarily rate-limited or unavailable. Resume the sync.",
                    503,
                )
            raise ProviderError(
                "HubSpot declined the request. Check the app settings, scopes and property names.",
                502,
            )
        raise ProviderError("HubSpot retry limit reached.")

    def grant(self, **parameters):
        return self._request(
            self.token_url,
            data={
                "client_id": os.environ["HUBSPOT_CLIENT_ID"],
                "client_secret": os.environ["HUBSPOT_CLIENT_SECRET"],
                **parameters,
            },
        )

    def private_info(self, token):
        return self._request(
            self.private_info_url, json={"tokenKey": token}, retry=True
        )

    def access_token(self):
        if token := self.token or os.getenv("HUBSPOT_ACCESS_TOKEN"):
            return token
        grant = self.grant(
            grant_type="refresh_token",
            refresh_token=os.environ["HUBSPOT_REFRESH_TOKEN"],
        )
        if not grant.get("access_token"):
            raise ProviderError("HubSpot omitted the access token.")
        return grant["access_token"]

    def read(self, cursor=None, watermark=None, *, upper=None, last_id=None):
        # Stable ID keyset within a fixed modification-time window bypasses the
        # CRM search result cap. Existing low-level cursor consumers can still
        # request HubSpot's native after pagination using the original method.
        filters = []
        if watermark is not None:
            filters.append(
                {
                    "propertyName": "hs_lastmodifieddate",
                    "operator": "GTE",
                    "value": str(watermark),
                }
            )
        if upper is not None:
            filters.append(
                {
                    "propertyName": "hs_lastmodifieddate",
                    "operator": "LTE",
                    "value": str(upper),
                }
            )
        if last_id:
            filters.append(
                {
                    "propertyName": "hs_object_id",
                    "operator": "GT",
                    "value": str(last_id),
                }
            )
        properties = ["dealstage", "hs_lastmodifieddate"]
        if self.case_property and self.case_property not in properties:
            properties.append(self.case_property)
        order = "hs_object_id" if upper is not None else "hs_lastmodifieddate"
        body = {
            "limit": 100,
            "properties": properties,
            "sorts": [{"propertyName": order, "direction": "ASCENDING"}],
        }
        if filters:
            body["filterGroups"] = [{"filters": filters}]
        if cursor:
            body["after"] = cursor
        data = self._request(
            self.deals_url,
            json=body,
            headers={"Authorization": "Bearer " + self.access_token()},
            retry=True,
        )
        rows = []
        high = None
        try:
            if not isinstance(data["results"], list) or len(data["results"]) > 100:
                raise ValueError
            for deal in data["results"]:
                oid = str(deal["id"])
                if not re.fullmatch(r"[1-9][0-9]{0,30}", oid):
                    raise ValueError
                props = deal["properties"]
                dt = datetime.fromisoformat(props["hs_lastmodifieddate"])
                if dt.tzinfo is None:
                    raise ValueError
                dt = dt.astimezone(UTC)
                millis = (dt - datetime(1970, 1, 1, tzinfo=UTC)) // timedelta(
                    milliseconds=1
                )
                high = max(high or millis, millis)
                ts = dt.isoformat(
                    timespec="microseconds" if dt.microsecond % 1000 else "milliseconds"
                )
                stage = props.get("dealstage")
                reference = (
                    props.get(self.case_property) if self.case_property else None
                )
                if stage is not None and not isinstance(stage, str):
                    raise ValueError
                if reference is not None and not isinstance(reference, (str, int)):
                    raise ValueError
                portal = self.portal_id
                source = f"SRC-hubspot-{portal}" if portal else "SRC-hubspot"
                case = f"HS-{portal}-{oid}" if portal else f"HS-{oid}"
                provenance = {
                    "provider": "hubspot",
                    "portal_id": portal,
                    "object_type": "deal",
                    "object_id": oid,
                    "stage_id": stage,
                    "modified_at": ts,
                    "case_property": self.case_property,
                    "case_reference": str(reference).strip() or None
                    if reference is not None
                    else None,
                    "record_url": f"https://app.hubspot.com/contacts/{portal}/record/0-3/{oid}"
                    if portal
                    else None,
                }
                rows.append(
                    {
                        "id": "EV-" + digest("hubspot", portal, oid, ts, stage),
                        "case": case,
                        "activity": "Deal observed · " + (stage or "unassigned"),
                        "timestamp": ts,
                        "system": "HubSpot",
                        "source": source,
                        "row": oid,
                        "synthetic": False,
                        "provenance": provenance,
                    }
                )
            after = data.get("paging", {}).get("next", {}).get("after")
            if after is not None and not rows:
                raise ValueError
            if upper is not None:
                ids = [int(r["row"]) for r in rows]
                if ids != sorted(set(ids)) or ids and ids[0] <= int(last_id or 0):
                    raise ValueError
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            raise ProviderError(
                "HubSpot returned invalid deal IDs, ordering, timestamps or properties."
            ) from None
        return SyncPage(
            rows,
            str(after) if after is not None else None,
            str(high) if high is not None else watermark,
        )


ADAPTERS = {"HubSpot": HubSpot}
EXTENSIONS = {
    "Google Drive": "drive.readonly",
    "Slack": "channels:history",
    "Stripe": "read_only",
    "MCP": "resource/read",
}


def configured():
    return bool(
        os.getenv("HUBSPOT_ACCESS_TOKEN")
        or all(
            os.getenv("HUBSPOT_" + k)
            for k in ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"]
        )
    )
