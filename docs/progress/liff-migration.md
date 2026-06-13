# LIFF化設計計画書 — family-tickets v1.1

> status: 設計ドラフト（Fableレビュー待ち）
> created: 2026-06-13 / updated: 2026-06-13
> 対象: player-form.html / player-dashboard.html

---

## 0. 前提・確定事項

| 項目 | 状態 |
|---|---|
| バックエンド(D1+Worker API) | 維持。変更最小 |
| admin.html | LIFF化対象外。通常Web維持 |
| Messaging APIチャネル | LINE bot(webhook)用。維持 |
| LIFFアプリの登録先 | **LINEログインチャネル**（別途新規作成が必要） |
| LINEミニアプリ | 対象外（現地法人承認が必要なため） |
| **利用者向けフロント** | **LIFF専用に確定。通常Webフロントは廃止（龍偉確定 2026-06-13）** |
| 通常Web版フォールバック | **廃止確定**。LINE内でのみ使用するサービスとして完全LIFF化 |
| LIFF endpoint URL | html-share (vercel.app・HTTPS) で当面運用。独自ドメインは将来課題 |
| スプレッドシート出力 | **必須機能として計画に含める**（SPEC-v1 §7・フェーズ5と統合。龍偉確定 2026-06-13） |

---

## 1. 全体構成図

```
【LINE内（選手・家族のみ利用）】
  選手のLINE
    │
    ├─(1) Messaging APIチャネル（既存）
    │       LINE bot: チケット案内・ステータス通知・朝通知
    │       リッチメニュー → LIFF URLへ誘導
    │
    └─(2) LINEログインチャネル（新規作成）
            LIFF アプリ x2
              - player-form（申込フォーム）
              - player-dashboard（申込状況）
                │
                │ liff.getIDToken()
                ▼
    Worker API (family-tickets-api.*.workers.dev)
              │
              ├─ POST /api/auth/liff-login（新規追加）
              │     LINE verify API でIDトークン検証
              │     → line_user_id で player 特定
              │     → 既存 sessions テーブルにトークン発行
              │
              ├─ POST /api/auth/link-liff（新規追加・初回連携用）
              │     背番号+line_user_id を受け取り players に紐づけ
              │
              ├─ 既存全エンドポイント（変更なし）
              │
              ▼
    Cloudflare D1
      players (line_user_id カラム 既存)
      sessions（既存のまま流用）
      export_state（シート出力位置管理）

【管理者（チケットチーム）】
  admin.html — 通常Webブラウザで継続（変更なし）

【シート出力（Cloudflare Cron）】
  Worker cron（5分間隔） → Google Sheets API
    D1 applications → スプレッドシートへ差分 append
    鍵: GOOGLE_SERVICE_ACCOUNT_KEY（wrangler secret）
```

### チャネルの関係
```
LINEログインチャネル ─── LIFF アプリ2つを登録
        │
        └─ Messaging APIチャネルとリンク設定（推奨）
           → リンクすると同一選手をどちらのチャネルでもLINE UIDで識別可能
           → bot通知とLIFFフォームで同じ line_user_id を共有できる
```

**注意**: LINEログインチャネルのチャネルIDと、Messaging APIチャネルのチャネルIDは別物。
IDトークンのaud（検証用）はLINEログインチャネルIDを使う。
リンク設定なしでも同一ユーザーであれば line_user_id は同一値だが、チャネルリンクを推奨。

---

## 2. LINE側の必要設定

### 2-1. 龍偉が LINE Developers コンソールで操作する事項

| No | 操作 | 場所 |
|---|---|---|
| A | LINEログインチャネルを新規作成 | LINE Developers → 新規プロバイダー or 既存プロバイダー → チャネル作成 → LINEログイン |
| B | LIFFタブ → 「追加」でLIFFアプリ作成（player-form用） | 作成したLINEログインチャネル → LIFF タブ |
| C | LIFFタブ → 「追加」でLIFFアプリ作成（player-dashboard用） | 同上 |
| D | 各LIFFアプリのスコープ設定: `openid` + `profile` にチェック | LIFF アプリ設定画面 |
| E | 既存Messaging APIチャネルとリンク設定（推奨） | LINEログインチャネル → Basic Settings → Linked OA |
| F | チャネルID・LIFFアプリIDを控える（Workerのenv設定に使う） | チャネル設定 → Basic Settings |

### 2-2. LIFFアプリ設定値（コード側で決まる項目）

| 設定 | player-form | player-dashboard |
|---|---|---|
| Endpoint URL | `https://<html-share-vercel-url>/player-form.html` | `https://<html-share-vercel-url>/player-dashboard.html` |
| Size | `full` | `full` |
| Scope | `openid`, `profile` | `openid`, `profile` |
| Module mode | OFF（全画面表示） | OFF |

### 2-3. 取得が必要なID/Secret

| 値 | 用途 | 誰が取得するか |
|---|---|---|
| LINEログインチャネルID（数字） | IDトークン検証のclient_id / aud として使用 | 龍偉がコンソールで確認 |
| LIFFアプリID（form用） | liff.init()に渡すliffId | LIFFアプリ作成後に自動発行 |
| LIFFアプリID（dashboard用） | liff.init()に渡すliffId | 同上 |

---

## 3. フロント改修

### 3-1. LIFF専用設計（フォールバックなし）

通常Web版フォールバックは廃止確定。player-form / player-dashboard は LINE内専用アプリとして設計する。

```
起動時の認証フロー（LIFF専用）:

① sessionStorage に有効なトークンあり
     → そのまま使う（再認証スキップ）

② LIFF SDK 初期化 → liff.init()
     → liff.isLoggedIn() が false の場合
          → liff.login() を呼び出す（LINEログイン画面へ遷移）
          → ログイン後リダイレクトで戻ってくる

③ liff.getIDToken() でIDトークン取得
     → POST /api/auth/liff-login
     → 成功: sessionToken を sessionStorage に保存 → フォームへ
     → 409 UNLINKED: 初回連携フロー（§5）へ
```

LINE外からアクセスした場合: `withLoginOnExternalBrowser: true` でLINEウェブログインに誘導。
ただしサービスとしてはLINE内使用を前提とし、LINE外UXは最低限でよい（エラー表示でも可）。

### 3-2. LIFF SDK 組込

各HTMLの `<head>` に追加:
```html
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
```

### 3-3. liff-auth.js（共通モジュール・新規作成）

```javascript
// liff-auth.js — LIFF認証共通処理

const LIFF_ID_FORM = "XXXXXXXXXXXX-XXXXXXXX";      // player-form用（実装時に埋める）
const LIFF_ID_DASHBOARD = "XXXXXXXXXXXX-XXXXXXXX"; // player-dashboard用（実装時に埋める）

async function initAndAuthWithLiff(liffId) {
  await liff.init({ liffId, withLoginOnExternalBrowser: true });

  if (!liff.isLoggedIn()) {
    liff.login(); // LINEログイン後リダイレクトで戻る
    return null;
  }

  const idToken = liff.getIDToken();
  const result = await workerApiClient.loginWithLiff(idToken);

  if (result.ok) {
    sessionStorage.setItem("sessionToken", result.data.token);
    return result.data;
  }

  if (result.error?.code === "UNLINKED") {
    // 初回連携フローへ（呼び出し元で処理）
    return { unlinked: true, lineUserId: await getLineUserId() };
  }

  throw new Error(result.error?.message || "LIFF認証失敗");
}

async function getLineUserId() {
  const profile = await liff.getProfile();
  return profile.userId;
}
```

### 3-4. player-form.html 改修差分（概要）

- 追加: `<head>` に LIFF SDK script タグ
- 追加: ページ初期化処理に `initAndAuthWithLiff(LIFF_ID_FORM)` 呼び出し
- 削除: 番号入力ログインUIセクション（通常Webフォールバック廃止）
- 追加: 初回連携UI（背番号入力画面。§5参照）
- 変更なし: フォーム本体・送信処理・api-client.js のAPIコール全て

### 3-5. player-dashboard.html 改修差分（概要）

- 追加: `<head>` に LIFF SDK script タグ
- 追加: 初期化処理に `initAndAuthWithLiff(LIFF_ID_DASHBOARD)` 呼び出し
- 削除: 番号入力ログインUIセクション（通常Webフォールバック廃止）
- 追加: 初回連携UI（§5参照）
- 変更なし: ダッシュボード本体・申込一覧取得・キャンセル処理全て

---

## 4. Worker API 追加エンドポイント

### 4-1. POST /api/auth/liff-login

**役割**: LINEのIDトークンを受け取り、サーバー側で検証し、既存セッショントークンを発行する。

**リクエスト**
```json
{ "idToken": "<liff.getIDToken()の戻り値>" }
```

**処理フロー**
```
1. idTokenを受け取る
2. LINE verify API で検証
   POST https://api.line.me/oauth2/v2.1/verify
   Body(form-urlencoded): id_token=<idToken>&client_id=<LINE_LOGIN_CHANNEL_ID>

3. 検証チェック（必須）:
   - iss === "https://access.line.me"
   - aud === env.LINE_LOGIN_CHANNEL_ID
   - exp > now

4. line_user_id = verifyレスポンスの sub
5. players テーブルで line_user_id を検索
   a. 存在する → createPlayerSession() でトークン発行 → 200
   b. 存在しない → 409 UNLINKED

6. 成功レスポンス（既存 /api/auth/login と同形式）:
{
  "ok": true,
  "data": {
    "token": "uuid-v4-string",
    "playerId": "6",
    "playerNo": "006",
    "name": "#6 赤穂雷太",
    "role": "player",
    "expiresAt": "..."
  }
}
```

**Worker実装の変更範囲**
- `src/index.js`: 新ルート追加（約30行）
- `src/repo.js`: `findPlayerByLineUserId()` 追加のみ
- `wrangler.toml`: 新環境変数 `LINE_LOGIN_CHANNEL_ID` 追加

### 4-2. POST /api/auth/link-liff

**役割**: 初回連携専用。LIFFで取得した line_user_id と背番号を紐づける。

**リクエスト**
```json
{
  "lineUserId": "U...",
  "playerId": "006"
}
```

**処理フロー**
```
1. idTokenで line_user_id を再検証（lineUserIdの改ざん防止。要設計。→ §5参照）
2. players テーブルで player_no を検索
   a. 存在しない → 401
   b. 既に別の line_user_id が登録済み → 409 ALREADY_LINKED
3. players.line_user_id に lineUserId を UPDATE
4. createPlayerSession() でトークン発行 → 200（liff-login と同形式）
```

**なりすまし防止**: `lineUserId` をフロントから渡すのは改ざんリスクあり。
代替案: リクエストに `idToken` も含めてWorker側で再検証し line_user_id を取得する方式が安全。

### 4-3. IDトークン検証方式（推奨: LINE verify API）

| 方式 | メリット | デメリット |
|---|---|---|
| LINE verify API（推奨） | 実装シンプル。LINE公式推奨 | 毎回LINEへHTTP呼び出しが発生 |
| JWKS/JWT検証（ローカル） | 処理速い | JWKS取得・キャッシュ管理が複雑。Worker環境での実装工数大 |

Cloudflare Workerから外部HTTP呼び出しは問題なく動く。LINE verify API を採用。

### 4-4. CORS 追加

現行の `ALLOWED_ORIGIN` は単一値固定（env変数）。
LIFF endpoint = html-share (vercel.app) であれば現行の登録済みURLと同一ドメインになる見込み。
**要確認**: html-share の vercel.app ドメインが現行 `ALLOWED_ORIGIN` に設定済みか。
複数オリジンが必要な場合は ALLOWED_ORIGIN を配列対応に改修が必要。

---

## 5. 初回連携フロー（LIFFに未連携の選手）

### 現状
`players.line_user_id` は既存LINE botフロー（友達追加 → 番号送信）で登録済みの選手が多い。
LIFFでも同じ line_user_id が使われるため、連携済みならLIFF初回起動から自動ログインになる。

### 未連携の場合（409 UNLINKEDを受け取った時）

```
LIFF起動 → liff-login → 409 UNLINKED
    │
    ▼
「初めてご利用の方へ」画面を表示
    │
    ↓ 背番号入力（player_no）
    │
    ▼
POST /api/auth/link-liff
  body: { idToken: "<IDトークン>", playerId: "006" }
  ※ lineUserIdはWorker側でidTokenから再取得（改ざん防止）
    │
    ├─ 成功 → players.line_user_id に登録
    │         → セッショントークン発行 → フォームへ
    │
    └─ 失敗（番号不一致） → エラー表示 → 再入力
```

**なりすまし防止の強度（未決定・D3）**: 背番号のみで連携する場合、総当たりで他選手に成り済ませるリスクがある。
選手数は約30名・背番号は1〜99の範囲のため、低リスクではあるが対策を検討する価値はある。

**対策候補**:
- 名前（または名前の頭文字）との組み合わせ確認
- レートリミット（IP単位で連携試行を制限）
- 現行bot方式と同等（背番号のみ）とみなして対策なし

---

## 6. スプレッドシート出力（SPEC-v1 §7・フェーズ5 統合）

### 概要

チケットチームが申込管理に使うスプレッドシートへ、D1のapplicationsデータを自動出力する。
SPEC-v1 §7（フェーズ5）で設計済みの機能をLIFF化計画に統合する。

### 仕様（確定済み部分）

| 項目 | 内容 |
|---|---|
| 出力先構成 | **種別ごとに別スプレッドシート。1種別=1スプレッドシート=1タブ（確定）** |
| 種別 | invite（招待）/ family（家族席）/ paid（有料）の3種別 |
| 方向 | D1 → Sheets の一方向エクスポートのみ（Sheets → D1 の書き戻しなし） |
| 列構成 | 現行スプレッドシートの列構成を踏襲（変更は担当者確認が必要）|
| 認証 | Google Service Account（GOOGLE_SERVICE_ACCOUNT_KEY を wrangler secret に設定）|
| 実装場所 | Cloudflare Worker cron trigger |
| 状態管理 | `export_state` テーブル（DDL既存。種別ごとの `last_app_id` に拡張が必要）|
| シート運用 | 閲覧専用（チームはシートを編集しない運用。D1が正本）|
| 出力先URL管理 | **管理画面（admin.html）の設定欄から登録。D1の settings テーブル等に保存。事前の ID 決め打ちなし** |

### 出力先URL登録方式（確定）

出力先スプレッドシートのURLは管理者が運用時に管理画面から登録する。

```
admin.html → 設定タブ → スプレッドシート出力設定

┌──────────────────────────────────────────────┐
│  招待席 出力先URL   [https://docs.google.com/...]  [保存] │
│  家族席 出力先URL   [https://docs.google.com/...]  [保存] │
│  有料席 出力先URL   [https://docs.google.com/...]  [保存] │
│                                                            │
│  ⚠ 初回設定手順:                                          │
│  1. 各スプレッドシートをサービスアカウントのメールアドレスに │
│     「編集者」として共有する                               │
│     SA メール: <xxx@xxx.iam.gserviceaccount.com>          │
│  2. 上記にURLを貼り付けて保存する                          │
└──────────────────────────────────────────────┘
```

**Worker API 追加エンドポイント（設定保存用）**:
- `GET /api/admin/settings` — 現在の設定値一覧取得（admin Bearer token）
- `PUT /api/admin/settings` — 設定値保存（admin Bearer token・role: ticket 以上）

**D1 スキーマ追加**:
```sql
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,  -- 'sheet_url_invite' | 'sheet_url_family' | 'sheet_url_paid'
  value  TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 出力ロジック

```
Cron 実行（5分間隔）
    │
    ├─ settings から sheet_url_invite / sheet_url_family / sheet_url_paid を取得
    │
    ├─ export_state から種別ごとの last_app_id を取得（未追記の差分だけ対象）
    │
    ├─ applications を category = 'invite' で絞り → sheet_url_invite に追記
    ├─ applications を category = 'family' で絞り → sheet_url_family に追記
    └─ applications を category = 'paid'   で絞り → sheet_url_paid   に追記
         │
         ├─ URL 未登録（空文字）の種別はスキップ（エラーにしない）
         └─ 追記成功後に export_state の該当 last_app_id を更新
```

**export_state の拡張**:
現行の単一 `last_app_id` を種別ごとに持つよう拡張が必要（または種別ごとの行を追加）。
実装時に既存 DDL との整合を確認すること。

### サービスアカウント初回設定手順（管理画面に表示する内容）

1. Google Cloud Console でサービスアカウントを作成し鍵（JSON）を発行する。
2. `wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY` で Worker に登録する。
3. 各スプレッドシートを開き、「共有」からサービスアカウントのメールアドレスを「編集者」で追加する。
4. 管理画面の設定タブから出力先URLを登録する。

### セキュリティ・コンプライアンス（R-5）

SPEC-v1 R-5 に記載の通り、フェーズ4着手時にセキュリティ再チェック対象。

- `GOOGLE_SERVICE_ACCOUNT_KEY` は書込スコープを持つ。共有は出力対象シート3枚のみに限定する。
- 選手の氏名・申込情報（個人情報）がシートに出力される → コンプライアンス確認必須。
- compliance-reviewer への差し戻しをフェーズ4 Gate1 で必須とする。

### 未決定事項（シート出力に関する決定事項）

| No | 事項 | 内容 |
|---|---|---|
| D7 | 出力タイミング | A: cron定期（5分間隔・SPEC-v1推奨） / B: 申込時にリアルタイムpush / C: 手動トリガー |
| D8 | 出力シートの列構成 | 現行スプレッドシートの列順・列名を担当者と確認して確定 |
| D9 | 出力対象のステータス | 全ステータス（pending含む）/ confirmed以降のみ / 要担当者確認 |
| ~~D10~~ | ~~スプレッドシートID~~ | **確定: 管理画面でURL登録方式に変更** |

**推奨 D7**: A（cron 5分間隔）。SPEC-v1 §7で設計済みのため。リアルタイムは実装コスト増で過剰。

---

## 7. セキュリティ

### IDトークン検証（必須チェック）

| チェック項目 | 値 | 実装箇所 |
|---|---|---|
| iss | `https://access.line.me` | Worker /api/auth/liff-login |
| aud | `env.LINE_LOGIN_CHANNEL_ID`（LINEログインチャネルID） | Worker |
| exp | `exp > Date.now()/1000` | Worker |
| idTokenの形式 | JWT 3パート構造・空でないこと | Worker |

### リプレイ攻撃対策
- LINE IDトークンのデフォルトTTLは約10分。
- Worker検証後すぐにSessionトークンを発行 → IDトークン自体は保存しない。
- exp チェックで同一IDトークンの再利用を防止。
- 改善案: `nonce` パラメータを `liff.init()` に渡し Worker で検証するとリプレイ耐性が上がる。

### CORS
- html-share (vercel.app) ドメインが `ALLOWED_ORIGIN` に設定済みであれば追加不要。
- 複数Origin必要な場合: `ALLOWED_ORIGIN` env変数を配列 or パターンマッチ対応に改修。

### 既存IDOR防止との整合
- `/api/applications` は Bearer tokenから player_id を解決（URL/クエリにplayer_id不要）。
- LIFF認証で発行するtokenも同じ `sessions` テーブルを使うため、IDOR防止はそのまま機能する。

---

## 8. 段階移行計画とロールバック

### フェーズ構成（確定版）

```
フェーズ1（現状）:
  html-share: 通常Web版（番号ログイン）← 現行
  LINE bot: テキストでの申込フロー

フェーズ2（LIFF追加・並行稼働）:
  html-share: 通常Web版をそのまま残す（移行期のロールバック保険）
  LIFF URL: 別URLで追加。LINE内リッチメニュー経由で先行利用者に案内
  Worker: /api/auth/liff-login と /api/auth/link-liff を追加

フェーズ3（LIFF本番切替）:
  html-share 通常Web版: **廃止**（確定）
  LIFF: 正式リリース。全選手への案内
  LINE bot: リッチメニューをLIFF URL誘導に全面変更

フェーズ4（シート出力）:
  Cron: D1 → スプレッドシート自動出力を有効化
  → compliance-reviewer Gate1 完了後に着手
```

### ロールバック（フェーズ2〜3の移行中）
- LIFFは「追加する」だけで既存通常Web版を壊さない。
- `/api/auth/liff-login` は既存ルートに影響なし。
- LIFF動作不良時: リッチメニューを通常Web版URLに戻すだけで即フォールバック。
- フェーズ3（廃止）以降はロールバック不可。フェーズ2でE2Eテストを十分行うこと。

---

## 9. 作業規模見積もり（確定版）

### タスク分解

| # | タスク | 種別 | 工数感 |
|---|---|---|---|
| T1 | LINE Developers: LINEログインチャネル作成 | 龍偉操作 | 15分 |
| T2 | LIFFアプリ2つ作成・スコープ設定 | 龍偉操作 | 20分 |
| T3 | Messaging APIチャネルとのリンク設定 | 龍偉操作 | 10分 |
| T4 | Worker: POST /api/auth/liff-login 実装 | コード | S(1〜2h) |
| T5 | Worker: repo.js に findPlayerByLineUserId 追加 | コード | S(30min) |
| T6 | Worker: POST /api/auth/link-liff 実装（初回連携） | コード | S(1〜2h) |
| T7 | Worker: wrangler.toml に LINE_LOGIN_CHANNEL_ID 追加 | コード | S(15min) |
| T8 | フロント: liff-auth.js 共通モジュール作成 | コード | S(1〜2h) |
| T9 | player-form.html: LIFF SDK + 認証フロー組込・番号入力UI削除 | コード | M(2〜3h) |
| T10 | player-dashboard.html: LIFF SDK + 認証フロー組込・番号入力UI削除 | コード | M(2〜3h) |
| T11 | 初回連携UI（背番号入力画面）実装 | コード | S(1〜2h) |
| T12 | LINE bot: リッチメニューにLIFF URLを設定 | 設定 | S(30min〜1h) |
| T13 | テスト: 実機LINEでE2Eテスト（LIFF認証・申込・ダッシュ） | テスト | M(2〜3h) |
| T14 | テスト: 初回連携フロー確認 | テスト | S(1h) |
| —— | —— シート出力（フェーズ4）—— | | |
| T15 | compliance-reviewer Gate1 | レビュー | S(1h) |
| T16 | D1: settings テーブル DDL 追加 | コード | S(15min) |
| T17 | Worker: GET/PUT /api/admin/settings 実装 | コード | S(1h) |
| T18 | admin.html: スプレッドシート出力設定UI追加（URL登録欄×3・手順表示） | コード | S(1〜2h) |
| T19 | Worker: Cron trigger 実装（種別ごとD1差分→各Sheets append） | コード | M(3〜4h) |
| T20 | Worker: export_state を種別ごとに拡張 | コード | S(30min) |
| T21 | Google Service Account 作成・鍵設定（wrangler secret） | 設定 | S(30min) |
| T22 | テスト: 3種別シート出力確認・URL未登録時スキップ確認 | テスト | S(1〜2h) |

**コード実装合計（LIFF化のみ T4〜T14）**: M〜L（実装8〜14h + テスト3h = 約1.5〜2日）
**シート出力追加（T15〜T22）**: M（実装5〜7h + テスト1.5h = 約1日）
**トータル**: L（約2.5〜3日）

---

## 10. 龍偉が決定・操作する必要がある事項（最終版）

### 確定済み（変更不要）

| No | 事項 | 確定内容 |
|---|---|---|
| D1 | LINE外フォールバック方針 | **確定: LIFF専用。通常Web廃止** |
| D4 | LIFF endpoint URL | **確定: html-share (vercel.app・HTTPS) で当面運用** |
| D6 | 利用者向け通常Web版の扱い | **確定: 廃止（adminのみ維持）** |

### 残る決定が必要な事項

| No | 事項 | 選択肢・備考 | 優先度 |
|---|---|---|---|
| D2 | 初回LIFF連携フロー | 案1(推奨): LIFF内背番号入力 / 案2: botで先に連携してからLIFF | 高 |
| D3 | なりすまし防止の強度 | a: 背番号のみ（現行botと同等） / b: 名前の頭文字等を追加 | 中 |
| D5 | Messaging APIチャネルとのリンク設定 | する（推奨）/ しない | 中 |
| D7 | シート出力タイミング | A(推奨): cron 5分間隔 / B: 申込時リアルタイム / C: 手動 | 高（フェーズ4前） |
| D8 | シート出力の列構成 | 現行スプレッドシートの列順を担当者と確認・確定 | 高（フェーズ4前） |
| D9 | 出力対象ステータス | 全ステータス / confirmed以降 / 要担当者確認 | 中（フェーズ4前） |
| ~~D10~~ | ~~スプレッドシートID~~ | **確定: 管理画面でURL登録方式** | — |

### 龍偉の操作が必要な事項

| No | 操作 | タイミング |
|---|---|---|
| O1 | LINEログインチャネル作成 | フェーズ2着手前 |
| O2 | LIFFアプリ2つ作成・スコープ設定 | フェーズ2着手前 |
| O3 | チャネルID・LIFFアプリIDを共有 | フェーズ2着手前 |
| O4 | Google Service Account 作成・鍵発行（またはGSA鍵の共有） | フェーズ4着手前 |
| O5 | 招待/家族/有料 各スプレッドシートをSAメールに「編集者」で共有 | フェーズ4着手前（管理画面の手順に従う）|
| O6 | 管理画面の設定タブから出力先URL（3種別）を登録 | フェーズ4テスト前 |
| O7 | シート列構成を担当者と確認して共有 | フェーズ4着手前 |

---

## 11. 不確かな点・要確認事項

| 項目 | 内容 | 影響 |
|---|---|---|
| U1 | LINE verify API `/oauth2/v2.1/verify` の aud 検証の正確な挙動 | セキュリティ要件に直結。実装前にLINEドキュメントで確認 |
| U2 | html-share の vercel.app ドメインが現行 `ALLOWED_ORIGIN` に設定済みか | 未設定なら CORS 対応改修が必要 |
| U3 | 既存LINE bot の line_user_id とLINEログインチャネルでの line_user_id が同一か | リンク設定なしでも同一のはずだが、初回連携フロー設計に影響 |
| U4 | CORS の複数Origin対応: 現行 `ALLOWED_ORIGIN` は1値固定 | LIFFと管理画面で別ドメインなら改修必要 |

---

## 12. 誤連携のやり直し機能（再ログイン/再連携）

> 龍偉の要件 (2026-06-14): 「間違った番号でログイン/連携してしまった時に、接続し直す（やり直す）機能が必要」

### 12-1. 要件
- **フォールバック番号ログイン時**: 別の背番号で入り直したい場合、「接続し直す」から背番号入力画面に戻る
- **LIFF連携時**: 誤連携を修正するため「別の選手に接続し直す」→ 背番号入力 → POST /api/auth/link-liff で line_user_id を付け替える

### 12-2. 実装内容

#### FE 側（player-form.html / player-dashboard.html）

| 項目 | 実装内容 |
|---|---|
| ボタン配置 | player-form: ヘッダーの header-title 内に「接続し直す」（小さめピル） / player-dashboard: ヘッダーの header-actions に「接続し直す」（ボタン） |
| ボタン表示条件 | ログイン後 initFormAfterAuth / initDashboardAfterAuth 内で `relogin-btn.style.display = 'inline-block'` |
| handleRelogin() 動作 | ①sessionStorage トークン all clear / ②コンテナ display=none / ③fallback-login-overlay（form）or liff-link-overlay（dashboard）を display=flex で再表示 / ④入力欄 focus |
| デザイン準拠 | CSS クラス `header-relogin-btn` / `btn-relogin` でトークン（`--primary-weak` / `--primary`）使用。DESIGN.md §8b モノクロ線アイコン準拠（ボタンテキストのみ） |

#### BE 側（cloudflare-worker-api/src/repo.js）

**修正: linkLineUserIdToPlayer() 関数**

```javascript
// 既存の line_user_id が別 player に紐付いている場合は解除（再連携対応）
const operations = [
  // 旧 player の line_user_id を解除
  db.prepare(`UPDATE players SET line_user_id = NULL WHERE line_user_id = ?1 AND id != ?2`).bind(lineUserId, player.id),
  // 新 player に line_user_id を付与
  db.prepare(`UPDATE players SET line_user_id = ?1 WHERE id = ?2`).bind(lineUserId, player.id),
  // 監査ログ
  audit(...),
];
```

**特性**:
- UNIQUE 制約: line_user_id に UNIQUE がある場合、先に旧 player を NULL で解除してから新 player に付与（単一 batch で実行）
- ID token 検証: /api/auth/link-liff 既存ロジック（idToken の LINE verify API 検証）は変更なし。なりすまし防止を維持
- 監査ログ: `line_link` event に lineUserId を記録して、付け替え操作を追跡可能に

### 12-3. 動作フロー

```
【フォールバック番号ログイン時のやり直し】
ユーザー: 誤った背番号でログイン
         ↓
header に「接続し直す」ボタン表示
         ↓
ユーザー: 「接続し直す」クリック
         ↓
handleRelogin()
  - sessionStorage clear
  - fallback-login-overlay 再表示
         ↓
ユーザー: 正しい背番号を入力 → ログイン
         ↓
申込フォーム表示


【LIFF連携時のやり直し】
ユーザー: 誤った背番号で LIFF 連携
         ↓
header に「接続し直す」ボタン表示
         ↓
ユーザー: 「接続し直す」クリック
         ↓
handleRelogin()
  - sessionStorage clear
  - liff-link-overlay（LIFF 初回連携モーダル）再表示
         ↓
ユーザー: 正しい背番号を入力 → POST /api/auth/link-liff
         ↓
Worker: 既連携 line_user_id を旧 player から解除 → 新 player に付与
         ↓
ダッシュボード表示（新しい player のデータ）
```

### 12-4. テスト方法

- **フォールバック**: localhost で背番号「999」→ 「接続し直す」→ 「006」で再入力 → フォーム表示確認
- **LIFF**: 本番 LIFF 試行時に異なる背番号で 2 回連携 → 最後の背番号のダッシュボード表示確認・監査ログで付け替え記録確認

---

## 更新履歴

- 2026-06-13 — 初版作成（設計ドラフト）
- 2026-06-13 — v1.1: 龍偉確定事項を反映
  - D1/D6確定: LIFF専用化、利用者向け通常Web廃止
  - D4確定: LIFF endpoint = html-share (vercel.app)
  - スプレッドシート出力を必須機能として追加（フェーズ4、SPEC-v1 §7統合）
  - フェーズ構成を4フェーズに更新
  - 決定事項リストを確定済み/残存に整理
- 2026-06-13 — v1.2: シート連携の種別別構成を確定反映
  - 招待/家族/有料=種別ごとに別スプレッドシート（1種別=1SS=1タブ）に確定
  - D10確定: スプレッドシートURLは管理画面の設定欄から登録する方式に変更
  - D1 settings テーブル（sheet_url_invite/family/paid）追加
  - admin.html への設定UI追加・SAメール共有手順の表示を設計に追加
  - export_state を種別ごとに拡張する設計を追加
  - タスク T16〜T22 に細分化・工数をL（約2.5〜3日）に更新
- 2026-06-14 — v1.3: 誤連携のやり直し機能（再ログイン/再連携）を追加実装
  - player-form.html: ヘッダーに「接続し直す」ボタンを追加（フォールバック番号ログイン時に表示）
  - player-dashboard.html: ヘッダー「接続し直す」ボタンを追加（LIFF連携済み時に表示）
  - handleRelogin() 関数: トークン clear → ログイン画面再表示
  - Worker API: linkLineUserIdToPlayer() を修正・既連携の line_user_id を別 player に付け替え対応
  - 龍偉から追加依頼（誤連携時の復旧UX向上）
