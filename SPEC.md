# セキュリティ修正 v1

## 目標
秋田ノーザンハピネッツ チケット申込システムの認証・API脆弱性を修正。機能変更なし。

## 成功基準
- [ ] Issue-2: gas/Code.gs の case 'initData' ブロック完全削除
- [ ] Issue-3: index.html の sha256呼び出しにソルト 'hnts2026_' 付与
- [ ] Issue-4a: index.html の adminLogin関数に adminPasswordHash をsessionStorageに保存
- [ ] Issue-4b: admin.html に adminPwHash グローバル変数追加・DOMContentLoadedで初期化・callGAS関数にpwHash追加
- [ ] Issue-4c: Code.gs に verifyAdmin関数追加・updateStatus/updateDeadline先頭で呼び出し
- [ ] コミット: git add & push完了

## 非目標
- UI/UX変更
- 機能追加・削除
- その他ファイル修正

## 担当
- 実装: working-engineer（Codex CLI）
- レビュー: PM（修正箇所確認のみ）

## 出力先
- gas/Code.gs
- index.html
- admin.html
- main branch push完了

## 背景
認証バイパス・ハッシュ無ソルト・管理者API無検証の3点脆弱性。
