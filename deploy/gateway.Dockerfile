ARG GATEWAY_BINARY_STAGE=compiled
FROM golang:1.27.4-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS compiled
WORKDIR /src
COPY deploy/gateway-build/go.mod deploy/gateway-build/go.sum ./
RUN go mod download && go mod verify
COPY deploy/gateway-build/main.go .
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/caddy .
FROM scratch AS precompiled
COPY deploy/gateway-build/caddy /out/caddy
FROM ${GATEWAY_BINARY_STAGE} AS gateway-binary
FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY --from=gateway-binary /out/caddy /usr/bin/caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY dist/ /srv/
# The production entry document selects server persistence before any application JS runs.
RUN test -f /srv/index.html && grep -q 'data-runtime="showcase"' /srv/index.html && find /srv -type f -name '*.html' -exec sed -i 's/data-runtime="showcase"/data-runtime="production"/g' {} \;
