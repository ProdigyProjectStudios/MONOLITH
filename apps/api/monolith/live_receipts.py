"""Persist SDK call metadata separately from prompts, provider content and reasoning."""

import json
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from agents import AgentHooks, Model, ModelProvider, OpenAIProvider
from openai import AsyncOpenAI, DefaultAsyncHttpxClient

from .portable_investigation import InvestigationError
from .runtime_config import openai_secret, require_model_calls


class OwnedProvider(OpenAIProvider):
    def __init__(self, client):
        super().__init__(
            openai_client=client, use_responses=True, use_responses_websocket=False
        )
        self.client = client

    async def aclose(self):
        try:
            await super().aclose()
        finally:
            await self.client.close()


def connection():
    require_model_calls()
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
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        raise InvestigationError(
            "Configure an HTTPS provider endpoint. HTTP is available only on loopback."
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
    key = openai_secret()
    if not key:
        raise InvestigationError(
            "Live investigation requires a server-side OpenAI key."
        )
    provider = OwnedProvider(
        AsyncOpenAI(
            api_key=key,
            base_url=base,
            max_retries=0,
            timeout=60,
            http_client=DefaultAsyncHttpxClient(follow_redirects=False),
        )
    )
    return provider, {
        "provider": "openai" if official else "openai-compatible",
        "provider_endpoint": endpoint,
        "transport": "responses",
    }


class BudgetExhausted(InvestigationError):
    """No further provider request may be issued in this attempt."""


def _limit(name, default, maximum):
    try:
        value = int(os.getenv(name, str(default)))
        if 1 <= value <= maximum:
            return value
    except ValueError:
        pass
    raise InvestigationError(
        f"Invalid {name}. Expected a positive integer up to {maximum}."
    )


@dataclass
class RunBudget:
    max_calls: int
    max_output_tokens: int
    per_call_max_output_tokens: int
    calls: int = 0
    charged_output_tokens: int = 0

    @classmethod
    def from_env(cls):
        return cls(
            _limit("OPENAI_MAX_CALLS_PER_RUN", 64, 256),
            _limit("OPENAI_MAX_OUTPUT_TOKENS_PER_RUN", 80000, 1000000),
            _limit("OPENAI_MAX_OUTPUT_TOKENS_PER_CALL", 2500, 32000),
        )

    def limits(self):
        return {
            "max_calls": self.max_calls,
            "max_output_tokens": self.max_output_tokens,
            "per_call_max_output_tokens": self.per_call_max_output_tokens,
        }

    def reserve(self, requested):
        # Each investigation runs on one event loop. Reserve synchronously before yielding.
        remaining = self.max_output_tokens - self.charged_output_tokens
        if self.calls >= self.max_calls or remaining <= 0:
            raise BudgetExhausted(
                "Live provider budget exhausted. Review limits before starting a new attempt."
            )
        reserved = min(
            requested or self.per_call_max_output_tokens,
            self.per_call_max_output_tokens,
            remaining,
        )
        self.calls += 1
        self.charged_output_tokens += reserved
        return reserved

    def reconcile(self, reserved, response):
        usage = measured_usage(response)
        if usage and usage["output_tokens"] is not None:
            self.charged_output_tokens += usage["output_tokens"] - reserved


class BoundedModel(Model):
    def __init__(self, model, budget):
        self.inner = model
        self.budget = budget

    def get_default_model_settings(self):
        return self.inner.get_default_model_settings()

    def _get_request_settings(self, settings, **kwargs):
        return self.inner._get_request_settings(settings, **kwargs)

    async def get_response(
        self,
        system_instructions,
        input,
        model_settings,
        tools,
        output_schema,
        handoffs,
        tracing,
        **kwargs,
    ):
        require_model_calls()
        reserved = self.budget.reserve(model_settings.max_tokens)
        response = await self.inner.get_response(
            system_instructions=system_instructions,
            input=input,
            model_settings=replace(model_settings, max_tokens=reserved),
            tools=tools,
            output_schema=output_schema,
            handoffs=handoffs,
            tracing=tracing,
            **kwargs,
        )
        # An ambiguous failure, cancellation, or absent usage keeps the full reservation.
        self.budget.reconcile(reserved, response)
        return response

    def stream_response(self, *args, **kwargs):
        raise InvestigationError(
            "The investigation worker uses bounded non-streaming model requests."
        )


class BoundedProvider(ModelProvider):
    def __init__(self, provider, budget):
        self.provider = provider
        self.budget = budget

    def get_model(self, model_name):
        return BoundedModel(self.provider.get_model(model_name), self.budget)


@asynccontextmanager
async def bounded_provider(provider, budget):
    try:
        yield BoundedProvider(provider, budget)
    finally:
        if isinstance(provider, OwnedProvider):
            await provider.aclose()


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
    """One receipt per SDK model turn. Production transport retries are disabled."""

    def __init__(self, session, agent_name, model, origin):
        self.session = session
        self.agent_name = agent_name
        self.model = model
        self.origin = origin
        self.started = None
        self.rows = []
        self.budget = session.research.budget
        self.max_output_tokens = self.budget.per_call_max_output_tokens

    def event(self, kind, payload):
        self.session.emit(kind, self.session.stage, payload)

    async def on_llm_start(self, context, agent, system_prompt, input_items):
        if (
            self.budget.calls >= self.budget.max_calls
            or self.budget.charged_output_tokens >= self.budget.max_output_tokens
        ):
            return
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
        if isinstance(exc, BudgetExhausted):
            self.started = None
            self.event(
                "provider_budget_exhausted",
                {
                    **self.budget.limits(),
                    "calls": self.budget.calls,
                    "charged_output_tokens": self.budget.charged_output_tokens,
                    "agent": self.agent_name,
                    "mode": "live",
                },
            )
            return
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
