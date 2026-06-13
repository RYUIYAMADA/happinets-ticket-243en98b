---
task: "UIデザイン刷新: 予約システム風クリーンUI（白背景+青アクセント+ステップタブ+カード）を全画面へ適用"
project: "family-tickets"
created: "2026-06-13 16:30"
last_updated: "2026-06-13 16:30"
status: in_progress
branch: "main"
progress_pct: 10
---

# UIデザイン刷新（予約システム風）

> 龍偉が予約システム(美容室サロン)のUIスクショ4枚を共有し「このデザインで」と指示。利用者3画面に加え「管理者も同じテイストで」と追加指示 → 全4画面が対象。

## 要件サマリー
- **背景・目的**: 龍偉指定の予約システム風クリーンUI（白基調・ロイヤルブルー #2456E6 アクセント・横並びステップタブ・薄border+薄影カード・カレンダー/リスト型選択・ピル型チップ）に family-tickets のFEを刷新する。
- **対象画面**（龍偉指示で4画面全部）:
  - index.html（トップ）
  - player-form.html（申込フォーム）★基準スライス
  - player-dashboard.html（選手ダッシュボード）
  - admin.html（管理画面）※「管理者も同じテイストで」2026-06-13 追加指示
- **不変条件**: 機能・JS・api-client.js 結線・フォーム項目・バリデーションは変えない（見た目のみ）。CSS値ハードコード禁止（var()）。SP最優先・文字重なり/見切れゼロ。
- **デザイン裁定**: 参考準拠でカードに薄border許容（従来の禁止を本デザインで上書き）。グラデ・glassmorphism・円グラフ・font-weight300以下は禁止維持。
- **デザイントークン正本**: DESIGN.md（player-form スライスで確定 → 全画面共通）

## デザイントークン（DESIGN.md に反映）
- --bg #FFFFFF / --bg-subtle #F5F6F8
- --primary #2456E6 / --primary-strong #1D4FD7 / --primary-weak #EAF0FF
- --accent-line #2563EB / --text #0F172A / --text-sub #64748B / --text-muted #94A3B8
- --required #E5384D / --border #E2E8F0 / --disabled #CBD5E1
- --radius 14(card)/10(input,btn)/999(pill)px / Noto Sans JP・見出し700

## タスク一覧
- 🔄 スライス1: player-form.html 刷新 + DESIGN.md 新トークン確定（ft-ui-form）
- ⬜ プレビュー(Preview MCP)で龍偉確認 → 基準デザイン承認
- ⬜ index.html 展開
- ⬜ player-dashboard.html 展開
- ⬜ admin.html 展開（同テイスト・管理画面の情報密度に合わせ調整）
- ⬜ 全画面 ビジュアルQA（gan-evaluator / accessibility）+ 最長テキストで重なり/見切れ機械検査

## 🔀 方向転換・仕様変更ログ
- 2026-06-13 16:30 — 龍偉が予約システムUIを共有し全FEデザイン刷新を指示。d1-migration の「デザイン刷新は対象外」スコープを龍偉指示で覆す（D1移行のAPI結線は維持したまま見た目のみ刷新）。当初範囲=利用者3画面 → 直後に「管理者も」で admin 追加し4画面に拡大。

## 🔁 再開ガイド
- **最後にやっていたこと**: player-form.html を基準スライスとして参考デザインに刷新中（Codex ft-ui-form）。
- **次にやること**: 完了→プレビュー確認→index/dashboard/admin へ同デザイン展開→全画面QA。
- **注意点**: D1移行(v1.0)はコード完成・wrangler login待ちで別軸進行中。本刷新は api-client 結線を壊さないこと。admin はデザイン刷新対象だが、D1移行の admin 機能(平文ログイン/lineLinked等)は維持。
