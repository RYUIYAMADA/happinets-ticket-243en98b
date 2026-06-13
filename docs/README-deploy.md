# family-tickets v1.0 テスト版 本番切替手順

前提:
- 現利用者 0 名。守るべき本番データなし
- 並行稼働不要。現行 GAS は切替後に止めてよい
- 実デプロイ、`wrangler login`、LINE 管理画面操作は龍偉が実施
- 本書は 2026-06-13 時点のリポジトリ実態を正本として作成

## 現行構成の判明点
- `cloudflare-worker/wrangler.toml` の現行 LINE プロキシ Worker 名は `family-tickets-line-proxy`
- 現行 LINE プロキシ Worker は `cloudflare-worker/worker.js` で `LINE_CHANNEL_SECRET` `GAS_URL` `WEBHOOK_SECRET` を要求し、署名検証後に GAS へ転送するだけ
- 旧 Webhook URL の手がかりは [scripts/setup-gas-env.sh](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/scripts/setup-gas-env.sh:146) にあり、`https://family-tickets-line-proxy.row2014-2015-k.workers.dev`
- 新 API Worker 名は `family-tickets-api`
- 新 API Worker の本番 URL 形式は `https://family-tickets-api.<Cloudflare account>.workers.dev`。リポジトリ内の既存記録では `https://family-tickets-api.row2014-2015-k.workers.dev`
- Cloudflare アカウント名/ID の手がかりは [docs/progress/d1-migration.md](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/docs/progress/d1-migration.md:100) にあり、`row2014.2015.k / acct 4dcd341c...`
- 旧フロントの公開痕跡は [family-tickets-v0.1.0-handover.md](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/family-tickets-v0.1.0-handover.md:15) の GitHub Pages
- ただし現行 LINE リッチメニューと LIFF/通常導線の痕跡は [gas/Code.gs](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/gas/Code.gs:1278) と [docs/progress/liff-migration.md](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/docs/progress/liff-migration.md:537) にあり、`app-five-pi-50.vercel.app` と html-share(vercel.app) 運用が混在
- よって FE ホスティング先は GitHub Pages から Vercel/html-share 系へ移行途中の記録が混在しており、**現行本番の正ホストは要確認**

## 前提仮定
- 確実: 新 API Worker は `cloudflare-worker-api/` 配下を `wrangler deploy` する構成
- 確実: D1 名は `family-tickets-db`
- 確実: `migrations/0001_init.sql` が初期スキーマ
- 確実: API が読む env/secrets は `ALLOWED_ORIGIN` `DB` `LINE_CHANNEL_SECRET` `LINE_CHANNEL_ACCESS_TOKEN` `ADMIN_SALT` `LINE_LOGIN_CHANNEL_ID`
- 推測: Cloudflare 所有アカウントは `row2014.2015.k`
- 不明: 現在 LINE リッチメニューから実際に開いている FE URL の最終確定値
- 不明: LIFF 用 Channel ID を今回使うか、通常 Web 導線だけで切るか

## 手順
1. 龍偉: `wrangler login`
   - 実行:
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api
   wrangler login
   ```
   - ブラウザで Allow
   - ログイン後にアカウント確認:
   ```bash
   wrangler whoami
   wrangler d1 list
   ```
   - `wrangler whoami` の account と、既存記録 `row2014.2015.k / acct 4dcd341c...` が一致するか確認
   - 一致しなければ別アカウントに入っているので作業停止

2. 龍偉: D1 作成
   - 実行:
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api
   wrangler d1 create family-tickets-db --location=apac
   ```
   - 出力された `database_id` を [cloudflare-worker-api/wrangler.toml](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api/wrangler.toml:10) の `YOUR_D1_DATABASE_ID` に貼る

3. 龍偉: スキーマ適用
   - 実行:
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api
   wrangler d1 execute family-tickets-db --remote --file=migrations/0001_init.sql
   ```

4. Claude/Codex 準備 → 龍偉 実行: マスタ投入
   - 参照: [scripts/README-migration.md](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/scripts/README-migration.md:1)
   - GAS 側で `exportMigrationData()` を実行し、JSON を `scripts/migration-data.json` として保存
   - 今回は利用者ゼロ前提のため、申込データ移行は実質不要。最低限で `players` `games` `line links` を入れる
   - 実行:
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets
   node scripts/migrate-to-d1.js --input scripts/migration-data.json --env production
   ```
   - 出力された `wrangler d1 execute ... --remote --file=...` を実行
   - その後の確認:
   ```bash
   cd cloudflare-worker-api
   wrangler d1 execute family-tickets-db --remote --file=../scripts/verify-migration.sql
   ```

5. Claude/Codex 生成 → 龍偉 実行: `admins.pw_hash` を直接投入
   - API は `env.ADMIN_SALT` を使って PBKDF2-SHA256 / 100000 iterations / 32byte を期待する
   - 生成例:
   ```bash
   node -e 'const crypto=require("crypto"); const password=process.argv[1]; const salt=process.argv[2]; console.log(crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex"));' '平文パスワード' 'ADMIN_SALTの値'
   ```
   - 例: `ticket` と `manager` を同一パスワードにする場合
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api
   wrangler d1 execute family-tickets-db --remote --command "INSERT INTO admins (role, pw_hash, failed_count, locked_until) VALUES ('ticket', '<pbkdf2-hex>', 0, NULL) ON CONFLICT(role) DO UPDATE SET pw_hash=excluded.pw_hash, failed_count=0, locked_until=NULL;"
   wrangler d1 execute family-tickets-db --remote --command "INSERT INTO admins (role, pw_hash, failed_count, locked_until) VALUES ('manager', '<pbkdf2-hex>', 0, NULL) ON CONFLICT(role) DO UPDATE SET pw_hash=excluded.pw_hash, failed_count=0, locked_until=NULL;"
   ```

6. 龍偉: Worker secret 設定
   - 実際にコードが読む secret 一覧:
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `ADMIN_SALT`
   - `LINE_LOGIN_CHANNEL_ID`
   - 実行:
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api
   wrangler secret put LINE_CHANNEL_SECRET
   wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   wrangler secret put ADMIN_SALT
   wrangler secret put LINE_LOGIN_CHANNEL_ID
   ```
   - `GOOGLE_SERVICE_ACCOUNT_KEY` は現スコープ外。シート自動出力を後で有効化する時に追加
   - `ALLOWED_ORIGIN` は secret ではなく [cloudflare-worker-api/wrangler.toml](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api/wrangler.toml:23) の `[vars]`

7. 龍偉: Worker デプロイ
   - 実行:
   ```bash
   cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api
   wrangler deploy
   ```
   - 出力された本番 Worker URL を控える
   - 期待エンドポイント:
   - `<Worker URL>/api/auth/login`
   - `<Worker URL>/line/webhook`

8. Claude/Codex 準備 → 龍偉 反映: FE の API ベース URL 設定
   - FE は [api-config.js](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/api-config.js:1) の `window.WORKER_API_BASE_URL` を一箇所だけ見ればよい状態に変更済み
   - 本番反映前に `api-config.js` を本番 Worker URL に更新する:
   ```js
   window.WORKER_API_BASE_URL = "https://<deployed-worker>.workers.dev";
   ```
   - API クライアント本体の切替ロジックは [api-client.js](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/api-client.js:8) にあり、`window.WORKER_API_BASE_URL` → `window.location.origin` → ローカル の順で解決する
   - FE ホスティング先:
   - Vercel/html-share を継続するなら、そのデプロイ物に `index.html` `player-form.html` `player-dashboard.html` `admin.html` `api-config.js` を同時反映する
   - GitHub Pages に戻すなら、同ファイル群を GitHub Pages の公開ブランチへ反映する
   - **要確認**: 現在 LINE リッチメニューが指している URL が `app-five-pi-50.vercel.app` か html-share の `/p/hnts-*` か

9. 龍偉: LINE Developers で Webhook URL 切替
   - 設定先: Messaging API
   - 新 URL:
   ```text
   https://<deployed-worker>.workers.dev/line/webhook
   ```
   - `LINE_CHANNEL_SECRET` はこのチャネルの値と一致している必要がある
   - 検証で 200 が返ることを確認

10. 龍偉: LINE Official Account Manager でリッチメニュー URL 切替
   - 予約ボタン URL を新 FE へ変更
   - 既存コード上の候補 URL 痕跡:
   - `https://app-five-pi-50.vercel.app/p/hnts-player-form`
   - `https://app-five-pi-50.vercel.app/p/hnts-player-dashboard`
   - ただし実運用 URL は要確認。切替後はフォームとダッシュボードの両導線を確認

11. 龍偉: 動作確認チェックリスト
   - LINE の予約ボタンから FE が開く
   - 選手ログインできる
   - 試合一覧が表示される
   - 申込送信できる
   - 管理画面ログインできる
   - 管理画面で status 更新できる
   - status 更新後に LINE 通知が届く
   - `wrangler d1 execute family-tickets-db --remote --command "SELECT COUNT(*) FROM applications;"` で申込が入っている

## 補足
- 旧 LINE プロキシ `family-tickets-line-proxy` は `GAS_URL` 転送専用。新 Worker 切替後は不要
- `cloudflare-worker-api/wrangler.toml` の cron は `0 1 * * *`。毎朝 10:00 JST の通知ジョブ
- CORS は `ALLOWED_ORIGIN` 固定。FE URL を変える場合は先に [cloudflare-worker-api/wrangler.toml](/Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets/cloudflare-worker-api/wrangler.toml:23) を更新してから `wrangler deploy`

## インフラ台帳
| 項目 | 値 | 確定状況 | メモ |
|---|---|---|---|
| Cloudflare account name |  | 要記入 | 既存記録候補: `row2014.2015.k` |
| Cloudflare account ID |  | 要記入 | 既存記録候補: `4dcd341c...` |
| 旧 Worker 名 | `family-tickets-line-proxy` | 確定 | GAS 転送専用 |
| 旧 Worker URL |  | 要確認 | 候補: `https://family-tickets-line-proxy.row2014-2015-k.workers.dev` |
| 新 Worker 名 | `family-tickets-api` | 確定 | API + LINE bot |
| 新 Worker URL |  | 要記入 | `wrangler deploy` 出力を転記 |
| D1 名 | `family-tickets-db` | 確定 | APAC で作成 |
| D1 database_id |  | 要記入 | `wrangler d1 create` 出力 |
| FE ホスティング先 |  | 要確認 | GitHub Pages / Vercel / html-share のどれが正本か確定させる |
| FE 本番 URL |  | 要記入 | index / form / dashboard / admin |
| LINE Developers channel |  | 要記入 | Messaging API チャネル名/ID |
| LINE Login channel ID |  | 要記入 | `LINE_LOGIN_CHANNEL_ID` 用 |
| LINE Official Account |  | 要記入 | OA Manager 管理対象 |
| リッチメニュー URL |  | 要記入 | 予約ボタンの最終 URL |
