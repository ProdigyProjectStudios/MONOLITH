"""Persist SDK call metadata separately from prompts, provider content and reasoning."""

import json
import os
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from agents import AgentHooks, OpenAIProvider

from .portable_investigation import InvestigationError


def connection():
    base = os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    parsed = urlsplit(base)
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise InvestigationError(
            "Configure a plain OpenAI base URL without credentials or URL parameters."
        )
    origin = f"{parsed.scheme}://{parsed.hostname}"
    if parsed.port:
        origin += f":{parsed.port}"
    official = (
        parsed.scheme == "https"
        and parsed.hostname == "api.openai.com"
        and parsed.port in (None, 443)
        and parsed.path.rstrip("/") == "/v1"
    )
    # Custom URL path segments may contain organisation identifiers or token-like material.
    endpoint = "https://api.openai.com/v1/responses" if official else origin
    provider = OpenAIProvider(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=base,
        use_responses=True,
        use_responses_websocket=False,
    )
    return provider, {
        "provider": "openai" if official else "openai-compatible",
        "provider_endpoint": endpoint,
        "transport": "responses",
    }


def _count(raw, name):
    value = raw.get(name)
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        else None
    )


def measured_usage(response):
    raw = response.raw_usage
    if not raw:
        return None
    details = raw.get("input_tokens_details")
    if not isinstance(details, dict):
        details = {}
    counts = {
        "input_tokens": _count(raw, "input_tokens"),
        "output_tokens": _count(raw, "output_tokens"),
        "total_tokens": _count(raw, "total_tokens"),
        "cached_input_tokens": _count(details, "cached_tokens"),
    }
    return counts if any(v is not None for v in counts.values()) else None


def estimate(model, usage):
    """Quote only with valid operator-provided per-model rates and sufficient observed usage."""
    if not usage or usage["input_tokens"] is None or usage["output_tokens"] is None:
        return None
    try:
        rates = json.loads(os.environ.get("OPENAI_MODEL_PRICING_JSON", "{}"))[model]
        input_rate = Decimal(str(rates["input_per_million_usd"]))
        output_rate = Decimal(str(rates["output_per_million_usd"]))
        if (
            usage["cached_input_tokens"] != 0
            and "cached_input_per_million_usd" not in rates
        ):
            return None
        cached_rate = Decimal(
            str(rates.get("cached_input_per_million_usd", input_rate))
        )
        if any(
            not v.is_finite() or v < 0 for v in (input_rate, output_rate, cached_rate)
        ):
            return None
        cached = usage["cached_input_tokens"]
        if cached is None and input_rate != cached_rate:
            return None
        cached = cached or 0
        if cached > usage["input_tokens"]:
            return None
        quoted = (
            (usage["input_tokens"] - cached) * input_rate
            + cached * cached_rate
            + usage["output_tokens"] * output_rate
        ) / Decimal(1_000_000)
        return float(quoted.quantize(Decimal("0.0000000001")))
    except (ValueError, TypeError, KeyError, InvalidOperation, AttributeError):
        return None


class CallReceipts(AgentHooks):
    """One receipt per SDK model turn; transport retries belong to that turn."""

    def __init__(self, session, agent_name, model, origin):
        self.session = session
        self.agent_name = agent_name
        self.model = model
        self.origin = origin
        self.started = None
        self.rows = []

    def event(self, kind, payload):
        self.session.emit(kind, self.session.stage, payload)

    async def on_llm_start(self, context, agent, system_prompt, input_items):
        self.started = time.monotonic()
        self.event(
            "model_call_started",
            {
                **self.origin,
                "agent": self.agent_name,
                "model": self.model,
                "mode": "live",
                "call": len(self.rows) + 1,
            },
        )

    def close_turn(
        self, status, usage, response_id=None, request_id=None, error_type=None
    ):
        if self.started is None:
            return
        row = {
            **self.origin,
            "agent": self.agent_name,
            "model": self.model,
            "mode": "live",
            "call": len(self.rows) + 1,
            "status": status,
            "model_source": "requested_model",
            "call_scope": "sdk_turn",
            "duration_ms": round((time.monotonic() - self.started) * 1000, 1),
            "response_id": response_id,
            "request_id": request_id,
            "usage": usage,
            "estimated_cost_usd": estimate(self.model, usage),
        }
        if error_type:
            row["error_type"] = error_type
        self.started = None
        self.rows.append(row)
        self.event("model_call", row)

    async def on_llm_end(self, context, agent, response):
        self.close_turn(
            "completed",
            measured_usage(response),
            response.response_id,
            response.request_id,
        )

    def failed(self, exc):
        # The pinned SDK attaches provider-reported usage to terminal model errors.
        terminal = getattr(exc, "_terminal_usage", None)
        usage = None
        if terminal is not None:
            usage = {
                "input_tokens": terminal.input_tokens,
                "output_tokens": terminal.output_tokens,
                "total_tokens": terminal.total_tokens,
                "cached_input_tokens": terminal.input_tokens_details.cached_tokens,
            }
        self.close_turn(
            "failed",
            usage,
            request_id=getattr(exc, "request_id", None),
            error_type=type(exc).__name__,
        )
