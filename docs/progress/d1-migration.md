---
task: "v1.0 構造改修: スプレッドシートDB → Cloudflare D1 + Workers 全面移行"
project: "family-tickets"
created: "2026-06-13 05:41"
last_updated: "2026-06-13 05:41"
status: in_progress
branch: "main（実装フェーズで feature/d1-migration を切る）"
progress_pct: 0
---

# v1.0 構造改修: D1 + Workers 移行

> このファイルは作業の「背骨」。中断しても `/dev-resume` でここから完全復元できる。

## 基本情報
- プロジェクト: family-tickets
- ブランチ: main → 実装時 feature/d1-migration
- 関連リンク: Obsidian Sessions/Happinets Family Tickets.md / SPEC-MASTER.md（現行仕様）
- 開始日: 2026-06-13
- 決定者: 龍偉（2026-06-13 案1を選択）

## 要件サマリー
- **背景・目的**: スプレッドシート＝DB の構造的脆さ（型なし・ロック・行ズレ・GASエディタ依存）を解消する。管理DBを正規の SQLite(D1) にし、API を Workers に統一。LINE プロキシで Cloudflare 基盤が稼働済みのため追加費用ゼロ。
- **受入条件**（これが全部✅になったら完了）:
  - [ ] D1 スキーマ（players/games/applications/sessions/admin/audit_log）が migration ファイルで管理されている
  - [ ] Worker API が現行 GAS API と機能同等（選手認証・申込・キャンセル・管理CRUD・26-27入替・LINE webhook）
  - [ ] フロント4画面（index/player-form/player-dashboard/admin）が Worker API で全機能動作
  - [ ] LINE bot（番号連携・申込・確認・日英デフォルト返信）が Worker 上で動作（GAS 経由廃止）
  - [ ] 申込履歴がスプレッドシートに自動出力される（現行シートの列構成踏襲・最終フェーズで構築）
  - [ ] 現行データ（選手・LINE紐づけ・26-27試合30件）が D1 へ移行済み・並行稼働で結果一致を確認
  - [ ] セキュリティレビュー（認証・認可・署名検証・XSS）+ QAレビュー通過・Critical ゼロ
- **スコープ**:
  - 対象: DB設計 / Worker API+認証 / FE切替 / LINE bot 移行 / シート出力 / データ移行・切替
  - 対象外: デザイン刷新（v0.2.0 の DS 準拠を維持）/ 新機能追加 / 有料チケット・招待チケット以外の新カテゴリ / B.LEAGUE 公式API連携
- **制約**:
  - 現行 GAS v0.3.0 は切替完了まで稼働継続（運用を止めない）
  - 回答履歴のシート出力は現行スプレッドシートの列構成を踏襲（スタッフ業務フローを変えない）
  - シート出力フェーズは最後に構築（龍偉指示 2026-06-13）

## コードベース調査結果
- **直接修正するファイル**:
  - `cloudflare-worker/`: worker.js（現 LINE プロキシ）を Workers プロジェクトに拡張（API+bot+D1）
  - `index.html` / `player-form.html` / `player-dashboard.html` / `admin.html`: API 呼び出し層（callGAS）を Worker API クライアントに差し替え
  - 新規: `cloudflare-worker/migrations/*.sql` / `cloudflare-worker/src/`（API ルート・auth・line・export）
- **影響範囲（参照のみ）**:
  - `gas/Code.gs`: 現行仕様の正（業務ロジック・バリデーション・LINE フローの移植元）。最終的に退役
  - `scripts/setup-gas-env.sh` / `.env.gas`: シークレット管理が wrangler secret に一本化される
  - `schedule-2026-27/秋田ノーザンハピネッツ_2026-27_Schedule.xlsx`: 試合マスタの移行元
- **参考になる既存実装**:
  - `cloudflare-worker/worker.js`: LINE 署名検証（WebCrypto HMAC）実装済み・流用可
  - `gas/Code.gs` の verifyPlayerSession / 3申込シート構造: D1 スキーマ設計の正規化対象

## 詳細タスク一覧
状態: ⬜未着手 / 🔄作業中 / ✅完了 / ⏸️保留 / ❌中止

### フェーズ1: 設計（PM スケルトン → 技術詳細肉付け → Gate1/2）
- ✅ SPEC-v1 スケルトン作成（PM: スコープ・トレードオフ・RBAC・ERD 方針）
- ✅ D1 スキーマ詳細設計（migrations/0001_init.sql・9テーブル）
- ✅ API 契約書 docs/api-contract.md（GAS 全 action 対照表つき・620行）
- ✅ PM 裁定6件を SPEC §12 に記録（朝通知=Cron Triggers 等）
- ✅ Gate1 レビュー（engineer/security）→ 指摘11件を 87150a1 で反映
- ✅ Gate2 サインオフ（engineer/security 並列）→ 両者 concern・Block無し。承認条件6件を c65abe9 で反映 → **Gate2 approve 確定**

### フェーズ2: 実装（垂直スライス先行 → 並列）
- ✅ スライス1本目: 「選手ログイン→試合一覧表示」を D1+Worker+FE で貫通（a760cc1）。実機 wrangler+curl 検証 approve・手戻りなし
- ✅ Worker API 残り16ルート（申込・キャンセル・管理CRUD・一括入替・admin-login・logout・取得系）— Job A（57377c8・npm test 16/16）
- 🔄 FE 4画面の API 層切替 — Job C（ft-fe-switch・B と並列実行中）
- 🔄 LINE bot を Worker 内に移植（webhook会話フロー・署名 crypto.subtle.verify・push・朝通知quotaガード）— Job B（ft-line-bot・C と並列実行中）

### フェーズ3: データ移行・検証
- ⬜ 移行スクリプト（GAS シート → D1。選手・LINE紐づけ・試合30件・既存申込）
- ⬜ 並行稼働テスト（同一操作で GAS と D1 の結果一致確認）
- ⬜ E2E テスト（LINE 実機・全画面チェックリスト）

### フェーズ4: シート出力・切替・レビュー
- ⬜ 申込履歴のスプレッドシート自動出力（現行列構成踏襲・cron トリガー）※最終構築
- ⬜ 本番切替（LINE webhook 先変更・FE 公開・GAS 退役）
- ⬜ Step10 クロスレビュー + セキュリティ最終監査 + 完了報告

## テスト進捗
| 種別 | Pass | Fail | 未実施 |
|---|---|---|---|
| 正常系 | 0 | 0 | - |
| 異常系 | 0 | 0 | - |
| 境界値 | 0 | 0 | - |

## 総合進捗
- 実装タスク完了率: 0%（0/15）
- 受入条件達成率: 0%（0/7）

## 作業ログ
- **2026-06-13 14:40** — Gate2 サインオフ実施（engineer/security 並列, Sonnet）。両者 concern・Block/Critical設計欠陥なし。設計書修正6件（①管理者認証の二重ハッシュ廃止=FE平文送信+サーバPBKDF2のみ ②LINE署名の時定数比較MUST ③admin/players の LINE UID 露出抑制 ④replace-season DELETE+INSERT 単一batch ⑤朝通知 quota ガード ⑥game_no UNIQUE複合）を Codex(ft-gate2-fix)へ委託。反映完了→Gate2 approve→垂直スライス着手。
- **2026-06-13 05:52** — SPEC-v1 完成（スケルトン+技術詳細+PM裁定6件）。0001_init.sql / api-contract.md 作成。Gate1（engineer/security）起動。次: Gate1 指摘の裁定 → Gate2
- **2026-06-13 05:41** — 進捗管理表作成。龍偉が案1（D1+Workers）を承認。次: SPEC-v1 スケルトン作成 → Gate1

## 🔀 方向転換・仕様変更ログ
- 2026-06-13 「管理DBから構造を見直す」龍偉指示で v1.0 移行を起案。シート出力は最終フェーズと指定

## 🔁 再開ガイド（/dev-resume がここを最優先で読む）
- **最後にやっていたこと**: 進捗管理表の作成（フェーズ1開始直前）
- **次にやること**: SPEC-v1.md スケルトン作成（PM）→ D1 スキーマ/API契約の肉付け委託 → Gate1 並列レビュー
- **コンテキスト復元コマンド**:
  ```bash
  cd ~/Desktop/ryui-workspace/projects/happinets/family-tickets && git log --oneline -5 && git status --short
  ```
- **ブロッカー・注意点**: 現行 GAS v0.3.0 は稼働継続中（admin.html 新版の html-share 再アップは龍偉の「アップして」待ち）。.env.gas の LINE トークン控えは空欄（Cloudflare には登録済み）
