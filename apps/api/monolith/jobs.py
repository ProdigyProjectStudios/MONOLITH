import asyncio

from . import store
from .core import analyse
from .mining import mine
from .runtime_config import openai_configured


def generate(tenant, days, with_ai):
    data = store.dataset(tenant)
    report = mine(data, analyse(data, days))
    if with_ai and openai_configured():
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
