"""Exit successfully when this container's own RQ worker is registered and current."""

import os
import socket
from datetime import UTC, datetime

from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry
from rq import Queue, Worker


def healthy():
    try:
        with Redis.from_url(
            os.environ["REDIS_URL"],
            socket_connect_timeout=2,
            socket_timeout=2,
            retry=Retry(NoBackoff(), 0),
        ) as conn:
            workers = Worker.all(
                connection=conn, queue=Queue("monolith", connection=conn)
            )
            return any(
                w.hostname == socket.gethostname()
                and w.last_heartbeat is not None
                and (datetime.now(UTC) - w.last_heartbeat).total_seconds()
                < w.worker_ttl + 60
                for w in workers
            )
    except (KeyError, OSError, RedisError):
        return False


if __name__ == "__main__":
    raise SystemExit(0 if healthy() else 1)
