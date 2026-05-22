# 秋田ノーザンハピネッツ 選手家族チケット申込システム
## マスター仕様書 v1.0（2026-05-23）

---

## 1. プロジェクト概要

### 目的
選手・スタッフとその家族が、試合ごとのチケットを Web から申し込めるシステム。  
従来の Google フォーム運用を置き換え、申込・管理・ステータス通知を一元化する。

### 公開 URL
```
https://ryuiyamada.github.io/happinets-ticket-243en98b/
```
> ※ URL に乱数を含む（セキュリティ by obscurity）。関係者のみに周知。

### リポジトリ
```
https://github.com/RYUIYAMADA/happinets-ticket-243en98b
```

---

## 2. システム構成

```
[選手/スタッフ]          [チケット担当/マネージャー]
     │                          │
     ▼                          ▼
  index.html ─── ログイン ───▶ index.html
     │                          │
  player-dashboard.html      admin.html
  player-form.html               │
     │                          │
     └──────── GAS Web App ──────┘
                    │
             Google Spreadsheet
```

| レイヤー | 技術 | 役割 |
|---------|------|------|
| フロントエンド | Static HTML/CSS/JS | 選手向け・管理者向けUI |
| ホスティング | GitHub Pages | 静的ファイル配信 |
| バックエンド | Google Apps Script (Web App) | API・DB操作 |
| DB | Google スプレッドシート | データ永続化 |
| CI/CD | GitHub Actions + clasp | gas/ 変更を自動デプロイ |

---

## 3. ファイル構成

```
/
├── index.html              ログイン画面（選手・管理者共通）
├── player-dashboard.html   選手：申込一覧・キャンセル
├── player-form.html        選手：新規申込フォーム
├── admin.html              管理者：申込管理・ステータス更新
├── gas/
│   ├── Code.gs             GAS バックエンド全コード
│   └── .clasp.json         clasp 設定
└── .github/workflows/
    └── deploy-gas.yml      GitHub Actions（gas/ push → clasp push）
```

---

## 4. スプレッドシート構造

**Script ID:** `1fsrgWzJFeeRfQCbaAyTXbqStTiv6aXjRbVsl3arJcnjM3jYQquBBylHW`

### シート一覧

| シート名 | 列構成 |
|---------|--------|
| 選手・スタッフ | 選手番号 / 氏名 / LINE ID |
| 試合日程 | 試合ID / 日付 / 曜日 / 対戦相手 / 申込期限 |
| 設定 | キー / 値（パスワードハッシュ等） |
| 招待チケット | APP_HEADERS 17列（下記） |
| 家族席 | APP_HEADERS 17列 |
| 有料チケット | APP_HEADERS 17列 |

### APP_HEADERS（申込シート共通 17列）
```
申込ID, 選手番号, 選手名, 試合,
枚数（大人）, 枚数（子ども）, 枚数（乳幼児）,
席種, 座席希望, 受取者氏名, 受取方法, 支払方法,
駐車場台数, 備考, 申込日時, ステータス, 試合ID＊
```
> col16 ステータス: 確認中 / 確保済み / 対応不可 / キャンセル（ドロップダウン）  
> col17 試合ID: システム用（スプレッドシート上は非表示推奨）

---

## 5. 画面仕様

### 5-1. index.html（ログイン）
- タブ切替: 選手ログイン / 管理者ログイン
- **選手**: 背番号（3桁: 001〜077 / スタッフ: 101〜）を入力
- **管理者**: アカウント種別（チケット担当 / チームマネージャー）＋ パスワード
  - チケット担当: 全操作可（ステータス更新含む）
  - チームマネージャー: 閲覧のみ
- パスワードは SHA-256（salt: `hnts2026_`）でハッシュ化して GAS へ送信
- ログイン後、auth 情報を sessionStorage に保存

### 5-2. player-dashboard.html（申込一覧）
- 選手の申込一覧を試合別カードで表示
- 月別グループ表示 / 期限切れ試合は折りたたみ
- キャンセル操作（確認中のみ可）
- セッションキャッシュ（TTL 5分）+ 並列フェッチ + スケルトンローディング

### 5-3. player-form.html（申込フォーム）
- チケット種別タブ: 招待チケット / 家族席 / 有料チケット
- **招待チケット**
  - 試合ごとにステッパー（枚数）+ 当日受取チェック
  - 試合カード内: 受取者名（必須）/ 特記事項 / 現在申込枚数サマリ
- **家族席**
  - 受取人事前登録（datalist で各試合から選択可）
  - 試合ごとにステッパー（合計枚数）+ 受取方法 + 駐車場台数
  - 試合カード内: 受取者名（必須）/ 特記事項 / 現在申込枚数サマリ
- **有料チケット**
  - 試合 / 枚数 / 席種 / 座席希望 / 受取方法 / 支払方法
- 追加申込時: 現在枚数 → 追加後合計枚数をリアルタイム表示

### 5-4. admin.html（管理者）
- 4タブ: 招待チケット / 家族席 / 有料チケット / 申込一覧
- ステータスをドロップダウンで更新（チケット担当のみ）
- 申込期限の一括設定バナー
- モバイル対応: 行タップで詳細展開

---

## 6. GAS API 仕様

**Web App URL:**
```
https://script.google.com/macros/s/AKfycbzx2dSpTkrIcWT9a2qzaM2pQIsRAQt3P0p6Y2q9gfr9mmU3oPgE3qeCNLRCQNJusFYo/exec
```

### GET エンドポイント
| action | 説明 |
|--------|------|
| `getGames` | 全試合一覧取得 |
| `getApplications` | 選手の申込一覧（playerId 必須） |
| `getAllApplications` | 全申込取得（管理者用）|
| `getPlayers` | 選手・スタッフ一覧 |
| `getLineStats` | LINE 送信クォータ確認 |

### POST エンドポイント
| action | 説明 | 認証 |
|--------|------|------|
| `login` | 選手ログイン | - |
| `adminLogin` | 管理者ログイン | - |
| `submitApplication` | 申込送信 | - |
| `cancelApplication` | 申込キャンセル | 本人確認 |
| `updateStatus` | ステータス更新 | verifyAdmin |
| `updateDeadline` | 申込期限更新 | verifyAdmin |
| `initData` | 初期データ投入 | - |

---

## 7. 認証・セキュリティ

| 項目 | 実装 |
|------|------|
| 選手認証 | 背番号のみ（簡易認証） |
| 管理者認証 | SHA-256（salt: `hnts2026_`）ハッシュ照合 |
| API 保護 | `verifyAdmin()` で pwHash 検証（updateStatus / updateDeadline） |
| sessionStorage | auth / adminPasswordHash / games_cache を保存 |
| URL 秘匿 | リポジトリ名に乱数（-243en98b） |

**パスワード（運用環境では変更必須）:**
- チケット担当: `1234` → hash: `245bcf73...`
- チームマネージャー: `manager1234` → hash: `75dba551...`

---

## 8. デプロイフロー

```
Code.gs を編集
    ↓
git push origin main
    ↓
GitHub Actions (deploy-gas.yml) が自動起動
    ↓
clasp push --force でGASに反映
    ↓
GASエディタでデプロイバージョンを更新
（clasp deploy --deploymentId <ID> --description "説明"）
```

> **重要**: `clasp push` はコードを更新するが、Web App の公開バージョンは手動または `clasp deploy` で更新が必要。

---

## 9. パフォーマンス対策（実装済み）

| 対策 | 内容 |
|------|------|
| GAS warmup | ページ読込 500ms 後に ping を送信（cold start 軽減） |
| リトライ待機短縮 | 800ms → 200ms |
| sessionStorage キャッシュ | 試合データを TTL 5分でキャッシュ |
| 並列フェッチ | `Promise.all([getGames(), getApplications()])` |
| スケルトンローディング | shimmer アニメーション（体感速度向上） |

---

## 10. デザインシステム

| 変数 | 値 | 用途 |
|------|----|------|
| `--primary` | `#000000` | ヘッダー・主ボタン |
| `--accent` | `#EC008C` | 強調・選択状態 |
| `--gold` | `#E6B422` | バッジ |
| `--text-sub` | `#4a5568` | サブテキスト |
| 日付表記 | `YYYY/MM/DD` | 全画面統一 |
| フォント | Hiragino Sans → Noto Sans JP | |

---

## 11. LINE 通知（実装準備済み・未稼働）

### 現状
- `getLineToken()`: PropertiesService からトークン取得（コードにトークンなし）
- `sendLineMessage(lineUserId, text)`: push 通知送信関数（実装済み）
- `handleLineWebhook(events)`: 友だち追加・背番号登録フロー（実装済み）
- `updateStatus()`: ステータス更新時に通知呼び出し（実装済み・トークン未設定時スキップ）
- 選手シートに `LINE ID` 列追加済み

### 稼働に必要な残作業
1. LINE Developers でチャンネル作成（Messaging API）
2. チャンネルアクセストークンを GAS スクリプトプロパティに登録
   - キー名: `LINE_CHANNEL_ACCESS_TOKEN`
3. LINE Developers の Webhook URL に GAS Web App URL を設定
4. 選手に公式アカウントを友だち追加してもらう
5. 友だち追加後、選手が背番号を送信 → LINE ID が自動登録される

### 通知フロー
```
チケット担当がステータス更新
    ↓
updateStatus() 実行
    ↓
getPlayers() で該当選手の LINE ID を取得
    ↓
sendLineMessage() で push 通知
    ↓
選手のLINEに「試合名・ステータス」が届く
```

---

## 12. テストデータ

`initTestData()` を GAS エディタから実行することで投入。

| 種別 | 件数 | 備考 |
|------|------|------|
| 招待チケット | 9件 | 複数選手・複数試合・全ステータス網羅 |
| 家族席 | 6件 | 駐車場・乳幼児・キャンセルケース含む |
| 有料チケット | 3件 | コートサイド・自由席・対応不可含む |

---

## 13. 現在のロードマップ

### ✅ 完了
- ログイン・認証（選手 / 管理者）
- 3種チケット申込フォーム
- 管理者画面（ステータス更新・期限設定）
- スプレッドシート DB 設計（日本語ヘッダー・3シート）
- GitHub Actions による自動デプロイ
- モバイル最適化
- WCAG AA 準拠（コントラスト・フォーカス・aria-live）
- パフォーマンス最適化（warmup・キャッシュ・並列フェッチ）
- LINE 通知の構造準備

### 🔜 次のマイルストーン
| 優先度 | タスク | 備考 |
|--------|--------|------|
| 高 | LINE 通知本実装 | チャンネル作成後すぐ着手可能 |
| 高 | 本番パスワード変更 | 運用開始前に必須 |
| 高 | GAS デプロイバージョン管理の自動化 | clasp deploy を CI に組み込む |
| 中 | 選手への案内・運用開始 | LINE 友だち追加周知含む |
| 中 | 申込期限のデフォルト設定（試合7日前自動） | 現在は手動設定 |
| 低 | 管理者画面：CSV エクスポート | チケット発注用 |
| 低 | 申込枚数上限の設定機能 | 現在はコード内 max 値 |

---

## 14. 参照ファイル

| ファイル | 内容 |
|---------|------|
| `gas/Code.gs` | バックエンド全コード |
| `gas/.clasp.json` | clasp 設定（Script ID等） |
| `.github/workflows/deploy-gas.yml` | CI/CD |
| `SPEC-security-ux.md` | セキュリティ・UX 修正仕様（過去） |
| `SPEC-responsive.md` | レスポンシブ対応仕様（過去） |
| `招待チケット申込 2026年5月 - Google フォーム.pdf` | 移行元フォーム（参考） |
| `家族席申込 2026年5月ホームゲーム - Google フォーム.pdf` | 移行元フォーム（参考） |
| `有料チケット申込 2026年1~5月 - Google フォーム.pdf` | 移行元フォーム（参考） |

---

*最終更新: 2026-05-23*
