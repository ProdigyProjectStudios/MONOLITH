"""Read-only HubSpot identity joins over one tenant's persisted, sourced records."""

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from . import store


def identifier(value):
    value = str(value or "")
    return (
        value
        if value.isascii() and value.isdigit() and not value.startswith("0")
        else None
    )


def snapshot(event, sources):
    source = sources.get(event["source"], {})
    if (
        event.get("synthetic") is not False
        or source.get("synthetic") is not False
        or source.get("kind") != "CRM"
        or event.get("system") != "HubSpot"
    ):
        return None
    deal = identifier(event["row"])
    if not deal:
        return None
    info = event.get("provenance") or {}
    account = identifier(info.get("portal_id"))
    if account:
        if (
            info.get("provider") != "hubspot"
            or info.get("object_type") != "deal"
            or str(info.get("object_id")) != deal
            or event["case"] != f"HS-{account}-{deal}"
            or source["id"] != "SRC-hubspot-" + account
        ):
            return None
    elif info or source["id"] != "SRC-hubspot" or event["case"] != "HS-" + deal:
        return None
    ref = str(info.get("case_reference") or "").strip()
    prop = info.get("case_property") if ref else None
    return {
        "key": f"{account or 'legacy'}:{deal}",
        "portal_id": account,
        "object_id": deal,
        "event_id": event["id"],
        "source_id": event["source"],
        "case_id": event["case"],
        "stage": str(
            info.get("stage_id") or event["activity"].removeprefix("Deal observed · ")
        ),
        "modified_at": info.get("modified_at") or event["timestamp"],
        "case_property": prop,
        "case_reference": ref if prop else None,
    }


class DealIndex:
    def __init__(self, data):
        sources = {s["id"]: s for s in data["sources"]}
        self.by_key = defaultdict(list)
        self.operational = []
        for e in data["events"]:
            observed = snapshot(e, sources)
            if observed:
                self.by_key[observed["key"]].append(observed)
            elif (
                e.get("synthetic") is False
                and sources.get(e["source"], {}).get("synthetic") is False
                and sources[e["source"]].get("kind") == "CSV"
            ):
                self.operational.append(e)
        self.refs = defaultdict(set)
        for key, history in self.by_key.items():
            history.sort(
                key=lambda e: (datetime.fromisoformat(e["modified_at"]), e["event_id"])
            )
            latest = history[-1]
            if latest["portal_id"]:
                self.refs[latest["case_id"]].add(key)
                if latest["case_reference"]:
                    self.refs[latest["case_reference"].upper()].add(key)
        self.operational.sort(key=lambda e: (e["timestamp"], e["id"]))

    def summaries(self, query=""):
        result = []
        term = query.strip().casefold()
        for history in self.by_key.values():
            latest = history[-1]
            if term and not any(
                term in str(latest.get(k) or "").casefold()
                for k in ("key", "stage", "case_reference")
            ):
                continue
            result.append(
                {
                    **latest,
                    "observations": len(history),
                    "record_url": f"https://app.hubspot.com/contacts/{latest['portal_id']}/record/0-3/{latest['object_id']}"
                    if latest["portal_id"]
                    else None,
                }
            )
        return sorted(
            result,
            key=lambda d: (datetime.fromisoformat(d["modified_at"]), d["key"]),
            reverse=True,
        )

    def details(self, key):
        if key not in self.by_key:
            return None
        history = self.by_key[key]
        latest = history[-1]
        direct, inferred = [], []
        processes = defaultdict(list)
        if not latest["portal_id"]:
            return {
                "history": history,
                "matches": [],
                "hypotheses": [],
                "processes": [],
            }
        ref = (latest["case_reference"] or "").upper()
        old_refs = {
            r["case_reference"].upper(): r for r in history[:-1] if r["case_reference"]
        }
        direct_cases = {}
        for e in self.operational:
            portal, deal = e.get("hubspot_portal_id"), e.get("hubspot_deal_id")
            if deal and (
                deal != latest["object_id"]
                or (portal and portal != latest["portal_id"])
            ):
                continue
            observed = latest
            supporting = []
            if portal and deal:
                classification, rule, basis = (
                    direct,
                    "Scoped object ID",
                    f"CSV hubspot_portal_id={portal} and hubspot_deal_id={deal} match the connector’s portal and deal IDs.",
                )
            elif e["case"] == "HS-" + latest["portal_id"] + "-" + latest["object_id"]:
                classification, rule, basis = (
                    direct,
                    "Scoped case ID",
                    f"CSV case_id equals the connector’s account-scoped case key {e['case']}.",
                )
            elif ref and e["case"] == ref:
                if len(self.refs[ref]) > 1:
                    supporting = [
                        self.by_key[k][-1]["event_id"]
                        for k in sorted(self.refs[ref])
                        if k != key
                    ]
                    classification, rule, basis = (
                        inferred,
                        "Shared reference",
                        f"The case key {ref} occurs on {len(self.refs[ref])} observed deals across their current case references or scoped object keys. A unique deal association needs another key.",
                    )
                else:
                    classification, rule, basis = (
                        direct,
                        "Configured case reference",
                        f"HubSpot {latest['case_property']}={latest['case_reference']} matches CSV case_id={e['case']} after trimming and uppercasing.",
                    )
            elif deal:
                classification, rule, basis = (
                    inferred,
                    "Unscoped deal ID",
                    f"CSV hubspot_deal_id={deal} matches the object ID. The CSV row supplies no portal ID.",
                )
            elif e["case"] in old_refs:
                observed = old_refs[e["case"]]
                supporting = [latest["event_id"]]
                classification, rule, basis = (
                    inferred,
                    "Historical reference",
                    f"A previous snapshot declared {observed['case_property']}={observed['case_reference']}. The latest snapshot does not.",
                )
            else:
                continue
            classification.append(
                {
                    "rule": rule,
                    "basis": basis,
                    "case_id": e["case"],
                    "activity": e["activity"],
                    "system": e["system"],
                    "evidence": [observed["event_id"], *supporting, e["id"]],
                }
            )
            if classification is direct:
                direct_cases.setdefault(e["case"], (observed["event_id"], e["id"]))
        classified = {r["evidence"][-1] for r in direct + inferred}
        for e in self.operational:
            if e["case"] not in direct_cases:
                continue
            # A contradictory explicit foreign key prevents case-level propagation.
            if e.get("hubspot_deal_id") and (
                e["hubspot_deal_id"] != latest["object_id"]
                or e.get("hubspot_portal_id") not in (None, latest["portal_id"])
            ):
                continue
            processes[e["case"]].append(e)
            if e["id"] not in classified:
                inferred.append(
                    {
                        "rule": "Case participation",
                        "basis": f"This event shares operational case {e['case']} with a directly linked row. The event carries no independent deal reference.",
                        "case_id": e["case"],
                        "activity": e["activity"],
                        "system": e["system"],
                        "evidence": [*direct_cases[e["case"]], e["id"]],
                    }
                )
        return {
            "history": history,
            "matches": direct,
            "hypotheses": inferred,
            "processes": [
                {
                    "case_id": case,
                    "steps": [e["activity"] for e in rows],
                    "evidence": [e["id"] for e in rows],
                }
                for case, rows in processes.items()
            ],
        }


def correlation_router(tenant):
    router = APIRouter(prefix="/api/correlations/hubspot")

    @router.get("")
    def list_deals(
        q: str = Query("", max_length=160),
        offset: int = Query(0, ge=0),
        limit: int = Query(30, ge=1, le=100),
        t: str = Depends(tenant),
    ):
        items = DealIndex(store.dataset(t)).summaries(q)
        return {"items": items[offset : offset + limit], "total": len(items)}

    @router.get("/{key}")
    def detail(key: str, t: str = Depends(tenant)):
        result = DealIndex(store.dataset(t)).details(key)
        if result is None:
            raise HTTPException(
                404, "Observed HubSpot deal not found in this workspace"
            )
        return result

    return router
