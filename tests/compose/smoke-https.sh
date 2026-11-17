#!/usr/bin/env bash
# HTTPS profile smoke test: the default stack is unaffected, the profile refuses to
# start without ALICE_DOMAIN, Caddy accepts the bundled config, and Alice works end to end through it.
# Caddy uses its internal CA for "localhost", so no public DNS or Let's Encrypt is needed here.
set -euo pipefail
cd "$(dirname "$0")/../.."
export COMPOSE_PROJECT_NAME=alice-smoke-https
export ALICE_HTTP_PORT=${ALICE_HTTP_PORT:-18082}
export ALICE_HTTPS_PORT=${ALICE_HTTPS_PORT:-18443}
export ALICE_HTTPS_REDIRECT_PORT=${ALICE_HTTPS_REDIRECT_PORT:-18880}
export ALICE_PUBLIC_URL=https://localhost:${ALICE_HTTPS_PORT}
export ALICE_TRUST_PROXY=true
export ALICE_BOOTSTRAP_TOKEN=smoke-https-bootstrap-token-0123456789
URL=$ALICE_PUBLIC_URL
WORK=$(mktemp -d)
cleanup() { docker compose --profile https down -v >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# 1. the profile is opt-in: the default service list has no proxy
[ "$(docker compose config --services)" = "alice" ] || { echo "default stack changed" >&2; exit 1; }
echo "default stack unchanged: ok"

# 2. without ALICE_DOMAIN the proxy refuses to start, with a message that says what to set
if out=$(ALICE_DOMAIN= docker compose --profile https run --rm --no-deps -T caddy 2>&1); then
  echo "caddy started without ALICE_DOMAIN" >&2; exit 1
fi
grep -q 'set ALICE_DOMAIN' <<<"$out" || { echo "unclear error: $out" >&2; exit 1; }
echo "missing ALICE_DOMAIN refused: ok"

# 3. Caddy accepts the bundled configuration
export ALICE_DOMAIN=localhost
docker compose --profile https run --rm --no-deps -T --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
echo "caddy validate: ok"

# 4. end to end through the proxy
docker compose --profile https up -d --build
for _ in $(seq 1 60); do
  docker compose exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt 2>/dev/null && break
  sleep 1
done
docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$WORK/root.crt"
export NODE_EXTRA_CA_CERTS="$WORK/root.crt"
for _ in $(seq 1 60); do
  if curl -fsS --cacert "$WORK/root.crt" "$URL/readyz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --cacert "$WORK/root.crt" "$URL/readyz"; echo
curl -fsS --cacert "$WORK/root.crt" "$URL/" | grep -q '<title>Alice</title>'
npx tsx tests/compose/operator-journey.ts "$URL" "$ALICE_BOOTSTRAP_TOKEN"
npx tsx tests/compose/https-probe.ts "$URL"
echo "https profile: ok"
