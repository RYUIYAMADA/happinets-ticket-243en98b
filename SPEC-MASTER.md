# 秋田ノーザンハピネッツ 選手家族チケット申込システム
## マスター仕様書 v1.1（2026-06-12）

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

## 11. LINE 公式アカウント統合（v1.1 全面実装）

### アーキテクチャ方針
<!-- Gate1-MUST: pm-LINE-arch-1 -->
- GAS Web App を LINE Webhook エンドポイントとして兼用（新規サーバー不要）
- 状態管理: `CacheService.getScriptCache()` TTL=600秒
- キー: `LINE_STATE_{lineUserId}` → JSON文字列
- Lステップ等外部ツールとの共存: Webhook は自前が占有。自前機能はなるべく URI ボタンで完結させ、postback（Webhook依存）を最小化
- **外部ツール導入時は Webhook を明け渡す設計にする（将来拡張性）**

### 11-1. 初回登録フロー
```
友だち追加（follow イベント）
  → 「背番号を送ってください（例：006 / 101）」
選手番号送信
  → 選手・スタッフシートで照合
  → 一致: LINE ID をシートの col3 に保存
         「登録完了しました！」＋ クイックリプライメニュー表示
  → 不一致: 「番号が見つかりません。正しい番号を入力してください」
```

### 11-2. チケット自己申込フロー（新機能 v1.1）
```
Quick Reply: [チケット申込] → 状態: SELECTING_GAME
  → 申込期限内の直近3試合をクイックリプライで表示
     例）[10/10 土 vs 琉球] [10/11 日 vs 琉球] [10/17 土 vs 島根]

ゲーム選択 → 状態: SELECTING_TYPE
  → 「種別を選んでください」
     [招待チケット] [家族席] [有料チケット]

種別選択 → 状態: SELECTING_COUNT
  → 「大人の枚数を入力してください（1〜6）」
  → テキストで数字を返信

枚数入力（招待/家族席の場合） → 状態: SELECTING_RECEIVER
  → 「受取者氏名を入力してください」

受取者入力 → 状態: CONFIRMING
  → 確認メッセージ表示:
     「以下の内容で申込みます」
     試合: 10/10（土）vs 琉球
     種別: 招待チケット
     大人: 2枚
     受取者: ○○ 様
     [はい（送信）] [キャンセル]

「はい」返信 → GAS が submitApplication を呼び出し
  → 「申込完了！担当から確定連絡が届きます」
  → 状態リセット → メニューに戻る

「キャンセル」返信 → 「キャンセルしました」→ メニューに戻る
```

### 11-3. 有料チケット追加ステップ
```
SELECTING_COUNT 後 → SELECTING_SEAT_TYPE
  → 「席種を選んでください」
     [コートサイドシート] [2F自由席] [その他]
→ SELECTING_PAYMENT
  → 「支払方法を選んでください」
     [給与天引き] [当日現金]
→ CONFIRMING（上記と同じ確認フロー）
```

### 11-4. 申込確認フロー
```
Quick Reply: [申込確認]
  → getApplicationsByPlayer() で直近5件取得
  → ステータス絵文字付きで一覧表示:
     ✅ 確保済み: 10/10 招待 2枚
     ⏳ 確認中: 10/17 家族席 3枚
     ❌ 対応不可: 10/11 招待 2枚
```

### 11-5. ステータス更新通知（既存・継続）
```
admin.html でチケット担当がステータス更新
  → updateStatus() がスプレッドシートを更新
  → 該当選手の LINE ID を取得
  → push 通知: 「【チケット確定】10/10 琉球戦 招待チケット 2枚 → 確保済み」
```

### 11-6. GAS 新規関数（実装仕様）
| 関数 | 概要 |
|---|---|
| `getConversationState(uid)` | CacheService から状態 JSON を取得 |
| `saveConversationState(uid, state)` | CacheService に状態 JSON を保存（TTL 600秒） |
| `clearConversationState(uid)` | 状態をクリア（キャンセル・完了時） |
| `getUpcomingGames(n)` | 申込期限内の直近 n 試合を返す |
| `buildQuickReply(items)` | LINE quickReply オブジェクトを生成 |
| `submitLineApplication(uid, data)` | LINE 申込データをスプレッドシートに登録 |
| `getPlayerByLineUserId(uid)` | LINE ID → 選手データを逆引き |

### 11-7. スクリプトプロパティ（必須設定）
```
LINE_CHANNEL_ACCESS_TOKEN : チャンネルアクセストークン（長期）
```

### 11-8. Webhook URL 設定手順
1. LINE Developers → Messaging API チャンネル作成
2. Webhook URL = GAS Web App URL を設定
3. Webhook の利用: ON / 応答メッセージ: OFF
4. 友だち追加あいさつ: OFF（GAS 側で制御）
5. GAS スクリプトプロパティに `LINE_CHANNEL_ACCESS_TOKEN` 登録

---

## 12. i18n（日英切替）仕様 — v1.1 新規

<!-- Gate1-MUST: pm-i18n-1 -->
対象: 選手向け3画面（index.html / player-dashboard.html / player-form.html）
非対象: admin.html（日本語のみ）

### 実装方針
```javascript
// 各 HTML ファイルの先頭に定義
const STRINGS = {
  ja: { login: 'ログイン', playerLogin: '選手ログイン', ... },
  en: { login: 'Login',    playerLogin: 'Player Login', ... }
};
const lang = localStorage.getItem('ht_lang') || 'ja';
function t(key) { return STRINGS[lang][key] || STRINGS.ja[key]; }
function applyI18n() { /* data-i18n 属性で一括適用 */ }
```

### 言語切替 UI
- 位置: ヘッダー右上
- 表示: `JA / EN`（現在のものをハイライト）
- 動作: クリックで即切替 + localStorage 保存 + ページ全体に再適用
- 初回訪問時: `ja`（日本語優先）
- **前回の切替状態が次回訪問に引き継がれる**（localStorage 永続）

---

## 13. デザインシステム v1.1（ミニマル刷新）

<!-- Gate1-MUST: pm-design-1 -->

| 項目 | 旧 | 新 |
|---|---|---|
| 背景色 | `#f5f7fa`（グレー） | `#ffffff`（白） |
| カード | `box-shadow: 0 4px 24px ...` | `border: 1px solid #e5e7eb` のみ |
| 角丸 | `12px` | `4px` |
| アニメーション | shimmer / transition 多用 | なし（loading は opacity fade のみ） |
| フォント | 変更なし | 変更なし |
| カラー変数 | 変更なし | 変更なし |

**AI臭排除の基準:**
- ゴースト系エフェクト（shimmer / glassmorphism / gradient）禁止
- 装飾的 shadow 禁止（border のみで立体感を排除）
- 過度な rounded 禁止（最大 `6px`）
- `transition: all 0.3s ease` のような「なんでもトランジション」禁止

---

## 14. テストデータ（変更なし）

`initTestData()` を GAS エディタから実行することで投入。

| 種別 | 件数 | 備考 |
|------|------|------|
| 招待チケット | 9件 | 複数選手・複数試合・全ステータス網羅 |
| 家族席 | 6件 | 駐車場・乳幼児・キャンセルケース含む |
| 有料チケット | 3件 | コートサイド・自由席・対応不可含む |

---

## 15. ロードマップ v1.1

### ✅ 完了（v1.0）
- ログイン・認証（選手 / 管理者）
- 3種チケット申込フォーム
- 管理者画面（ステータス更新・期限設定）
- スプレッドシート DB 設計
- GitHub Actions による自動デプロイ
- モバイル最適化・WCAG AA 準拠
- LINE 通知の構造準備

### 🔜 v1.1 実装対象（本セッション）
| 優先度 | タスク |
|--------|--------|
| 高 | LINE 公式アカウント チケット自己申込ボット（GAS 拡張） |
| 高 | HTML デザイン刷新（AI臭ゼロ・ミニマル） |
| 高 | 日英切替（選手向け3画面・localStorage永続） |

### 🔜 v1.2 以降
| 優先度 | タスク |
|--------|--------|
| 高 | 本番パスワード変更・LINE チャンネル本番設定 |
| 中 | 申込期限のデフォルト設定（試合7日前自動） |
| 低 | 管理者画面：CSV エクスポート |
| 低 | 申込枚数上限の設定機能 |

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

## 16. 参照ファイル

| ファイル | 内容 |
|---------|------|
| `gas/Code.gs` | バックエンド全コード（LINE チャットボット含む） |
| `gas/.clasp.json` | clasp 設定（Script ID等） |
| `.github/workflows/deploy-gas.yml` | CI/CD |

---

*最終更新: 2026-06-12 (v1.1)*
