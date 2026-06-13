---
project: family-tickets
version: 0.1.0
inherits: ryuiyamada-design-system（グローバルDS）
updated: 2026-06-13
---

# DESIGN.md — family-tickets（選手家族チケット申込システム）

> このファイルは Claude Code / Codex が UI を作るとき**毎回最初に読む**設計契約。
> グローバルDS（`~/Desktop/ryui-workspace/projects/tools/ryuiyamada-design-system/`）を継承し、
> **このプロジェクト固有の差分だけ**ここに書く。global と矛盾する時はこのファイルが優先。

---

## 1. このプロダクトは何か

- **何をするものか**: ハピネッツ選手の家族が試合チケットを申し込む専用フォームと、選手・運営それぞれが申込状況を確認・管理する画面群。
- **主な利用者**: 選手の家族（IT操作に不慣れな層を含む）、選手本人、ハピネッツ運営スタッフ
- **利用デバイス/環境**: スマートフォン中心（iOS Safari / Android Chrome）。PCでの管理画面利用あり。
- **言語**: 日本語・英語の2言語対応（player-form.html / player-dashboard.html）
- **トーン**: 予約システム風のクリーンUI。白を基調に、ロイヤルブルーで操作状態を明快に示す。装飾ではなく余白・階層・整列で安心感を出す。

---

## 2. デザイン原則

1. **読む順番が自然であること** — 「上部タブで種別選択 → 直下で受付状況確認 → 下で入力」の視線誘導を崩さない。
2. **白基調 + 青アクティブ** — ベースは白と薄グレー、操作可能/選択中/主要CTAだけをブルーで示す。
3. **タップ優先** — スマホユーザーがメイン。タップターゲット 44px 以上、項目間の余白は 8px グリッドで確保する。
4. **アクセシビリティは義務** — 家族層は高齢者を含む可能性がある。コントラスト・フォントサイズ・フォーカス表示は妥協しない。
5. **変数で統治** — 色・角丸・余白・影は CSS 変数経由。画面内ハードコードを増やさない。

---

## 3. カラートークン（player-form を起点に4画面へ展開する正規値）

```css
:root {
  /* ── Surface ── */
  --bg:               #ffffff;
  --bg-subtle:        #f5f6f8;
  --card:             var(--bg);
  --text-faint:       #94a3b8; /* decorative only, on white 2.56:1 */

  /* ── Action / State ── */
  --primary:          #2456e6;
  --primary-strong:   #1d4fd7;
  --primary-weak:     #eaf0ff;
  --accent-line:      #2563eb;

  /* ── Text ── */
  --text:             #0f172a;
  --text-sub:         #64748b;
  --text-muted:       #667085; /* on white 4.97:1 */

  /* ── Border / Disabled ── */
  --border:           #e2e8f0;
  --disabled:         #cbd5e1;

  /* ── Validation / Status ── */
  --required:         #d11f3a; /* on white 5.29:1 */
  --success:          #166534; /* on --success-bg 6.49:1 */
  --success-bg:       #dcfce7;
  --error:            #dc2626;
  --error-bg:         #fee2e2;
  --warning-bg:       #fef3c7;
  --warning-text:     #0f172a;
  --success-border:   #86efac;
  --overlay-strong:   rgba(0, 0, 0, 0.75);
  --inverse-soft:     rgba(255, 255, 255, 0.16);
  --inverse-border:   rgba(255, 255, 255, 0.2);
  --inverse-stroke:   rgba(255, 255, 255, 0.4);

  /* ── Shape ── */
  --radius-card:      14px;
  --radius-control:   10px;
  --radius-pill:      999px;

  /* ── Space (8px grid base) ── */
  --space-1:          4px;
  --space-2:          8px;
  --space-3:          12px;
  --space-4:          16px;
  --space-5:          20px;
  --space-6:          24px;
  --space-7:          28px;
  --space-8:          32px;

  /* ── Elevation ── */
  --shadow-card:      0 1px 2px rgba(15, 23, 42, 0.06);
}
```

### トークン適用ルール
- `--primary`: アクティブタブ、選択中カード、主要ボタン、フォーカス枠
- `--primary-weak`: 選択済みカード背景、状態チップ背景
- `--accent-line`: 可選択チップ、サブ導線、変更リンク
- `--bg-subtle`: ページ背景、弱い区切り、補助面
- `--required`: `(必須)` 表記専用。赤を強調用途に流用しない
- `--text-faint`: 装飾専用。本文・ラベル・placeholder には使わない

---

## 4. タイポグラフィ

```css
--font-base:    'Noto Sans JP', sans-serif;
--font-heading: 'Noto Sans JP', sans-serif;
```

| 用途 | font-size | font-weight | 備考 |
|---|---|---|---|
| ページ見出し（h1） | 1.125rem〜1.5rem | 700 | モバイルでは詰めずに中央配置可 |
| セクション見出し（h2/h3） | 1.5rem〜1.75rem | 700 | 予約フォームの主見出し |
| STEPラベル | 0.75rem〜0.8125rem | 700 | `letter-spacing: 0.08em` / `text-transform: uppercase` |
| 本文 | 0.9375rem〜1rem | 500 以上 | 300以下禁止、400も最小限 |
| ラベル・補足 | 0.8125rem〜0.875rem | 500〜600 | 必須や注意文もここ |
| ボタン | 0.9rem〜1rem | 600〜700 | |

- font-weight 300 以下の使用禁止（細すぎてモバイルで読めない）
- 日本語テキストは文節改行・禁則処理を適用（`overflow-wrap: anywhere; word-break: keep-all;`）

---

## 5. レイアウト規約

- **最大幅**: フォーム・カード系は `max-width: 720px`、管理画面は `max-width: 1200px`
- **グリッド**: 8px グリッド基準。4px 補助刻みを許可
- **ブレークポイント**: `768px`（スマホ/PC の境界）
- **情報密度**: ゆったり。フォームは「セクション見出し → 説明 → 入力群 → 送信」を1束で見せる
- **レイアウト基準**: ヘッダは「戻る + 中央タイトル」、種別切替は横スクロール可能なピルタブ

---

## 6. 禁止ルール（anti-pattern・最重要）

| 禁止 | 理由 |
|---|---|
| **CSS 値のハードコード**（色・角丸・余白） | トークン運用が崩壊する。必ず `var()` を使う |
| **グラデーション** | ハピネッツブランドはフラットデザイン。グラデーションは安っぽく見える |
| **glassmorphism（backdrop-filter: blur 等）** | モバイル描画コストが高い。古く見える |
| **太い枠線・強い影** | 予約UIの軽さが消える。枠は `1px var(--border)`、影は `--shadow-card` まで |
| **円グラフ** | 数値比較に不向き。棒グラフ・数値カードを使う |
| **font-weight 300 以下** | スマホ・高齢者層で視認性が著しく低下する |
| **1画面に primary ボタンを複数配置** | ユーザーが迷う。主アクションは必ず1つに絞る |
| **黒・ピンク・ゴールドの旧ブランド配色を混在** | 今回の垂直スライス基準から外れる。次画面も白/青系に揃える |

### カード border 許容の理由
- 旧ルールではカード border 禁止だったが、今回の予約システム風UIでは「白背景の面を背景から静かに分離する」ために `1px solid var(--border)` を許容する。
- ただし許容されるのは薄枠のみ。情報を強調したい場合も色ベタや太枠ではなく、`--primary-weak` 背景 + `--primary` 枠で制御する。

---

## 7. インタラクション規範

- **タップターゲット**: 最小 44×44px（ボタン・チェックボックス・リンクすべて）
- **フォーカス表示**: `:focus-visible` で明示的なアウトラインを必須とする（ブラウザデフォルトを消さない）
- **コントラスト比**: テキスト 4.5:1 以上 / UI 要素・アイコン 3:1 以上（WCAG 2.1 AA）
- **エラー表示**: `--error` / `--error-bg` を使い、色だけでなく文字でもエラー内容を示す
- **長文耐性**: 氏名・対戦相手名・座席名は折返し前提。省略記号で情報を隠さない

---

## 8. コンポーネント規約

### 8.1 上部ステップタブ
- 横並びピル。アクティブは `--primary` 塗り + 白文字
- 非アクティブは透明背景 + `--text-sub` 文字
- モバイルで横スクロール可。ステップ数は画面構造に従い増減してよい

### 8.2 カード
- 白背景、`--radius-card`、`1px solid var(--border)`、`box-shadow: var(--shadow-card)`
- タイトル、説明、入力群の順で縦積み

### 8.3 選択肢カード
- ラジオ/疑似ラジオの行カードとして使う
- 選択中は `2px solid var(--primary)` + `--primary-weak` 背景 + 右端チェック
- 金額や状態を右寄せで置いてよい

### 8.4 入力欄
- ラベルは上、必須は赤い `(必須)` か `*`
- 枠は `1px solid var(--border)`、フォーカス時は `--primary`
- placeholder は `--text-muted`

### 8.5 試合選択/予約行
- カレンダー表現より、現構造では「試合ごとの予約カード」を優先
- 日付、対戦相手、期限、数量、受取方法を1カード内で完結させる
- チップや当日受取トグルは `--accent-line` 枠のピル

### 8.6 主要ボタン
- `--primary` 塗り、白文字、`--radius-control`
- 高さ48px以上、横幅いっぱい

---

## 9. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| `background: var(--primary); color: var(--bg);` でアクティブ状態を示す | `background: #2456E6;` を直書きする |
| カードに `1px solid var(--border)` + `box-shadow: var(--shadow-card)` を使う | 境界を消して白面が背景に埋もれる、または太枠で硬くする |
| ボタンラベルは「申し込む」「確認する」など動詞で完結させる | ボタンラベルを「こちら」「OK」など曖昧な表現にする（非IT層が迷う）|
| フォームエラーは `--error-bg` + `--error` + 日本語メッセージで表示する | エラーを色だけ（赤枠）で示す（色覚特性のあるユーザーが判別できない）|
| 長い氏名や座席名を折返して見せる | `white-space: nowrap` や固定高で文字を切る |

---

## 10. AI（Claude/Codex）への指示

- UI 実装前に必ずこのファイルとグローバル DS を読む
- トークンは変数参照（素の値禁止）。§6 の禁止ルールに違反したら自己修正
- 「読む負担を感じさせない、みてわかるレイアウト」を全画面のデフォルト前提にする
- スマホ優先（mobile-first CSS）。PC レイアウトは 768px 以上のメディアクエリで拡張
- 日英2言語対応ページ（player-form / player-dashboard）では文字長の差を考慮してレイアウトを組む
- player-form で定義したステップタブ/カード/予約行カードを index / player-dashboard の基準部品として扱う
- 迷ったら §2 デザイン原則で判断。それでも決まらなければ実装を止めて PM に質問

---

## 📜 更新履歴

- 2026-06-13 — player-form 垂直スライス向けに予約システム風クリーンUIへ更新。白/青トークン、カード薄枠許容、ステップタブ/予約カード規約を追加
- 2026-06-13 — 初版。4画面 `:root` から共通トークンを抽出・差異を統一、禁止ルール・do/don't を制定
