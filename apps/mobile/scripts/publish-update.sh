#!/usr/bin/env bash
# Publish an OTA update to staging (preview branch).
# Usage: ./scripts/publish-update.sh "fix: poll vote button a11y label"
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-chore: latest}"
eas update --branch preview --message "$MSG"