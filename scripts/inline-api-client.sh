#!/usr/bin/env bash
# api-client.js を各 HTML にインライン化して本番 Worker URL を設定する
# Usage: bash scripts/inline-api-client.sh

set -euo pipefail

WORKER_URL="https://family-tickets-api.row2014-2015-k.workers.dev"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_CLIENT="$SCRIPT_DIR/api-client.js"

if [[ ! -f "$API_CLIENT" ]]; then
  echo "api-client.js not found at $API_CLIENT" >&2
  exit 1
fi

API_CONTENT=$(cat "$API_CLIENT")

INLINE_BLOCK="<script>
window.WORKER_API_BASE_URL = \"${WORKER_URL}\";
</script>
<script>
${API_CONTENT}
</script>"

FILES=(
  "$SCRIPT_DIR/index.html"
  "$SCRIPT_DIR/player-form.html"
  "$SCRIPT_DIR/player-dashboard.html"
  "$SCRIPT_DIR/admin.html"
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "skip: $f not found"
    continue
  fi
  # すでにインライン化済みかチェック
  if grep -q "WORKER_API_BASE_URL" "$f"; then
    echo "already inlined: $f — updating URL only"
    # URLだけ更新
    sed -i '' "s|window.WORKER_API_BASE_URL = \".*\"|window.WORKER_API_BASE_URL = \"${WORKER_URL}\"|g" "$f"
    echo "  done: $f"
    continue
  fi
  # <script src="./api-client.js"></script> をインラインブロックに置換
  python3 -c "
import sys
content = open('$f', 'r', encoding='utf-8').read()
old = '<script src=\"./api-client.js\"></script>'
new = '''$INLINE_BLOCK'''
if old not in content:
    print('WARNING: script tag not found in $f', file=sys.stderr)
    sys.exit(0)
content = content.replace(old, new, 1)
open('$f', 'w', encoding='utf-8').write(content)
print('inlined: $f')
"
done

echo "Done."
