# SPEC-v1 — family-tickets 構造改修（D1 + Workers）

> status: skeleton（PM判断確定済み）→ 技術詳細肉付け中
> created: 2026-06-13 / 決定: 龍偉が案1（Cloudflare D1+Workers）を選択

## 1. 目的と非目標
- **目的**: スプレッドシート=DB の構造的脆弱性（型なし・行ズレ・ロック・GASエディタ依存）を解消し、管理DBを D1(SQLite) に、API/bot を Workers に統一する。
- **非目標**: デザイン刷新・新機能追加・他チケットカテゴリ追加。**機能は現行 v0.3.0 と同等**が完了条件。

## 2. アーキテクチャ決定（PM 確定・変更には方向転換ログ必須）
| 決定 | 内容 | 理由 |
|---|---|---|
| D-1 | DB = Cloudflare D1 / API+LINE bot = 単一 Worker（既存 family-tickets-line-proxy を拡張せず**新 Worker `family-tickets-api`** を新設、プロキシは退役） | 責務を1か所に。既存プロキシは bot 移行完了で不要化 |
| D-2 | FE 4画面は静的 HTML のまま（ホスティング現状維持）。API 呼び出し層のみ差し替え | スコープ最小化・DS準拠の画面を作り直さない |
| D-3 | 申込履歴のシート出力は**一方向エクスポート**（D1→Sheets。Sheets からの書き戻しなし）。Google Service Account + Sheets API を Worker cron で実行。**最終フェーズで構築**（龍偉指示） | スタッフ業務はシート閲覧のみ。双方向同期は複雑化の元 |
| D-4 | 切替方式 = 並行稼働 → 一括切替（FE の API URL と LINE webhook URL を同日に変更）。GAS は読み取り専用で2週間保持後に退役 | 規模が小さく段階切替の利益が薄い |
| D-5 | 移行データ = 選手・LINE紐づけ・26-27試合30件・既存申込（テスト申込は移行しない＝バックアップシートに残すのみ） | 龍偉指示「テスト回答は無効」 |

## 3. データモデル（ERD 方針・DDL は §9 で肉付け）
- `players`(id PK, player_no UNIQUE 正規化済み番号, name, name_en, line_user_id NULL, is_active, created_at)
- `games`(id PK, game_no 'G01'形式 UNIQUE, date, tipoff, opponent, day_of_week, deadline, season, is_active)
- `applications`(id PK, player_id FK, game_id FK, category CHECK('invite'|'family'|'paid'), quantity_adult/child/infant, receivers JSON, pickup_method, parking, note, status CHECK('confirmed'|'cancelled'), lang, source CHECK('web'|'line'), created_at, updated_at)
  - 現行の3シート（invite/family/paid）は **category 列で1テーブルに正規化**
- `sessions`(token PK, player_id FK, expires_at) — TTL は DB 側で管理（CacheService 相当）
- `admins`(id PK, pw_hash, api_token, created_at)
- `audit_log`(id PK, actor, action, target, detail JSON, created_at) — 管理操作と申込変更を全記録（現行に無い改善・小コストで追加）
- `export_state`(申込履歴シート出力の最終同期位置) — フェーズ5

## 4. 認証・認可（RBAC 包含マトリクス）
| ロール | 取得方法 | 可能操作 |
|---|---|---|
| player | 選手番号ログイン→ sessions トークン（HttpOnly 不可のため Bearer。TTL 6h） | 自分の申込 CRUD・試合閲覧 |
| admin | pw_hash 照合→ admin セッショントークン（TTL 12h） | player の全操作 + 選手/試合 CRUD・一括入替・統計・エクスポート即時実行 |
| line-webhook | X-Line-Signature HMAC 検証（実装流用） | bot イベント処理のみ |
- 包含: admin ⊃ player。トークンは URL クエリ禁止・Authorization ヘッダで送る（現行 GET クエリ方式からの改善）。

## 5. API 設計方針（契約詳細は docs/api-contract.md へ肉付け）
- REST 風 JSON。`/api/auth/login` `/api/games` `/api/applications` `/api/admin/*` `/line/webhook`
- エラー形式統一: `{ok:false, error:{code, message}}`。i18n は FE 側辞書（現行踏襲）
- CORS: FE ホスティングオリジンのみ許可

## 6. LINE bot 移行方針
- 現行 Code.gs の会話フロー（番号連携 / menu:apply / menu:check / 日英デフォルト返信）を Worker に移植。署名検証は worker.js 実装を流用
- 会話状態は D1（または KV）で管理。リッチメニューは現行のまま（URL 変更なし）

## 7. シート出力（フェーズ5・最終構築）
- 対象: applications の status 変更含む全履歴を**現行スプレッドシートの列構成踏襲**で出力
- 方式: Worker cron（5分間隔）で差分 append。Service Account の鍵は wrangler secret
- シートは閲覧専用運用（編集されても D1 へ影響しない）

## 8. テスト戦略
- Vitest + Miniflare（Workers ローカル）でユニット/統合。D1 はローカル SQLite で再現
- LINE webhook は署名付きリクエストのフィクスチャでモック
- 並行稼働: 同一操作の GAS/D1 結果突合スクリプト
- E2E: 実機チェックリスト（v0.2.0 のリストを v1 用に更新）

## 9. D1 DDL

正本ファイル: `cloudflare-worker/migrations/0001_init.sql`
実行コマンド: `wrangler d1 execute family-tickets-db --file=cloudflare-worker/migrations/0001_init.sql`

### テーブル一覧と GAS 対応
| テーブル | 行数見込み | GAS 対応 |
|---|---|---|
| `players` | ~35 | 選手・スタッフシート (col0/1/2) |
| `games` | ~30/season | 試合日程シート (col0〜4) |
| `applications` | ~500/season | 招待/家族席/有料 3シート → category 列で統一 |
| `sessions` | TTL管理 | `CacheService.put('SESS_{token}', playerId, 21600)` |
| `admin_sessions` | TTL管理 | `adminLogin` の返り値を永続化 |
| `admins` | 2行固定 | 設定シート admin_password_hash / manager_password_hash |
| `audit_log` | 無制限 | GAS 未実装・新規追加 |
| `line_conv_state` | TTL管理 | `CacheService.put('LINE_STATE_{uid}', json, 600)` |
| `export_state` | 1行 | フェーズ5用（シート出力位置管理） |

### 主要 DDL 抜粋

#### players
```sql
CREATE TABLE IF NOT EXISTS players (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_no    TEXT    NOT NULL,           -- 正規化番号 ("6"形式。GAS: String(parseInt(no)))
  name         TEXT    NOT NULL,
  name_en      TEXT    NOT NULL DEFAULT '',
  line_user_id TEXT    DEFAULT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_players_player_no ON players(player_no);
CREATE INDEX       IF NOT EXISTS idx_players_line_user_id ON players(line_user_id)
  WHERE line_user_id IS NOT NULL;
```

#### games
```sql
CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_no     TEXT    NOT NULL,           -- 'G01' 形式
  date        TEXT    NOT NULL,           -- 'YYYY-MM-DD'
  tipoff      TEXT    DEFAULT NULL,       -- 'HH:MM'（GAS未保持・将来用）
  opponent    TEXT    NOT NULL,
  day_of_week TEXT    NOT NULL,
  deadline    TEXT    DEFAULT NULL,       -- 'YYYY-MM-DD'
  season      TEXT    NOT NULL DEFAULT '2026-27',
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  CHECK(date GLOB '????-??-??'),
  CHECK(deadline IS NULL OR deadline GLOB '????-??-??'),
  CHECK(day_of_week IN ('月','火','水','木','金','土','日'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_games_game_no ON games(game_no);
```

#### applications（3シートを1テーブルに正規化）
```sql
CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id          TEXT    NOT NULL,       -- 'APP-{timestamp}' (既存ID互換)
  player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  game_id         INTEGER NOT NULL REFERENCES games(id)   ON DELETE RESTRICT,
  category        TEXT    NOT NULL CHECK(category IN ('invite','family','paid')),
  quantity_adult  INTEGER NOT NULL DEFAULT 1 CHECK(quantity_adult  BETWEEN 0 AND 10),
  quantity_child  INTEGER NOT NULL DEFAULT 0 CHECK(quantity_child  BETWEEN 0 AND 10),
  quantity_infant INTEGER NOT NULL DEFAULT 0 CHECK(quantity_infant BETWEEN 0 AND 10),
  seat_type       TEXT    NOT NULL DEFAULT '',
  seat_request    TEXT    NOT NULL DEFAULT '',
  receivers       TEXT    NOT NULL DEFAULT '[]',  -- JSON: [{name: string}]
  pickup_method   TEXT    NOT NULL DEFAULT '' CHECK(pickup_method   IN ('','pre','day')),
  payment_method  TEXT    NOT NULL DEFAULT '' CHECK(payment_method  IN ('','salary','cash','free')),
  parking         INTEGER NOT NULL DEFAULT 0 CHECK(parking BETWEEN 0 AND 10),
  note            TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','confirmed','rejected','cancelled')),
  lang            TEXT    NOT NULL DEFAULT 'ja' CHECK(lang   IN ('ja','en')),
  source          TEXT    NOT NULL DEFAULT 'web' CHECK(source IN ('web','line')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_app_id         ON applications(app_id);
CREATE INDEX       IF NOT EXISTS idx_applications_player_game     ON applications(player_id, game_id);
CREATE INDEX       IF NOT EXISTS idx_applications_game_id         ON applications(game_id);
CREATE INDEX       IF NOT EXISTS idx_applications_status          ON applications(status);
```

### GAS データ型対応表
| GAS シートの値 | D1 列 | 変換ルール |
|---|---|---|
| 選手番号 `"006"` (TEXT) | `players.player_no` | `String(parseInt(no))` → `"6"` で正規化 |
| 試合ID `"G01"` | `games.game_no` | そのまま |
| 日付 `Date オブジェクト` | `games.date` | `'YYYY-MM-DD'` 文字列に変換 |
| ステータス `"確保済み"` | `applications.status` | `STATUS_JP_TO_EN` マップで変換 → `"confirmed"` |
| 申込ID `"APP-1748770000000"` | `applications.app_id` | そのまま |
| 受取者氏名 `"赤穂 由美"` (col9) | `applications.receivers` | `JSON.stringify([{name: "赤穂 由美"}])` |
| 駐車場台数 `0` (col12) | `applications.parking` | INTEGER |

## 10. API 契約詳細

正本: `docs/api-contract.md`（本節はサマリ。実装時は正本を参照）

### エンドポイント一覧
| メソッド | パス | 認証 | 概要 |
|---|---|---|---|
| POST | `/api/auth/login` | なし | 選手ログイン → player token 発行 (TTL 6h) |
| POST | `/api/auth/admin-login` | なし | 管理者ログイン → admin token 発行 (TTL 12h) |
| GET  | `/api/games` | なし | 試合一覧 |
| GET  | `/api/applications` | player token | 自分の申込一覧 |
| POST | `/api/applications` | player token | 申込送信 |
| PUT  | `/api/applications/:app_id/cancel` | player token | 申込キャンセル |
| GET  | `/api/admin/applications` | admin token | 全申込取得 |
| PUT  | `/api/admin/applications/:app_id/status` | admin token (ticket) | ステータス更新 + LINE通知 |
| GET  | `/api/admin/players` | admin token | 選手一覧 |
| POST | `/api/admin/players` | admin token (ticket) | 選手追加 |
| PUT  | `/api/admin/players/:player_no` | admin token (ticket) | 選手更新 |
| PUT  | `/api/admin/games/:game_no/deadline` | admin token | 期限更新 |
| POST | `/api/admin/games` | admin token (ticket) | 試合追加 |
| PUT  | `/api/admin/games/:game_no` | admin token (ticket) | 試合更新 |
| DELETE | `/api/admin/games/:game_no` | admin token (ticket) | 試合削除（申込あり=409） |
| POST | `/api/admin/games/replace-season` | admin token (ticket) | シーズン一括入替 |
| GET  | `/api/admin/line-stats` | admin token | LINE クォータ確認 |
| POST | `/line/webhook` | X-Line-Signature | LINE bot Webhook |

### 認証方式（GAS からの変更点）
- GAS: GET クエリ `?sessionToken=&playerId=` / `?adminToken=` → Worker: `Authorization: Bearer <token>`
- GAS: POST body `pwHash` を毎回送信 → Worker: ログイン1回でトークン発行・以降はトークン

### エラーコード抜粋
| HTTP | code | 旧GAS 相当 |
|---|---|---|
| 401 | `UNAUTHORIZED` | `'unauthorized'` |
| 409 | `DUPLICATE` | `'既に申込済みです'` |
| 409 | `HAS_APPLICATIONS` | `'has_applications'` |
| 410 | `DEADLINE_PASSED` | `'申込期限を過ぎています'` |
| 422 | `INVALID_STATUS` | `'不正なステータス'` |

## 11. 移行手順詳細

### 11-1. 概要（D-4・D-5 準拠）
- 移行対象: 選手マスタ / LINE紐づけ / 26-27試合30件 / 既存申込（テスト申込除く）
- 非移行: テスト申込（APP-T* プレフィックス）はバックアップシートに残すのみ
- 方式: 並行稼働2週間 → 一括切替（FE の API URL + LINE Webhook URL を同日変更）

### 11-2. ステップ1: GAS シート → JSON エクスポート

GAS エディタで以下を実行し、スクリプトログからコピーする。

```javascript
// GAS エディタで実行するエクスポート関数
function exportForMigration() {
  const players = getPlayers();
  const games = getGames();
  const apps = getAllApplications().filter(a => !String(a.applicationId).startsWith('APP-T'));
  Logger.log(JSON.stringify({ players, games, applications: apps }, null, 2));
}
```

出力ファイル: `scripts/migration-data.json`（git commit しない・.gitignore に追記）

### 11-3. ステップ2: D1 データベース作成

```bash
# ローカル確認用（--local フラグ）
wrangler d1 create family-tickets-db

# wrangler.toml に database_id を追記
# [[d1_databases]]
# binding = "DB"
# database_name = "family-tickets-db"
# database_id = "<上記コマンドの出力>"

# スキーマ適用
wrangler d1 execute family-tickets-db \
  --file=cloudflare-worker/migrations/0001_init.sql
```

### 11-4. ステップ3: INSERT スクリプト実行

`scripts/migrate-to-d1.js`（Node.js）を用意して実行する。

```bash
node scripts/migrate-to-d1.js --input scripts/migration-data.json --env production
```

スクリプトの処理順（FK 制約のため順序厳守）:

1. **admins**: 設定シートのハッシュ値を INSERT
   ```sql
   INSERT INTO admins(role, pw_hash) VALUES('ticket', '<hash>');
   INSERT INTO admins(role, pw_hash) VALUES('manager', '<hash>');
   ```

2. **players**: `player_no = String(parseInt(no))` で正規化してから INSERT
   ```sql
   INSERT INTO players(player_no, name, name_en, line_user_id)
   VALUES('6', '#6 赤穂雷太', '', 'U...');
   ```

3. **games**: 日付は `'YYYY-MM-DD'` 文字列に変換
   ```sql
   INSERT INTO games(game_no, date, day_of_week, opponent, deadline, season)
   VALUES('G01', '2026-10-08', '木', '川崎ブレイブサンダース', '2026-10-01', '2026-27');
   ```

4. **applications**: `category` は ticketType そのまま。`receivers` は `[{name: row[9]}]` に変換
   ```sql
   INSERT INTO applications
     (app_id, player_id, game_id, category, quantity_adult, quantity_child, quantity_infant,
      seat_type, seat_request, receivers, pickup_method, payment_method, parking, note,
      status, lang, source, created_at, updated_at)
   VALUES(
     'APP-1748770000000',
     (SELECT id FROM players WHERE player_no = '6'),
     (SELECT id FROM games   WHERE game_no   = 'G01'),
     'family', 2, 1, 0, '', '', '[{"name":"赤穂 由美"}]',
     'pre', '', 1, '', 'confirmed', 'ja', 'web',
     '2026-10-01 09:00:00', '2026-10-01 09:00:00'
   );
   ```

### 11-5. ステップ4: 検証クエリ

```sql
-- 件数突合
SELECT 'players' AS tbl, COUNT(*) AS cnt FROM players
UNION ALL SELECT 'games',        COUNT(*) FROM games
UNION ALL SELECT 'applications', COUNT(*) FROM applications;

-- GAS 全申込数と一致するか確認（テスト申込除く）
SELECT category, COUNT(*) FROM applications GROUP BY category;

-- LINE 紐づき件数
SELECT COUNT(*) FROM players WHERE line_user_id IS NOT NULL;

-- 期限切れ試合なし確認
SELECT game_no, date, deadline FROM games ORDER BY date;

-- 重複申込なし確認（同一 player × game × category で status != 'cancelled'）
SELECT player_id, game_id, category, COUNT(*)
FROM applications
WHERE status != 'cancelled'
GROUP BY player_id, game_id, category
HAVING COUNT(*) > 1;
```

期待結果: 重複クエリが 0行 = 正常。

### 11-6. 並行稼働チェックリスト

並行稼働期間中（切替前2週間）に以下を確認する。

| 確認項目 | 方法 | 合格基準 |
|---|---|---|
| 選手ログイン | Worker API `POST /api/auth/login` を実行 | GAS と同じ player_no が返る |
| 試合一覧 | Worker API `GET /api/games` | GAS `getGames` と件数・game_no 一致 |
| 申込送信 | Worker と GAS 両方に同一リクエストを送信 | app_id が両方に記録される |
| ステータス更新 | Worker で更新後、LINE push が届くか | 対象選手に通知が届く |
| LINE bot 登録フロー | LINE から背番号送信 | D1 `players.line_user_id` が更新される |
| LINE bot 申込フロー | LINE からチケット申込 | D1 `applications` に `source='line'` で記録 |

### 11-7. 本番切替チェックリスト（D-4：一括切替）

以下を同日・順番通りに実施する。

```
□ 1. GAS スプレッドシートを「表示のみ」に権限変更（編集ロック）
□ 2. FE 4画面の API エンドポイント URL を GAS URL → Worker URL に変更してデプロイ
     - index.html, player-form.html, player-dashboard.html, admin.html の
       GAS_URL 定数 or callGAS 関数の URL を差し替え
□ 3. LINE Developers → Messaging API → Webhook URL を Worker の /line/webhook に変更
     （送信確認ボタンで 200 が返ることを確認）
□ 4. worker.js から GAS 転送ロジックを削除（LINE bot が Worker 内で完結するため）
□ 5. 動作確認:
     □ 選手が Web からログイン・申込できる
     □ 管理者が admin.html でステータス更新できる
     □ LINE bot で背番号送信 → 登録完了メッセージが届く
     □ LINE bot でチケット申込 → D1 に記録される
□ 6. 異常なし確認後、GAS を「読み取り専用デプロイ」として2週間保持
□ 7. 2週間後: GAS プロジェクトをアーカイブ（削除しない）
```

### 11-8. ロールバック手順

切替後に重大障害が発生した場合:

```
□ FE の API URL を GAS URL に戻す（デプロイ）
□ LINE Webhook URL を GAS URL に戻す
□ Worker の障害を調査・修正
```

GAS は切替後2週間「読み取り専用」で稼働継続するため、ロールバックは即時可能。

## 12. PM 裁定ログ（2026-06-13・肉付け時の確認事項への回答）
| # | 論点 | 裁定 |
|---|---|---|
| R-1 | player_no 正規化 | 内部は `"6"` 正規化を正とする。FE 表示のみ `padStart(3,'0')` で `"006"` 復元。api-contract の FE 実装注意に記載済みを承認 |
| R-2 | admins.pw_hash 初期値 | プレースホルダー禁止（管理者がログイン不能になる）。**現行ハッシュをそのまま移行**し、本番切替チェックリストに「切替当日にパスワード変更」を必須項目として追加 |
| R-3 | tipoff（試合開始時刻） | **移行対象に含める**。schedule-2026-27 の xlsx に 19:00/14:00 の時刻があるため games.tipoff に投入する |
| D-6 | adminSetup?task=*（GET セットアップ群） | **廃止を正式決定**。リッチメニュー登録・トリガー設定は wrangler / LINE API 直呼び出しで代替（本セッションで実績あり） |
| D-7 | 朝通知 sendMorningNotifications | **移行スコープに含める**（受入条件「機能同等」の一部）。Cloudflare Cron Triggers（毎朝10:00 JST = cron "0 1 * * *" UTC）で実装。§6 の bot 移行に追加 |
| D-8 | FE の initData 呼び出し残存 | FE 切替タスクの完了条件に「initData 呼び出しの除去確認」を追加 |
