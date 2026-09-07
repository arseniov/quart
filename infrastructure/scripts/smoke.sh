#!/usr/bin/env bash
set -euo pipefail

# E2E smoke: bring up services, run migrations, query data, assert state.
# Usage: ./infrastructure/scripts/smoke.sh
#
# Requires: docker 24+, pnpm 9, psql client. Not runnable in docker-less
# sandboxes — author this then invoke locally with the command above.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

cleanup() { docker compose -f infrastructure/docker-compose.yml down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ docker compose up"
docker compose -f infrastructure/docker-compose.yml up -d postgres pgbouncer

echo "→ waiting for postgres healthy"
for i in {1..30}; do
  status=$(docker compose -f infrastructure/docker-compose.yml ps postgres --format json | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [[ "$status" == "healthy" ]]; then break; fi
  sleep 2
done

echo "→ running migrations"
DATABASE_URL="postgres://quart:quart@127.0.0.1:6432/quart" \
  pnpm --filter @quart/migrate start

echo "→ asserting cities seeded"
count=$(docker compose -f infrastructure/docker-compose.yml exec -T postgres \
  psql -U quart -d quart -tAc "SELECT count(*) FROM cities;")
[[ "$count" == "2" ]] || { echo "expected 2 cities, got $count"; exit 1; }

echo "→ asserting RLS role exists"
docker compose -f infrastructure/docker-compose.yml exec -T postgres \
  psql -U quart -d quart -tAc "SELECT 1 FROM pg_roles WHERE rolname='quart_app'" | grep -q 1

echo "→ asserting audit chain helpers exist"
docker compose -f infrastructure/docker-compose.yml exec -T postgres \
  psql -U quart -d quart -tAc "SELECT 1 FROM pg_proc WHERE proname='compute_audit_row_hash'" | grep -q 1

echo "✓ smoke ok"
