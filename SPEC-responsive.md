# SPEC.md — 選手家族チケット申込システム レスポンシブ改善

作成日: 2026-05-09 | PM裁定

## 目標
全4ファイル（index.html / player-form.html / player-dashboard.html / admin.html）のレスポンシブ設計完成。スマートフォン（320-480px）→ タブレット（481-768px）→ PC（769px+）の全端末で正常表示・操作可能。

## 成功基準（検証可能）

### 共通（全ファイル）
- [ ] viewport meta: `width=device-width, initial-scale=1.0` 設定済
- [ ] body: `overflow-x: hidden` で横スクロール禁止
- [ ] body: `-webkit-tap-highlight-color: transparent` でタップハイライト除去
- [ ] body: `line-break: strict` 日本語禁則適用
- [ ] 本文: font-size 14px以上
- [ ] ラベル: font-size 12px以上
- [ ] ボタン・リンク・ラジオ・チェックボックス: min-height 44px ∧ min-width 44px
- [ ] 入力欄（input/textarea/select）: font-size 16px以上（iOS Safari ズーム防止）
- [ ] サイドマージン: padding 16px以上

### index.html（ログイン）
- [ ] カード: max-width 420px はPC用。スマホ320px時: padding 32px 20px
- [ ] ラジオボタン行（チケット担当/チームマネージャー）: 320px端末で1行に収まるか確認。収まらなければ縦並び化

### player-form.html（申込フォーム）
- [ ] 3タブ（招待/家族席/有料）: スマホで全タブ見える（font-size ・ padding 確認）
- [ ] ステッパー（−/val/＋）: min-height 44px ∧ min-width 44px
- [ ] セレクトボックス: font-size 16px以上
- [ ] 送信ボタン: width 100% ∧ min-height 48px以上

### player-dashboard.html（マイページ）
- [ ] サマリーカード4枚: スマホ320px で text が収まるか。font-size 調整
- [ ] フィルターボタン行: flex-wrap wrap で折り返しOK
- [ ] ゲームカード内ピル（招待/家族/有料）: flex-wrap wrap で折り返しOK
- [ ] FABボタン（＋新規申込）: bottom 24px; right 20px。safe-area対応 → `padding-bottom: env(safe-area-inset-bottom)`

### admin.html（管理者）
- [ ] ヘッダー（ロゴ+ロールバッジ）: 小さい画面で折り返さない
- [ ] タブナビ（ダッシュボード/申込一覧/締切管理/試合一覧）: スマホでスクロール可能
- [ ] 申込一覧テーブル: `overflow-x: auto` ラッパーで横スクロール対応
- [ ] 試合一覧テーブル（マトリクス）: 横スクロール対応
- [ ] タブレット（768px）: サマリーカード2カラムレイアウト検討

## 非目標
- 機能追加・変更なし
- デザイン色変更・新規コンポーネント追加
- スマートフォンアプリ化

## CSS設計指針

### レスポンシブ戦略
- **モバイルファースト**: デフォルトをスマホ（320px）向けに記述
- **ブレークポイント**:
  - `@media (min-width: 481px)` タブレット（481-768px）
  - `@media (min-width: 769px)` PC（769px+）
- **既存 `@media (max-width: 480px)` がある場合**: 反転してモバイルファースト統一（動作変わらず）

### タッチ操作最適化
- ボタン: `touch-action: manipulation` デフォルト追加（ダブルタップズーム防止）
- タッチターゲット: min-height 44px ∧ min-width 44px 必須

### テーブル対応
- `overflow-x: auto` ラッパーで囲む（横スクロール許容）
- インラインスタイル `white-space: nowrap` で改行禁止

### safe-area（notch・底部セーフエリア）
- FAB・固定ボタン: `padding-bottom: env(safe-area-inset-bottom); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);`

## 出力先
```
/Users/ryuiyamada/Desktop/ryui-workspace/claude-making/選手家族チケット申し込み/
├── index.html                # 修正済
├── player-form.html          # 修正済
├── player-dashboard.html     # 修正済
├── admin.html                # 修正済
└── SPEC-responsive.md        # このファイル
```

## 担当エージェント
| フェーズ | 担当 |
|---|---|
| 実装 | working-engineer via Codex |
| Gate3 品質確認 | qa-reviewer |

## Git コミット
```bash
git add index.html player-form.html player-dashboard.html admin.html
git commit -m "fix: 全画面レスポンシブ設計を改善（スマホ/タブレット対応）"
git push origin main
```

## 修正チェックリスト（Codex実施）

### index.html
- [ ] viewport meta確認
- [ ] カード padding調整（スマホ20px）
- [ ] ラジオボタン行 collapse処理（320px時）
- [ ] body overflow-x hidden追加
- [ ] font-size 14px以上確認

### player-form.html
- [ ] viewport meta確認
- [ ] 3タブ font-size・padding確認
- [ ] ステッパーボタン 44px確認
- [ ] セレクトボックス 16px以上確認
- [ ] 送信ボタン 100%・48px以上確認
- [ ] body overflow-x hidden追加

### player-dashboard.html
- [ ] viewport meta確認
- [ ] サマリーカード font-size調整
- [ ] フィルターボタン flex-wrap wrap確認
- [ ] ゲームカード内ピル flex-wrap wrap確認
- [ ] FABボタン safe-area対応追加
- [ ] body overflow-x hidden追加
- [ ] テーブル overflow-x auto確認

### admin.html
- [ ] viewport meta確認
- [ ] ヘッダー collapse処理確認
- [ ] タブナビ overflow-x auto確認
- [ ] 申込一覧テーブル ラッパー overflow-x auto追加
- [ ] 試合一覧テーブル 横スクロール対応確認
- [ ] body overflow-x hidden追加
- [ ] タブレット（768px）2カラムレイアウト検討
