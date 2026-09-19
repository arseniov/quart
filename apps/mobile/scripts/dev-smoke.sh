#!/usr/bin/env bash
# apps/mobile/scripts/dev-smoke.sh
# Local dev-loop smoke test. Spawns Metro, waits for "Bundling complete",
# then tears it down. Intended as a fast "did I break the bundler?" check,
# not a full app launch — load the dev client and tap around manually to
# verify the screen actually mounts.
#
# ponytail: Metro is interactive and won't exit on its own; the background
# spawn is wrapped with `|| true` so `set -e` doesn't kill the cleanup
# loop when Metro keeps running past the bundle window.
set -euo pipefail

PORT="${PORT:-8081}"
LOG="$(mktemp -t quart-mobile-smoke.XXXXXX.log)"
PID=""

cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

echo "[dev-smoke] starting Metro on port $PORT, log: $LOG"
pnpm exec expo start --dev-client --port "$PORT" > "$LOG" 2>&1 &
PID=$!

for _ in $(seq 1 60); do
  if grep -q "Bundling complete" "$LOG" 2>/dev/null; then
    echo "[dev-smoke] bundle compiled"
    exit 0
  fi
  if grep -qi "error" "$LOG" 2>/dev/null && ! grep -q "Bundling complete" "$LOG"; then
    echo "[dev-smoke] Metro reported an error:"
    cat "$LOG"
    exit 1
  fi
  sleep 1
done

echo "[dev-smoke] timed out waiting for bundle. Metro log:"
cat "$LOG"
exit 1