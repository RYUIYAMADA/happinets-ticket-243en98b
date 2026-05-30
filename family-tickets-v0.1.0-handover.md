---
project: family-tickets
version: 0.1.0
date: 2026-05-30
---

# family-tickets 引継書 v0.1.0
作成日: 2026/05/30
バージョン: 0.1.0

---

## 📌 プロジェクト概要

ハピネッツ選手の家族向け試合チケット申込フォーム・管理画面。
2026年5月ホームゲームから運用開始。

- **公開 URL**: https://ryuiyamada.github.io/happinets-ticket-243en98b/
- **リポジトリ**: https://github.com/RYUIYAMADA/happinets-ticket-243en98b
- **ブランチ**: `main`

---

## 🗂 ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | トップページ・ログイン画面（選手・管理者共通） |
| `player-form.html` | 選手家族用申込フォーム（モバイルファースト） |
| `player-dashboard.html` | 選手ダッシュボード（申込一覧・キャンセル） |
| `admin.html` | 運営管理画面（申込管理・ステータス更新） |
| `gas/` | GAS バックエンド（Google スプレッドシート連携） |
| `SPEC-MASTER.md` | マスター仕様書 v1.0 |
| `SPEC-security-ux.md` | セキュリティ・UX仕様 |
| `SPEC-responsive.md` | レスポンシブ仕様 |

---

## 🏗 システム構成

```
[選手/スタッフ]              [チケット担当/マネージャー]
      │                              │
      ▼                              ▼
 index.html ─── ログイン ───▶ index.html
      │                              │
 player-dashboard.html           admin.html
 player-form.html                    │
      │                              │
      └──────── GAS Web App ─────────┘
                      │
               Google Spreadsheet
```

| レイヤー | 技術 |
|---|---|
| フロントエンド | Static HTML / CSS / JS |
| ホスティング | GitHub Pages |
| バックエンド | Google Apps Script (Web App) |
| DB | Google スプレッドシート |
| CI/CD | GitHub Actions + clasp |

---

## ✅ 実装済み機能

- モバイルファースト最適化（全4画面）
- デザインシステム適合（コントラスト・ARIA・focus-visible）
- GAS warmup + sessionStorage キャッシュ + skeleton loading（ログインラグ改善）
- 選手ID をテキスト形式で保存（先頭ゼロ保持: 006 → "006"）
- 受取方法・駐車場セレクトをフローティングラベル付きに刷新
- 受取者名・特記事項を試合ごと入力に変更
- 家族席に受取人事前登録機能追加
- 日付表記 YYYY/MM/DD 統一
- テストデータ 18件（6試合 × 3種別）
- LINE通知実装に向けた構造準備（gas/ 配下）

---

## 🚧 未実装・残タスク

| # | 内容 | 優先度 |
|---|---|---|
| 1 | 本番 GAS デプロイ設定確認・URL 共有 | 高 |
| 2 | 龍偉による実機5点チェック | 高 |
| 3 | LINE通知実装（GAS の LINE Notify API 連携） | 低 |

---

## 📱 実機5点チェック（龍偉が選手スマホで確認）

次のセッション開始前に下記を確認してください:

- [ ] `index.html` でログインできるか
- [ ] `player-dashboard.html` で申込一覧が表示されるか
- [ ] `player-form.html` で申込が送信できるか
- [ ] `admin.html` で申込一覧・ステータス更新ができるか
- [ ] 前回バグの再現がないか

---

## ❓ 要確認事項

- 2026年5月ホームゲームの具体的な試合日程（GAS データに反映済みか）
- 本番 GAS ウェブアプリ URL の共有

---

## 🔧 起動コマンド

```bash
cd ~/Desktop/ryui-workspace/projects/happinets/family-tickets && claude
```

---

## 📜 更新履歴

- 2026-05-30 15:15 — v0.1.0 初版作成
