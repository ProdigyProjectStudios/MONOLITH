FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.12 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=secret,id=ca_bundle if [ -f /run/secrets/ca_bundle ]; then export SSL_CERT_FILE=/run/secrets/ca_bundle; fi && uv sync --frozen --no-dev
COPY monolith monolith
COPY migrations migrations
ENV PATH="/app/.venv/bin:$PATH"
CMD ["uvicorn","monolith.main:app","--host","0.0.0.0","--port","8000"]
