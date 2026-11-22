import asyncio
import os
from .core import analyse
from .mining import mine
from . import store


def generate(tenant, days, with_ai):
    data = store.dataset(tenant)
    report = mine(data, analyse(data, days))
    if with_ai and os.getenv("OPENAI_API_KEY"):
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
