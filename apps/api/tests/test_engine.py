import pytest
from monolith.seed import make_seed
from monolith.core import analyse, document, merge, parse_csv, simulate
from monolith.mining import mine
from monolith.connectors import HubSpot
import httpx


def test_evidence_and_mining():
    data = make_seed()
    report = mine(data, analyse(data))
    assert report["mining"] == "PM4Py"
    assert (report["events"], report["cases"], report["variants"]) == (1706, 328, 5)
    assert sum(v["count"] for v in report["paths"]) == report["cases"]
    valid = {r["id"] for r in data["events"] + data["docs"]}
    for rec in report["recommendations"]:
        assert rec["evidence"] and set(rec["evidence"]) <= valid
        assert rec["id"] in report["blueprints"]
    review = next(r for r in report["recommendations"] if r["kind"] == "Human-led")
    assert review["score"] == 0 and simulate(review, 1, 1) == 0
    assert any(i.startswith("DOC") for i in review["evidence"])
    assert analyse(data, 7)["events"] < report["events"]
    assert len(report["traces"]) == 5


def test_idempotency_and_invalid_input():
    content = "case_id,activity,timestamp,system,event_id\n ns-1 ,Log,2026-10-20T11:00:00+01:00,CRM,abc"
    data = {"events": [], "docs": [], "sources": []}
    part = parse_csv(content, "a.csv")
    merge(data, *part)
    merge(data, *part)
    assert len(data["events"]) == 1 and data["events"][0]["case"] == "NS-1"
    assert data["events"][0]["timestamp"] == "2026-10-20T10:00:00+00:00"
    with pytest.raises(ValueError):
        merge(data, *parse_csv(content.replace("Log", "Ship"), "a.csv"))
    with pytest.raises(ValueError):
        parse_csv("foo,bar\na,b", "bad.csv")
    with pytest.raises(ValueError):
        parse_csv(content.replace("+01:00", ""), "bad.csv")
    with pytest.raises(ValueError):
        document(["  "], "scan.pdf")
    assert analyse(data)["recommendations"] == []


def test_hubspot_paginated_read(monkeypatch):
    seen = []
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "fixture-only")

    def fake(url, **params):
        seen.append(params)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": "12",
                        "properties": {
                            "hs_lastmodifieddate": "2026-10-20T10:00:00Z",
                            "dealstage": "won",
                        },
                    }
                ],
                "paging": {"next": {"after": "100"}},
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake)
    page = HubSpot().read("52", "1234")
    assert page.cursor == "100" and page.records[0]["case"] == "HS-12"
    assert seen[0]["json"]["filterGroups"][0]["filters"][0]["value"] == "1234"
    assert seen[0]["json"]["after"] == "52"


def test_agent_pipeline_and_verification(monkeypatch):
    import asyncio
    import json
    from types import SimpleNamespace
    from agents import Runner
    from monolith.intelligence import assess, Finding

    data = make_seed()
    report = analyse(data)
    calls = []

    async def run(agent, prompt, max_turns):
        payload = json.loads(prompt)
        assert len(payload["prior_findings"]) == len(calls)
        assert {t.name for t in agent.tools} == {"read_evidence", "inspect_candidate"}
        calls.append(agent.name)
        return SimpleNamespace(
            final_output=Finding(
                statement="Fixture inference",
                limitation="Fixture limitation",
                evidence=payload["candidates"][0]["evidence"][:1],
            ),
            new_items=[SimpleNamespace(type="tool_call_item")],
        )

    monkeypatch.setattr(Runner, "run", run)
    result = asyncio.run(assess(data, report))
    assert len(calls) == 5 and result["engine"] == "OpenAI Agents SDK"

    async def unsupported(*args, **kwargs):
        return SimpleNamespace(
            final_output=Finding(
                statement="Unsupported", limitation="Test", evidence=["EV-absent"]
            ),
            new_items=[SimpleNamespace(type="tool_call_item")],
        )

    monkeypatch.setattr(Runner, "run", unsupported)
    with pytest.raises(ValueError, match="Unsupported evidence"):
        asyncio.run(assess(data, analyse(data)))
