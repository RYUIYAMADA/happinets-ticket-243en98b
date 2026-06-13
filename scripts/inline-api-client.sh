#!/usr/bin/env bash
# api-config.js の Worker URL を更新する
# Usage: bash scripts/inline-api-client.sh https://<worker>.workers.dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/api-config.js"
WORKER_URL="${1:-}"

if [[ -z "$WORKER_URL" ]]; then
  echo "Usage: bash scripts/inline-api-client.sh https://<worker>.workers.dev" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "api-config.js not found at $CONFIG_FILE" >&2
  exit 1
fi

sed -i '' "s|window.WORKER_API_BASE_URL = \".*\"|window.WORKER_API_BASE_URL = \"${WORKER_URL}\"|g" "$CONFIG_FILE"
echo "updated: $CONFIG_FILE"
