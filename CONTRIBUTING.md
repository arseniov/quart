# Contributing

- All commits use [Conventional Commits](https://www.conventionalcommits.org).
- Every PR must pass `pnpm turbo run lint typecheck test`.
- Database changes go in `infrastructure/postgres/migrations/####_<name>.up.sql` + matching `.down.sql`.
- Tests required for any logic that crosses a trust boundary (auth, authz, audit, RLS).
- Never commit secrets. `.env*` is gitignored; secret files live in `infrastructure/secrets/`.