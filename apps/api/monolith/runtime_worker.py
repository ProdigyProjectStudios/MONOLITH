"""RQ workers attest their own redacted provider configuration with each heartbeat."""

import json

from rq import Worker

from .runtime_config import credential_status


class MonolithWorker(Worker):
    def heartbeat(self, timeout=None, pipeline=None):
        super().heartbeat(timeout, pipeline)
        conn = self.connection if pipeline is None else pipeline
        conn.hset(self.key, "monolith_provider", json.dumps(credential_status()))
