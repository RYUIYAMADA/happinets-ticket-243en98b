#!/usr/bin/env bash
# GAS スクリプトプロパティ自動設定スクリプト
# Usage: bash scripts/setup-gas-env.sh [--script-id <ID>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.gas"

echo "=== family-tickets GAS セットアップ ==="
echo ""

# 1. ランダムトークン生成
WEBHOOK_SECRET=$(openssl rand -hex 24)
ADMIN_TOKEN=$(openssl rand -hex 32)

# 2. LINE 認証情報の入力案内
echo "LINE Developers Console を開きます..."
echo "→ チャネル → Messaging API → チャネルアクセストークン / チャネルシークレット を確認"
echo ""
open -a "Google Chrome" --args --profile-directory="Profile 1" "https://developers.line.biz/console/"
echo ""
read -r -p "LINE_CHANNEL_ACCESS_TOKEN を貼り付けてください: " LINE_TOKEN
read -r -p "LINE_CHANNEL_SECRET を貼り付けてください: " LINE_SECRET

# 3. GAS Script ID の確認
echo ""
echo "GAS スクリプト URL の /d/<SCRIPT_ID>/edit の部分を入力してください"
echo "例: 1BxABC...xyz"
read -r -p "Script ID: " SCRIPT_ID

# 4. .env.gas に保存（gitignore対象）
cat > "$ENV_FILE" <<EOF
LINE_CHANNEL_ACCESS_TOKEN=${LINE_TOKEN}
LINE_CHANNEL_SECRET=${LINE_SECRET}
LINE_WEBHOOK_SECRET=${WEBHOOK_SECRET}
ADMIN_API_TOKEN=${ADMIN_TOKEN}
GAS_SCRIPT_ID=${SCRIPT_ID}
EOF
echo ""
echo "✅ .env.gas に保存しました（git管理外）"

# 5. Apps Script API でプロパティを設定
echo ""
echo "GAS スクリプトプロパティを設定します..."

# gcloud が使えるか確認
if command -v gcloud &>/dev/null; then
  ACCESS_TOKEN=$(gcloud auth print-access-token 2>/dev/null || echo "")
  if [[ -n "$ACCESS_TOKEN" ]]; then
    echo "→ gcloud でOAuth認証します"
    RESPONSE=$(curl -s -X PUT \
      "https://script.googleapis.com/v1/scripts/${SCRIPT_ID}/properties" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{
        \"properties\": {
          \"LINE_CHANNEL_ACCESS_TOKEN\": \"${LINE_TOKEN}\",
          \"LINE_CHANNEL_SECRET\": \"${LINE_SECRET}\",
          \"LINE_WEBHOOK_SECRET\": \"${WEBHOOK_SECRET}\",
          \"ADMIN_API_TOKEN\": \"${ADMIN_TOKEN}\"
        }
      }")
    if echo "$RESPONSE" | grep -q '"scriptId"'; then
      echo "✅ GAS スクリプトプロパティの設定が完了しました！"
    else
      echo "⚠️  API 設定に失敗しました。下記の「手動設定」を使ってください。"
      echo "エラー: $RESPONSE"
    fi
  else
    echo "⚠️  gcloud の認証が切れています。手動設定に切り替えます。"
    FORCE_MANUAL=true
  fi
else
  FORCE_MANUAL=true
fi

if [[ "${FORCE_MANUAL:-false}" == "true" ]]; then
  echo ""
  echo "======================================"
  echo "📋 手動設定用 GAS コード（一度だけ実行）"
  echo "======================================"
  cat <<GASEOF

GAS エディタに以下を貼り付けて「実行」してください:

function setupProperties_RUNONCE() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('LINE_CHANNEL_ACCESS_TOKEN', '${LINE_TOKEN}');
  p.setProperty('LINE_CHANNEL_SECRET', '${LINE_SECRET}');
  p.setProperty('LINE_WEBHOOK_SECRET', '${WEBHOOK_SECRET}');
  p.setProperty('ADMIN_API_TOKEN', '${ADMIN_TOKEN}');
  Logger.log('✅ プロパティ設定完了');
}

GASEOF
  # GASコードをクリップボードにコピー
  cat <<CLIP | pbcopy
function setupProperties_RUNONCE() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('LINE_CHANNEL_ACCESS_TOKEN', '${LINE_TOKEN}');
  p.setProperty('LINE_CHANNEL_SECRET', '${LINE_SECRET}');
  p.setProperty('LINE_WEBHOOK_SECRET', '${WEBHOOK_SECRET}');
  p.setProperty('ADMIN_API_TOKEN', '${ADMIN_TOKEN}');
  Logger.log('✅ プロパティ設定完了');
}
CLIP
  echo "📋 上記コードをクリップボードにコピーしました"
fi

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "次のステップ:"
echo "1. GAS をウェブアプリとしてデプロイ（デプロイID を取得）"
echo "2. LINE Webhook URL を設定:"
echo "   https://script.google.com/macros/s/<デプロイID>/exec?secret=${WEBHOOK_SECRET}"
echo ""
echo "LINE Webhook URL を今すぐ生成しますか？デプロイIDを入力してください"
echo "（スキップ: Enter キーを押す）"
read -r -p "デプロイ ID: " DEPLOY_ID
if [[ -n "$DEPLOY_ID" ]]; then
  WEBHOOK_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec?secret=${WEBHOOK_SECRET}"
  echo ""
  echo "✅ LINE Webhook URL:"
  echo "   ${WEBHOOK_URL}"
  echo ""
  echo "${WEBHOOK_URL}" | pbcopy
  echo "📋 クリップボードにコピーしました"
  echo "LINE Developers Console > Messaging API > Webhook URL に貼り付けてください"
  open -a "Google Chrome" --args --profile-directory="Profile 1" "https://developers.line.biz/console/"
  # .env.gas に追記
  echo "WEBHOOK_URL=${WEBHOOK_URL}" >> "$ENV_FILE"
fi
