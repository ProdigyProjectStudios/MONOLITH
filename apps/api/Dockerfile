FROM ghcr.io/astral-sh/uv:0.9.12@sha256:0eaa66c625730a3b13eb0b7bfbe085ed924b5dca6240b6f0632b4256cfb53f31 AS uv
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
WORKDIR /app
COPY --chown=1000:1000 . .
RUN --mount=type=bind,from=uv,source=/uv,target=/usr/local/bin/uv --mount=type=secret,id=ca_bundle,mode=0444 \
    set -eu; \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    if [ -f /run/secrets/ca_bundle ]; then export SSL_CERT_FILE=/run/secrets/ca_bundle; printf '%s\n' 'Acquire::https::CaInfo "/run/secrets/ca_bundle";' >/etc/apt/apt.conf.d/99buildca; fi; \
    apt-get update; apt-get install -y --no-install-recommends 'zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1'; \
    rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99buildca; \
    uv sync --no-cache --frozen --no-dev; chown 1000:1000 /app
USER 1000:1000
ENV HOME=/tmp PATH="/app/.venv/bin:$PATH"
CMD ["uvicorn","monolith.main:app","--host","0.0.0.0","--port","8000"]
