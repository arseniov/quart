#!/usr/bin/env bash
# Pre-flight checks before triggering EAS Build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ node version"
node --version

echo "→ pnpm lockfile present"
test -f pnpm-lock.yaml

echo "→ required env vars (CI overrides)"
: "${EXPO_PUBLIC_API_URL:?EXPO_PUBLIC_API_URL must be set}"
: "${EXPO_PUBLIC_SENTRY_DSN:?EXPO_PUBLIC_SENTRY_DSN must be set}"

# ponytail: app.config.ts is a TS file — typecheck covers it; no need to require() it here
echo "→ typecheck"
pnpm --filter @quart/mobile typecheck

echo "→ test"
pnpm --filter @quart/mobile test

echo "✓ build pre-flight ok"