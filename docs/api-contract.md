# API 契約書 — family-tickets Worker API v1.0

> **正本**。FE/BE/bot の並列実装はここを参照すること。
> created: 2026-06-13 / status: 設計確定（§2 D-1〜D-5 準拠）

---

## 0. 共通仕様

### Base URL
```
https://<worker-name>.<account>.workers.dev
```
※ wrangler.toml の name と CF アカウントに依存。SPEC-v1.md §2 D-1 で確定後に埋める。

### リクエスト形式
- Content-Type: `application/json`
- 文字コード: UTF-8

### 認証ヘッダー（トークンが必要なエンドポイント）
```
Authorization: Bearer <token>
```
URL クエリへのトークン埋め込み禁止（現行 GAS 方式からの改善）。

### 成功レスポンス形式
```json
{ "ok": true, "data": { ... } }
```

### エラーレスポンス形式
```json
{ "ok": false, "error": { "code": "ERR_CODE", "message": "human readable" } }
```

### エラーコード一覧
| HTTP | code | 意味 | GAS 相当 |
|---|---|---|---|
| 400 | `BAD_REQUEST` | 必須パラメータ欠損・型不正 | `throw new Error('...')` |
| 401 | `UNAUTHORIZED` | トークンなし・期限切れ | `throw new Error('unauthorized')` |
| 403 | `FORBIDDEN` | ロール不足（player が admin 操作） | — |
| 404 | `NOT_FOUND` | 試合/申込/選手が存在しない | `'試合が見つかりません'` 等 |
| 409 | `DUPLICATE` | 重複申込 | `'既に申込済みです'` |
| 409 | `HAS_APPLICATIONS` | 申込あり試合の削除拒否 | `'has_applications'` |
| 410 | `DEADLINE_PASSED` | 申込期限超過 | `'申込期限を過ぎています'` |
| 422 | `INVALID_STATUS` | 不正ステータス値 | `'不正なステータス'` |
| 429 | `RATE_LIMITED` | レートリミット超過 | — |
| 500 | `INTERNAL_ERROR` | サーバーエラー | — |

### CORS
```
Access-Control-Allow-Origin: <FE ホスティングオリジン>
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## 1. GAS action → 新 API 対照表

### GET endpoints
| GAS action | 新 API | 変更点 |
|---|---|---|
| `getGames` | `GET /api/games` | クエリ変更なし。`isDeadlinePassed` 算出は Worker 側 |
| `getApplications` (+ playerId + sessionToken) | `GET /api/applications?playerId=<player_no>` | Bearer token で認証。URL クエリにトークン不要 |
| `getAllApplications` (+ adminToken) | `GET /api/admin/applications` | admin Bearer token で認証。adminToken クエリ廃止 |
| `getPlayers` (+ adminToken) | `GET /api/admin/players` | admin Bearer token で認証 |
| `getLineStats` (+ adminToken) | `GET /api/admin/line-stats` | admin Bearer token で認証 |
| `adminSetup?task=*` | `POST /api/admin/setup` | 初期構築専用。セットアップ完了後は無効化 |

### POST endpoints
| GAS action | 新 API | 変更点 |
|---|---|---|
| `login` | `POST /api/auth/login` | body 変更なし |
| `adminLogin` | `POST /api/auth/admin-login` | passwordHash → Bearer token 発行 |
| `submitApplication` | `POST /api/applications` | Bearer token。sessionToken + playerId 廃止 |
| `cancelApplication` | `PUT /api/applications/:app_id/cancel` | Bearer token |
| `updateStatus` | `PUT /api/admin/applications/:app_id/status` | admin Bearer token。pwHash 廃止 |
| `updateDeadline` | `PUT /api/admin/games/:game_no/deadline` | admin Bearer token |
| `initData` | `POST /api/admin/init-data` | admin Bearer token 必須（旧GAS: 認証なし→改善） |
| `replaceSeason2627` | `POST /api/admin/games/replace-season` | admin Bearer token |
| `addGame` | `POST /api/admin/games` | admin Bearer token |
| `updateGame` | `PUT /api/admin/games/:game_no` | admin Bearer token |
| `deleteGame` | `DELETE /api/admin/games/:game_no` | admin Bearer token |
| `addPlayer` | `POST /api/admin/players` | admin Bearer token |
| `updatePlayer` | `PUT /api/admin/players/:player_no` | admin Bearer token |
| LINE Webhook | `POST /line/webhook` | X-Line-Signature HMAC 検証（現行 worker.js 流用） |

---

## 2. エンドポイント詳細

### 2-1. POST /api/auth/login
選手ログイン。背番号を検証してセッショントークンを返す。

**GAS対応**: `action:'login'` → `login(playerId)`

**リクエスト**
```json
{ "playerId": "006" }
```

**レスポンス 200**
```json
{
  "ok": true,
  "data": {
    "token": "uuid-v4-string",
    "playerId": "6",
    "playerNo": "006",
    "name": "#6 赤穂雷太",
    "role": "player",
    "expiresAt": "2026-10-10T06:00:00Z"
  }
}
```
- `playerId` は正規化済み整数文字列 (GAS互換: `String(parseInt(playerId))`)
- TTL: 6時間 (GAS: `CacheService.put(key, val, 21600)` 相当)
- 404: player_no 未登録

---

### 2-2. POST /api/auth/admin-login
管理者ログイン。

**GAS対応**: `action:'adminLogin'` → `adminLogin(passwordHash)`

**リクエスト**
```json
{ "passwordHash": "sha256-hex-string" }
```
- ハッシュはクライアント側で `SHA-256(hnts2026_ + password)` 済み（FE 実装変更なし）

**レスポンス 200**
```json
{
  "ok": true,
  "data": {
    "token": "uuid-v4-string",
    "role": "admin",
    "adminRole": "ticket",
    "expiresAt": "2026-10-10T12:00:00Z"
  }
}
```
- `adminRole`: `"ticket"` | `"manager"`
- TTL: 12時間 (GAS: stateless → Worker でセッション管理)
- 401: ハッシュ不一致

---

### 2-3. GET /api/games
試合一覧取得。認証不要。

**GAS対応**: `action:'getGames'` → `getGames()`

**クエリパラメータ**（任意）
| param | 型 | 説明 |
|---|---|---|
| `season` | string | '2026-27'（省略時: 全季節） |
| `active` | boolean | true で is_active=1 のみ |

**レスポンス 200**
```json
{
  "ok": true,
  "data": [
    {
      "gameId": "G01",
      "gameNo": "G01",
      "date": "2026-10-08",
      "dayOfWeek": "木",
      "tipoff": null,
      "opponent": "川崎ブレイブサンダース",
      "deadline": "2026-10-01",
      "isDeadlinePassed": false,
      "season": "2026-27",
      "isActive": true
    }
  ]
}
```
- `isDeadlinePassed`: `deadline < now` で Worker が算出（GAS互換）
- `gameId` は `gameNo` と同値（GAS互換フィールド名）

---

### 2-4. GET /api/applications
選手自身の申込一覧。player Bearer token 必須。

**GAS対応**: `action:'getApplications'` + `verifyPlayerSession`

**クエリパラメータ**（任意）
| param | 型 | 説明 |
|---|---|---|
| `playerId` | string | 省略時: token から取得 |

**レスポンス 200**
```json
{
  "ok": true,
  "data": [
    {
      "applicationId": "APP-1748770000000",
      "playerId": "6",
      "gameId": "G01",
      "gameLabel": "10月8日（木）vs 川崎ブレイブサンダース",
      "category": "family",
      "ticketType": "family",
      "quantityAdult": 2,
      "quantityChild": 1,
      "quantityInfant": 0,
      "seatType": "",
      "seatRequest": "",
      "receiverName": "赤穂 由美",
      "pickupMethod": "pre",
      "paymentMethod": "",
      "parkingCount": 1,
      "note": "",
      "status": "confirmed",
      "lang": "ja",
      "source": "web",
      "createdAt": "2026-10-01T09:00:00Z",
      "updatedAt": "2026-10-02T10:00:00Z"
    }
  ]
}
```
- `ticketType` は GAS 互換フィールド（= `category`）
- `receiverName`: `receivers[0].name` を返す（GAS互換）

---

### 2-5. POST /api/applications
申込送信。player Bearer token 必須。

**GAS対応**: `action:'submitApplication'` + `verifyPlayerSession` + `submitApplication(body)`

**リクエスト**
```json
{
  "gameId": "G01",
  "category": "family",
  "ticketType": "family",
  "quantityAdult": 2,
  "quantityChild": 1,
  "quantityInfant": 0,
  "seatType": "",
  "seatRequest": "",
  "receiverName": "赤穂 由美",
  "pickupMethod": "pre",
  "paymentMethod": "",
  "parkingCount": 1,
  "note": ""
}
```
- `ticketType` を `category` として受け付ける（GAS互換）
- `gameId` は `game_no` ('G01') または数値 ID どちらも受け付ける

**レスポンス 201**
```json
{
  "ok": true,
  "data": {
    "applicationId": "APP-1748770000000"
  }
}
```
- 409 `DUPLICATE`: 同一 player × game × category で status != 'cancelled' が存在
- 410 `DEADLINE_PASSED`: `deadline < now`
- 同一トランザクションで D1 INSERT + audit_log INSERT

---

### 2-6. PUT /api/applications/:app_id/cancel
申込キャンセル。player Bearer token 必須（本人のみ）。

**GAS対応**: `action:'cancelApplication'` + `verifyPlayerSession` + `cancelApplication()`

**パスパラメータ**
- `app_id`: 'APP-{timestamp}' 形式

**リクエスト**: body 不要

**レスポンス 200**
```json
{
  "ok": true,
  "data": {
    "applicationId": "APP-1748770000000",
    "status": "cancelled"
  }
}
```
- 401: トークン不一致（他選手の申込）
- 404: app_id 未存在

---

### 2-7. GET /api/admin/applications
全申込取得。admin Bearer token 必須。

**GAS対応**: `action:'getAllApplications'` + adminToken クエリ

**クエリパラメータ**（任意）
| param | 型 | 説明 |
|---|---|---|
| `gameId` | string | game_no でフィルタ |
| `category` | string | invite / family / paid |
| `status` | string | pending / confirmed / rejected / cancelled |
| `playerId` | string | player_no でフィルタ |

**レスポンス 200**
```json
{
  "ok": true,
  "data": [ /* Application オブジェクト配列（2-4と同形式）*/ ]
}
```

---

### 2-8. PUT /api/admin/applications/:app_id/status
申込ステータス更新。admin Bearer token 必須（role: ticket のみ）。

**GAS対応**: `action:'updateStatus'` + `verifyAdmin(body.pwHash)`

**リクエスト**
```json
{ "status": "confirmed" }
```
- `status`: `pending` | `confirmed` | `rejected` | `cancelled`

**レスポンス 200**
```json
{
  "ok": true,
  "data": { "applicationId": "APP-...", "status": "confirmed", "updated": true }
}
```
- ステータス更新後、player に LINE push 通知を送信（GAS互換）
- 403: adminRole が 'manager' の場合
- 422 `INVALID_STATUS`: 不正ステータス値

---

### 2-9. GET /api/admin/players
選手一覧取得。admin Bearer token 必須。

**GAS対応**: `action:'getPlayers'` + adminToken クエリ

**レスポンス 200**
```json
{
  "ok": true,
  "data": [
    {
      "playerId": "6",
      "playerNo": "006",
      "name": "#6 赤穂雷太",
      "nameEn": "",
      "lineUserId": "U...",
      "isActive": true
    }
  ]
}
```

---

### 2-10. POST /api/admin/players
選手追加。admin Bearer token 必須 (role: ticket)。

**GAS対応**: `action:'addPlayer'` + `verifyAdmin`

**リクエスト**
```json
{
  "playerId": "030",
  "name": "#30 新選手",
  "nameEn": "",
  "lineUserId": null
}
```

**レスポンス 201**
```json
{
  "ok": true,
  "data": { "playerId": "30", "playerNo": "030", "name": "#30 新選手" }
}
```
- 409 `DUPLICATE`: player_no が既存

---

### 2-11. PUT /api/admin/players/:player_no
選手更新。admin Bearer token 必須 (role: ticket)。

**GAS対応**: `action:'updatePlayer'` + `verifyAdmin`

**リクエスト** (変更するフィールドのみ)
```json
{ "name": "更新後氏名", "lineUserId": "U..." }
```

**レスポンス 200**
```json
{
  "ok": true,
  "data": { "playerId": "6", "playerNo": "006", "name": "更新後氏名", "lineUserId": "U..." }
}
```

---

### 2-12. PUT /api/admin/games/:game_no/deadline
申込期限更新。admin Bearer token 必須。

**GAS対応**: `action:'updateDeadline'` + `verifyAdmin`

**リクエスト**
```json
{ "deadline": "2026-10-01" }
```

**レスポンス 200**
```json
{
  "ok": true,
  "data": { "gameNo": "G01", "deadline": "2026-10-01", "updated": true }
}
```

---

### 2-13. POST /api/admin/games
試合追加。admin Bearer token 必須。

**GAS対応**: `action:'addGame'` + `verifyAdmin`

**リクエスト**
```json
{
  "date": "2026-10-08",
  "opponent": "川崎ブレイブサンダース",
  "dayOfWeek": "木",
  "deadline": "2026-10-01",
  "tipoff": "18:05"
}
```
- `dayOfWeek`・`deadline`・`tipoff` 省略可。`deadline` 省略時は date-7日 (GAS互換)

**レスポンス 201**
```json
{
  "ok": true,
  "data": {
    "gameId": "G31",
    "gameNo": "G31",
    "date": "2026-10-08",
    "dayOfWeek": "木",
    "opponent": "川崎ブレイブサンダース",
    "deadline": "2026-10-01"
  }
}
```

---

### 2-14. PUT /api/admin/games/:game_no
試合更新。admin Bearer token 必須。

**GAS対応**: `action:'updateGame'` + `verifyAdmin`

**リクエスト** (変更フィールドのみ)
```json
{ "opponent": "変更後", "deadline": "2026-10-02" }
```

**レスポンス 200** — 更新後の game オブジェクト

---

### 2-15. DELETE /api/admin/games/:game_no
試合削除。admin Bearer token 必須。申込ありの場合は 409。

**GAS対応**: `action:'deleteGame'` + `verifyAdmin` + `deleteGame()`

**レスポンス 200**
```json
{
  "ok": true,
  "data": { "gameNo": "G31", "deleted": true }
}
```
- 409 `HAS_APPLICATIONS`: 申込が1件でも存在

---

### 2-16. POST /api/admin/games/replace-season
シーズン一括入替。admin Bearer token 必須 (role: ticket)。

**GAS対応**: `action:'replaceSeason2627'` + `verifyAdmin` + `replaceWithSeason2627()`

**リクエスト**
```json
{
  "season": "2026-27",
  "games": [
    { "gameNo": "G01", "date": "2026-10-08", "dayOfWeek": "木", "opponent": "川崎ブレイブサンダース", "deadline": "2026-10-01" }
  ]
}
```

**レスポンス 200**
```json
{
  "ok": true,
  "data": {
    "backedUpGames": 30,
    "backedUpApps": 0,
    "inserted": 30
  }
}
```
- 既存 games・applications はバックアップ（audit_log に記録）後に削除

---

### 2-17. GET /api/admin/line-stats
LINE 送信クォータ確認。admin Bearer token 必須。

**GAS対応**: `action:'getLineStats'`

**レスポンス 200**
```json
{
  "ok": true,
  "data": { "quota": 200, "used": 42, "remaining": 158 }
}
```

---

### 2-18. POST /line/webhook
LINE Webhook。X-Line-Signature HMAC-SHA256 検証（現行 worker.js の実装を統合）。

**GAS対応**: `body.events` 判定 + `handleLineWebhook(events)`

**リクエスト**: LINE プラットフォームからの標準 Webhook ペイロード

**レスポンス 200**
```json
{ "status": "ok" }
```
- 検証失敗: 401
- 処理は `ctx.waitUntil` でバックグラウンド実行（LINE に即 200 を返す）
- 内部で bot フロー全体を処理（番号連携 / menu:apply / menu:check / menu:help）

---

## 3. 型定義まとめ

### Application オブジェクト
```typescript
interface Application {
  applicationId: string;      // 'APP-{timestamp}'
  playerId:      string;      // 正規化整数文字列 ('6')
  playerNo:      string;      // 0埋め形式 ('006')
  gameId:        string;      // game_no ('G01')
  gameLabel:     string;      // '10月8日（木）vs 川崎'
  category:      'invite' | 'family' | 'paid';
  ticketType:    'invite' | 'family' | 'paid';  // GAS互換エイリアス
  quantityAdult:  number;
  quantityChild:  number;
  quantityInfant: number;
  seatType:      string;
  seatRequest:   string;
  receiverName:  string;      // receivers[0].name (GAS互換)
  receivers:     Array<{ name: string }>;
  pickupMethod:  '' | 'pre' | 'day';
  paymentMethod: '' | 'salary' | 'cash' | 'free';
  parkingCount:  number;
  note:          string;
  status:        'pending' | 'confirmed' | 'rejected' | 'cancelled';
  lang:          'ja' | 'en';
  source:        'web' | 'line';
  createdAt:     string;      // ISO 8601
  updatedAt:     string;
}
```

### Game オブジェクト
```typescript
interface Game {
  gameId:          string;  // = gameNo (GAS互換)
  gameNo:          string;  // 'G01'
  date:            string;  // 'YYYY-MM-DD'
  dayOfWeek:       string;  // '月'〜'日'
  tipoff:          string | null;
  opponent:        string;
  deadline:        string | null;
  isDeadlinePassed: boolean;
  season:          string;
  isActive:        boolean;
}
```

### Player オブジェクト
```typescript
interface Player {
  playerId:   string;  // 正規化整数文字列
  playerNo:   string;  // 0埋め形式
  name:       string;
  nameEn:     string;
  lineUserId: string | null;
  isActive:   boolean;
}
```
