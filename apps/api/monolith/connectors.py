"""Read-only source adapter contract. Secrets are retrieved only on the server."""

import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
import httpx
from .core import digest


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

    def access_token(self):
        if token := os.getenv("HUBSPOT_ACCESS_TOKEN"):
            return token
        response = httpx.post(
            "https://api.hubapi.com/oauth/v1/token",
            data={
                "grant_type": "refresh_token",
                "client_id": os.environ["HUBSPOT_CLIENT_ID"],
                "client_secret": os.environ["HUBSPOT_CLIENT_SECRET"],
                "refresh_token": os.environ["HUBSPOT_REFRESH_TOKEN"],
            },
            timeout=15,
        )
        response.raise_for_status()
        return response.json()["access_token"]

    def read(self, cursor=None, watermark=None):
        body = {
            "limit": 100,
            "properties": ["dealstage", "hs_lastmodifieddate"],
            "sorts": ["hs_lastmodifieddate"],
        }
        if watermark:
            body["filterGroups"] = [
                {
                    "filters": [
                        {
                            "propertyName": "hs_lastmodifieddate",
                            "operator": "GTE",
                            "value": watermark,
                        }
                    ]
                }
            ]
        if cursor:
            body["after"] = cursor
        headers = {"Authorization": "Bearer " + self.access_token()}
        for attempt in range(3):
            try:
                response = httpx.post(
                    "https://api.hubapi.com/crm/v3/objects/deals/search",
                    headers=headers,
                    json=body,
                    timeout=20,
                )
                if response.status_code != 429 and response.status_code < 500:
                    break
            except httpx.TransportError:
                if attempt == 2:
                    raise
            time.sleep(2**attempt)
        response.raise_for_status()
        page = response.json()
        rows = []
        for deal in page["results"]:
            ts = deal["properties"]["hs_lastmodifieddate"]
            ts = (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .astimezone(timezone.utc)
                .isoformat(timespec="seconds")
            )
            stage = deal["properties"].get("dealstage") or "unassigned"
            rows.append(
                dict(
                    id="EV-" + digest("hubspot", deal["id"], ts, stage),
                    case="HS-" + deal["id"],
                    activity="Deal observed · " + stage,
                    timestamp=ts,
                    system="HubSpot",
                    source="SRC-hubspot",
                    row=deal["id"],
                    synthetic=False,
                )
            )
        high = max(
            (
                int(datetime.fromisoformat(r["timestamp"]).timestamp() * 1000)
                for r in rows
            ),
            default=None,
        )
        return SyncPage(
            rows,
            page.get("paging", {}).get("next", {}).get("after"),
            str(high) if high else watermark,
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
