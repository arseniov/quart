# Quart

Community-driven civic engagement platform. Citizens propose ideas, vote on polls, and
flag local issues. Read `docs/superpowers/specs/2026-09-06-quart-master-design.md`
for the full design.

## Quickstart (dev)

Prereqs: Node 22 LTS, pnpm 9, Docker 24+, psql client.

```bash
pnpm install
docker compose -f infrastructure/docker-compose.yml up -d
cp infrastructure/.env.example infrastructure/.env
pnpm --filter @quart/db test
pnpm --filter @quart/migrate build
DATABASE_URL=postgres://quart:quart@127.0.0.1:6432/quart \
  pnpm --filter @quart/migrate start
```

Smoke test:

```bash
./infrastructure/scripts/smoke.sh
```

## Layout

```
apps/migrate/          # Kysely migration runner
packages/db/           # Kysely client, canonical JSON, audit helpers, PII helpers
packages/shared-types/ # Zod schemas + branded types
packages/shared-contracts/ # OpenAPI generated bundle (placeholder)
packages/config/       # Shared tsconfig + prettier + eslint
infrastructure/        # docker-compose, Caddyfile, Postgres init, backup scripts
docs/superpowers/      # Specs and implementation plans (not in git)
```

## Status

POC. See `docs/runbooks/deploy.md` for production deploy.
