import asyncio

from . import store
from .core import analyse
from .mining import mine
from .portable_investigation import InvestigationError
from .runtime_config import credential_status, require_model_calls
from .telemetry import worker_span


@worker_span("monolith.analysis")
def generate(tenant, days, with_ai):
    if with_ai:
        require_model_calls()
        if not credential_status()["configured"]:
            raise InvestigationError(
                "AI analysis requires a valid server-side OpenAI credential."
            )
    data = store.dataset(tenant)
    report = mine(data, analyse(data, days))
    if with_ai:
        from .intelligence import assess

        report = asyncio.run(assess(data, report))
    with store.locked(tenant) as c:
        store.log(
            c,
            tenant,
            "Analysis completed",
            f"{report['engine']} · {report['events']} events · {days} days",
        )
    return report
