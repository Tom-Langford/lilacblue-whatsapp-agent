#!/usr/bin/env bash
# Run QR scan with production env. Use source (not env xargs) for safe secret loading.
# Run from repo root. Requires /etc/clawdbot/env to exist.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-/etc/clawdbot/env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Create it with HOTBAGS_*, QUEUE_DB_PATH, DATA_DIR, GATEWAY_INSTANCE_ID"
  exit 1
fi

cd "$REPO_ROOT"
set -a
source "$ENV_FILE"
set +a
npm run dev
