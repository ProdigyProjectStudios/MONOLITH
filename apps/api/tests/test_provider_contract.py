"""Replay synthetic Responses envelopes through the real SDK runner, parser and tool loop."""

import ast
import asyncio
import json
from dataclasses import dataclass

import httpx
import pytest
from agents import OpenAIProvider
from monolith import architecture_review, investigator
from monolith.core import analyse
from monolith.live_receipts import estimate
from monolith.portable_investigation import STAGES, InvestigationError
from monolith.seed import make_seed
from openai import AsyncOpenAI
from provider_script import reply


@dataclass
class RequestTool(Exception):
    name: str
    arguments: dict


class ResponsesReplay:
    """Return the next recorded protocol shape, selecting arguments from genuine tool data."""

    def __init__(self, failure_after=None, behaviour=None, incomplete_after=None):
        self.n = 0
        self.failure_after = failure_after
        self.incomplete_after = incomplete_after
        self.behaviour = behaviour
        self.initial_inputs = {}

    async def __call__(self, request):
        assert (
            request.url.host == "responses-fixture.invalid"
            and request.url.path == "/v1/responses"
        )
        body = json.loads(request.content)
        assert body["store"] is False
        self.n += 1
        serial = f"fixture_{self.n:03}"
        if self.n == self.failure_after:
            return httpx.Response(
                403,
                json={
                    "error": {"message": "Fixture denied", "type": "permission_error"}
                },
                headers={"x-request-id": "req_" + serial},
            )
        instructions = body["instructions"]
        stage = next(
            s
            for s, v in {**investigator.BRIEFS, **architecture_review.BRIEFS}.items()
            if v in instructions
        )
        transcript = body["input"]
        if stage not in self.initial_inputs:
            self.initial_inputs[stage] = transcript
        issued = {
            item["call_id"]: item
            for item in transcript
            if item.get("type") == "function_call"
        }
        returns = {
            item["call_id"]: item["output"]
            for item in transcript
            if item.get("type") == "function_call_output"
        }

        async def invoke(name, **args):
            assert name in {t["name"] for t in body["tools"]}
            for cid, call in issued.items():
                if (
                    call["name"] == name
                    and json.loads(call["arguments"]) == args
                    and cid in returns
                ):
                    raw = returns[cid]
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError:
                        return ast.literal_eval(raw)
            raise RequestTool(name, args)

        try:
            output = await reply(stage, invoke, self.behaviour)
            item = {
                "type": "message",
                "role": "assistant",
                "id": "msg_" + serial,
                "status": "completed",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(output),
                        "annotations": [],
                    }
                ],
            }
        except RequestTool as call:
            item = {
                "type": "function_call",
                "id": "fc_" + serial,
                "call_id": "call_" + serial,
                "status": "completed",
                "name": call.name,
                "arguments": json.dumps(call.arguments),
            }
        return httpx.Response(
            200,
            headers={"x-request-id": "req_" + serial},
            json={
                "id": "resp_" + serial,
                "object": "response",
                "created_at": 1,
                "status": "incomplete"
                if self.n == self.incomplete_after
                else "completed",
                "incomplete_details": {"reason": "max_output_tokens"}
                if self.n == self.incomplete_after
                else None,
                "model": body["model"],
                "parallel_tool_calls": False,
                "tools": body["tools"],
                "tool_choice": "auto",
                "output": [item],
                "usage": {
                    "input_tokens": 20,
                    "input_tokens_details": {"cached_tokens": 5},
                    "output_tokens": 10,
                    "output_tokens_details": {"reasoning_tokens": 0},
                    "total_tokens": 30,
                },
            },
        )


def execute(monkeypatch, replay, events):
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    monkeypatch.setenv("OPENAI_MODEL", "fixture-model")
    monkeypatch.setenv(
        "OPENAI_MODEL_PRICING_JSON",
        json.dumps(
            {
                "fixture-model": {
                    "input_per_million_usd": 2,
                    "cached_input_per_million_usd": 1,
                    "output_per_million_usd": 8,
                }
            }
        ),
    )

    async def run():
        http = httpx.AsyncClient(transport=httpx.MockTransport(replay))
        # The OpenAI client owns and closes the injected HTTP transport.
        async with AsyncOpenAI(
            api_key="fixture",
            base_url="https://responses-fixture.invalid/v1",
            http_client=http,
            max_retries=0,
        ) as ai:
            provider = OpenAIProvider(
                openai_client=ai, use_responses=True, use_responses_websocket=False
            )
            monkeypatch.setattr(
                investigator,
                "connection",
                lambda: (
                    provider,
                    {
                        "provider": "test-fixture",
                        "provider_endpoint": "https://responses-fixture.invalid",
                        "transport": "responses",
                    },
                ),
            )
            data = make_seed()
            return await investigator.investigate(
                data, analyse(data), lambda *e: events.append(e), live=True
            )

    return asyncio.run(run())


def test_openai_responses_protocol_replay(monkeypatch):
    events = []
    replay = ResponsesReplay()
    result = execute(monkeypatch, replay, events)
    assert result["verified"] and result["selected"] == "queue"
    assert set(result["stages"]) == set(STAGES)
    assert result["stages"]["architect"]["debate"]["disagreement"]
    assert result["stages"]["verification"]["eligible_designs"] == ["batch", "queue"]
    assert replay.initial_inputs["reliability"] == replay.initial_inputs["operations"]
    for reviewer in ("reliability", "operations"):
        immutable_input = json.dumps(replay.initial_inputs[reviewer])
        assert (
            "fixture rationale" not in immutable_input
            and "earlier_findings" not in immutable_input
        )
        receipts = [
            p
            for k, s, p in events
            if k == "tool_result" and p.get("reviewer") == reviewer
        ]
        assert {x["name"] for x in receipts} == {
            "compare_architectures",
            "read_evidence",
        }
    rows = [p for k, s, p in events if k == "model_call"]
    assert rows == result["model_calls"]
    assert len(rows) == replay.n == len({r["response_id"] for r in rows})
    assert len({r["agent"] for r in rows}) == 8
    for row in rows:
        assert row["provider"] == "test-fixture" and row["model"] == "fixture-model"
        assert row["status"] == "completed" and row["duration_ms"] >= 0
        assert row["request_id"].startswith("req_fixture")
        assert row["usage"] == {
            "input_tokens": 20,
            "output_tokens": 10,
            "total_tokens": 30,
            "cached_input_tokens": 5,
        }
        assert row["estimated_cost_usd"] == pytest.approx(0.000115)
    assert result["stages"]["verification"]["review_resolutions"]


def test_provider_failure_retains_completed_call_and_failed_request_id(monkeypatch):
    events = []
    with pytest.raises(Exception, match="403"):
        execute(monkeypatch, ResponsesReplay(failure_after=2), events)
    rows = [p for k, s, p in events if k == "model_call"]
    assert [r["status"] for r in rows] == ["completed", "failed"]
    assert rows[0]["usage"]["total_tokens"] == 30
    assert rows[1]["request_id"] == "req_fixture_002" and rows[1]["usage"] is None
    assert rows[1]["estimated_cost_usd"] is None and rows[1]["response_id"] is None
    assert events[-1][0] == "stage_failed"


def test_explicit_veto_survives_verifiers_positive_proposal(monkeypatch):
    result = execute(monkeypatch, ResponsesReplay(behaviour="veto"), [])
    assert result["stages"]["architect"]["debate"]["eligible"] == ["batch"]
    assert result["stages"]["verification"]["verdict"] == "reject"
    assert result["selected"] == "neither" and not result["verified"]


def test_unpriced_usage_stays_unpriced(monkeypatch):
    usage = {
        "input_tokens": 20,
        "output_tokens": 10,
        "total_tokens": 30,
        "cached_input_tokens": 5,
    }
    for config in (
        "{}",
        "malformed",
        '{"other":{"input_per_million_usd":1,"output_per_million_usd":1}}',
        '{"m":{"input_per_million_usd":"Infinity","output_per_million_usd":1}}',
    ):
        monkeypatch.setenv("OPENAI_MODEL_PRICING_JSON", config)
        assert estimate("m", usage) is None


def test_incomplete_sdk_response_retains_returned_usage(monkeypatch):
    events = []
    with pytest.raises(Exception, match="incomplete"):
        execute(monkeypatch, ResponsesReplay(incomplete_after=1), events)
    rows = [p for k, s, p in events if k == "model_call"]
    assert len(rows) == 1 and rows[0]["status"] == "failed"
    assert rows[0]["usage"] == {
        "input_tokens": 20,
        "output_tokens": 10,
        "cached_input_tokens": 5,
        "total_tokens": 30,
    }
    assert rows[0]["estimated_cost_usd"] == pytest.approx(0.000115)


def test_same_transport_can_run_with_missing_usage_and_no_price_table(monkeypatch):
    from types import SimpleNamespace

    from monolith.live_receipts import measured_usage

    assert measured_usage(SimpleNamespace(raw_usage=None)) is None
    partial = measured_usage(
        SimpleNamespace(raw_usage={"input_tokens": 30, "output_tokens": 10})
    )
    assert partial == {
        "input_tokens": 30,
        "output_tokens": 10,
        "cached_input_tokens": None,
        "total_tokens": None,
    }
    monkeypatch.setenv(
        "OPENAI_MODEL_PRICING_JSON",
        '{"m":{"input_per_million_usd":1,"output_per_million_usd":2}}',
    )
    assert estimate("m", partial) is None


def test_veto_must_explain_why_this_design_was_rejected(monkeypatch):
    with pytest.raises(InvestigationError, match="Each veto requires"):
        execute(monkeypatch, ResponsesReplay(behaviour="unexplained_veto"), [])
