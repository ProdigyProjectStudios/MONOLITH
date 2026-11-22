"""All provider observations in these tests are fixtures, never seed records."""

import pytest
from fastapi.testclient import TestClient
from monolith import store
from monolith.core import merge, parse_csv
from monolith.correlations import DealIndex
from sqlalchemy import create_engine


def crm(portal, deal, day=1, ref=None, stage="open"):
    stamp = f"2026-11-{day:02}T10:00:00.125000+00:00"
    sid = "SRC-hubspot" + (f"-{portal}" if portal else "")
    case = "HS-" + (f"{portal}-" if portal else "") + deal
    row = {
        "id": f"EV-test-{portal}-{deal}-{day}",
        "source": sid,
        "case": case,
        "row": deal,
        "system": "HubSpot",
        "activity": "Deal observed · " + stage,
        "timestamp": stamp,
        "synthetic": False,
    }
    if portal:
        row["provenance"] = {
            "provider": "hubspot",
            "portal_id": portal,
            "object_type": "deal",
            "object_id": deal,
            "stage_id": stage,
            "modified_at": stamp,
            "case_property": "order_reference",
            "case_reference": ref,
        }
    return {"id": sid, "name": "fixture CRM", "kind": "CRM", "synthetic": False}, [row]


def operational(rows, synthetic=False):
    head = "case_id,activity,timestamp,system,hubspot_portal_id,hubspot_deal_id\n"
    return parse_csv(
        head
        + "\n".join(
            f"{case},{activity},2026-11-03T{hour:02}:00:00Z,Operations,{portal},{deal}"
            for hour, (case, activity, portal, deal) in enumerate(rows)
        ),
        "fixture.csv",
        synthetic=synthetic,
    )


def data(*parts):
    dataset = {"sources": [], "events": [], "docs": []}
    for source, rows in parts:
        merge(dataset, source, rows)
    return dataset


def test_scoped_ids_direct_case_keys_historical_hypotheses_and_citations():
    ops = operational(
        [
            ("flow-3", "Dispatch queued", "17", "42"),
            ("flow-3", "Dispatch complete", "", ""),
            ("order-9", "Return opened", "", ""),
            ("previous-9", "Obsolete reference", "", ""),
            ("unkeyed", "Unscoped ID", "", "42"),
            ("HS-17-42", "Scoped case", "", ""),
            ("flow-3", "Contradictory key", "17", "99"),
            ("unrelated", "Unrelated", "", ""),
        ]
    )
    synthetic = operational(
        [("order-9", "Synthetic collision", "", "")], synthetic=True
    )
    ix = DealIndex(
        data(
            crm("17", "42", 2, "Order-9", "paid"),
            ops,
            crm("17", "42", 1, "Previous-9"),
            synthetic,
            crm("18", "42"),
        )
    )
    d = ix.details("17:42")
    assert [r["stage"] for r in d["history"]] == ["open", "paid"]
    assert {m["activity"]: m["rule"] for m in d["matches"]} == {
        "Dispatch queued": "Scoped object ID",
        "Return opened": "Configured case reference",
        "Scoped case": "Scoped case ID",
    }
    candidates = {h["activity"]: h for h in d["hypotheses"]}
    assert {k: v["rule"] for k, v in candidates.items()} == {
        "Unscoped ID": "Unscoped deal ID",
        "Obsolete reference": "Historical reference",
        "Dispatch complete": "Case participation",
    }
    assert candidates["Dispatch complete"]["evidence"] == [
        "EV-test-17-42-2",
        ops[1][0]["id"],
        ops[1][1]["id"],
    ]
    assert candidates["Obsolete reference"]["evidence"][0] == "EV-test-17-42-1"
    assert [p["steps"] for p in d["processes"] if p["case_id"] == "FLOW-3"] == [
        ["Dispatch queued", "Dispatch complete"]
    ]
    assert not ix.details("18:42")["matches"]
    assert len(ix.summaries("paid")) == 1


def test_ambiguous_reference_is_never_verified_and_lacks_a_process_join():
    ix = DealIndex(
        data(
            crm("17", "42", ref="Order-9"),
            crm("18", "9", ref="ORDER-9"),
            operational([("order-9", "Return opened", "", "")]),
        )
    )
    for key in ("17:42", "18:9"):
        detail = ix.details(key)
        assert not detail["matches"] and not detail["processes"]
        assert [h["rule"] for h in detail["hypotheses"]] == ["Shared reference"]
        assert len(detail["hypotheses"][0]["evidence"]) == 3


def test_legacy_names_and_synthetic_data_cannot_attest_portal_identity():
    a = crm(None, "45")
    spoof = crm("7", "91")
    spoof[0]["kind"] = "CSV"
    synthetic = crm("6", "51")
    synthetic[0]["synthetic"] = True
    mismatch = crm("13", "20")
    mismatch[1][0]["provenance"]["object_id"] = "21"
    ix = DealIndex(
        data(
            a,
            spoof,
            synthetic,
            mismatch,
            operational([("HS-45", "Existing case", "", "45")]),
        )
    )
    assert [d["key"] for d in ix.summaries()] == ["legacy:45"]
    assert ix.details("legacy:45")["matches"] == []
    assert ix.summaries()[0]["record_url"] is None


def test_csv_validation_and_idempotent_foreign_keys():
    row = [("ord", "Read", "27", "91")]
    original = operational(row)
    assert data(original, original)["events"] == original[1]
    with pytest.raises(ValueError, match="Conflicting"):
        data(original, operational([("ord", "Read", "19", "91")]))
    with pytest.raises(ValueError, match="invalid hubspot_deal_id"):
        operational([("ord", "Read", "27", "9.1")])
    with pytest.raises(ValueError, match="must include hubspot_deal_id"):
        operational([("ord", "Read", "27", "")])
    assert operational([("ord", "Read", "", "91")])[1][0]["hubspot_deal_id"] == "91"


def test_correlation_routes_respect_authenticated_tenant(tmp_path, monkeypatch):
    from monolith.main import app

    monkeypatch.setattr(
        store, "engine", create_engine("sqlite:///" + str(tmp_path / "records.db"))
    )
    monkeypatch.setenv("TENANT_TOKENS", '{"one":"first","two":"second"}')
    with TestClient(app) as client:
        store.save_batch(
            "one",
            [crm("7", "119"), operational([("ORDER", "Dispatch", "7", "119")])],
            "fixture read",
        )
        assert client.get("/api/correlations/hubspot").status_code == 401
        client.headers["Authorization"] = "Bearer first"
        assert client.get("/api/correlations/hubspot?q=119").json()["total"] == 1
        assert (
            client.get("/api/correlations/hubspot/7:119").json()["matches"][0]["rule"]
            == "Scoped object ID"
        )
        client.headers["Authorization"] = "Bearer second"
        assert client.get("/api/correlations/hubspot").json() == {
            "total": 0,
            "items": [],
        }
        assert client.get("/api/correlations/hubspot/7:119").status_code == 404


def test_adapter_payload_keeps_original_property_and_both_sides_of_join():
    import httpx
    from monolith.connectors import HubSpot

    payload = {
        "results": [
            {
                "id": "3407",
                "properties": {
                    "dealstage": "contractsent",
                    "hs_lastmodifieddate": "2026-11-14T11:03:18.214Z",
                    "work_order_ref": "  job-119  ",
                },
            }
        ]
    }
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as transport:
        adapter = HubSpot(
            client=transport,
            token="fixture-only",
            portal_id="887",
            case_property="work_order_ref",
        )
        page = adapter.read()
    source = {
        "id": "SRC-hubspot-887",
        "kind": "CRM",
        "name": "fixture connector",
        "synthetic": False,
    }
    ops = operational([("Job-119", "Job accepted", "", "")])
    ix = DealIndex(data((source, page.records), ops))
    observation = ix.summaries()[0]
    assert (
        observation["source_id"] == source["id"] and observation["portal_id"] == "887"
    )
    assert (
        observation["case_property"] == "work_order_ref"
        and observation["case_reference"] == "job-119"
    )
    link = ix.details(observation["key"])["matches"][0]
    assert link["evidence"] == [page.records[0]["id"], ops[1][0]["id"]]


def test_joint_csv_and_hubspot_mining_retains_timestamp_precision():
    from monolith.core import analyse
    from monolith.mining import mine

    dataset = data(
        crm("7", "31", 1),
        crm("7", "31", 2),
        operational([("CASE-7", "Post", "7", "31")]),
    )
    report = mine(dataset, analyse(dataset))
    assert report["events"] == 3
    assert report["mining"] == "PM4Py"
