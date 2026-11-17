#!/usr/bin/env bash
# Production Compose smoke test: builds the image, starts it, checks the web shell and
# readiness, writes data, restarts the container and verifies the data survived.
set -euo pipefail
cd "$(dirname "$0")/../.."
export COMPOSE_PROJECT_NAME=alice-smoke
export ALICE_HTTP_PORT=${ALICE_HTTP_PORT:-18081}
export ALICE_PUBLIC_URL=http://localhost:${ALICE_HTTP_PORT}
URL=http://127.0.0.1:${ALICE_HTTP_PORT}
cleanup() { docker compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

wait_ready() {
  for _ in $(seq 1 60); do
    if curl -fsS "$URL/readyz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Alice did not become ready" >&2; docker compose logs >&2; return 1
}

docker compose up -d --build
wait_ready
curl -fsS "$URL/" | grep -q '<title>Alice</title>'
echo "web shell: ok"

# README first-time setup: bootstrap token from the private file in the volume
BOOT=$(docker compose exec -T alice cat /data/bootstrap-token)
npx tsx tests/compose/operator-journey.ts "$URL" "$BOOT"

PROBE=$(docker compose exec -T alice node -e "const D=require('better-sqlite3');const d=new D('/data/alice.db');d.prepare(\"INSERT OR REPLACE INTO installation (key,value) VALUES ('smoke_probe','persisted')\").run();console.log('written')")
echo "probe: $PROBE"

docker compose restart alice
wait_ready
docker compose exec -T alice node -e "const D=require('better-sqlite3');const d=new D('/data/alice.db',{readonly:true});const r=d.prepare(\"SELECT value FROM installation WHERE key='smoke_probe'\").get();if(!r)process.exit(1);console.log('persisted:',r.value)"
docker compose down
docker compose up -d
wait_ready
docker compose exec -T alice node -e "const D=require('better-sqlite3');const d=new D('/data/alice.db',{readonly:true});process.exit(d.prepare(\"SELECT value FROM installation WHERE key='smoke_probe'\").get()?0:1)"
echo "volume persisted across container recreate: ok"

# backup inside the running container, then restore into the stopped service
docker compose exec -T alice alice-server backup --out /data/backups/smoke
docker compose stop alice
docker compose run --rm -T alice alice-server restore --from /data/backups/smoke --replace-existing
docker compose start alice
wait_ready
docker compose exec -T alice node -e "const D=require('better-sqlite3');const d=new D('/data/alice.db',{readonly:true});process.exit(d.prepare(\"SELECT value FROM installation WHERE key='smoke_probe'\").get()?0:1)"
echo "backup/restore inside container: ok"
