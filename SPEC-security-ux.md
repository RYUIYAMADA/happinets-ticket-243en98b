# SPEC-security-ux.md
# 選手家族チケット申込システム セキュリティ・UX 修正仕様
# 作成: 2026-05-11 | senior-engineer

---

## 対象Issue一覧

| # | カテゴリ | 対象ファイル | 優先度 |
|---|---|---|---|
| Issue-1 | 重複申込防止 | player-form.html / Code.gs | 高 |
| Issue-2 | initData認証バイパス修正 | Code.gs | 高（セキュリティ） |
| Issue-3 | ソルト付きパスワードハッシュ | index.html / スプレッドシート | 高（セキュリティ） |
| Issue-4 | 管理者API再検証 | admin.html / Code.gs | 高（セキュリティ） |
| Issue-5 | 外国籍選手向け英語併記 | index.html / player-form.html / player-dashboard.html | 中 |
| Issue-12 | マトリクスビュー複数申込対応 | admin.html | 低 |

---

## Issue-1: 重複申込防止

### 変更ファイル
- `player-form.html`
- `Code.gs`

### player-form.html 変更箇所
submit ボタンのイベントハンドラ（送信処理の先頭）に以下チェックを追加:

```javascript
// submit前 重複チェック（sessionStorage）
const existing = JSON.parse(sessionStorage.getItem('applications') || '[]');
const isDuplicate = existing.some(app =>
  app.gameId === currentGameId &&
  app.ticketType === currentTicketType &&
  app.status !== 'cancelled'
);
if (isDuplicate) {
  showError('この試合・種別はすでに申込済みです。');
  return; // 送信ブロック
}
```

- `currentGameId` / `currentTicketType` はフォームの選択値から取得
- `showError()` は既存のエラー表示関数を使用（なければ新規追加）

### Code.gs 変更箇所
`submitApplication` 関数の先頭（スプレッドシート書き込み前）に重複チェックを追加:

```javascript
// 重複チェック: 同一 playerId × gameId × ticketType（cancelledでない）
const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('applications');
const data = sheet.getDataRange().getValues();
for (let i = 1; i < data.length; i++) {
  if (
    data[i][COL_PLAYER_ID] === playerId &&
    data[i][COL_GAME_ID] === gameId &&
    data[i][COL_TICKET_TYPE] === ticketType &&
    data[i][COL_STATUS] !== 'cancelled'
  ) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: '既にこの種別で申込済みです' })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

- カラムインデックス（COL_*）は既存定数に合わせる

---

## Issue-2: initData認証バイパス修正

### 変更ファイル
- `Code.gs`

### 変更箇所
`doGet` の switch文から `case 'initData':` を完全削除:

```javascript
// 削除対象（以下のブロックごと削除）
case 'initData':
  return initData(); // ← この case ごと削除
```

### 補足
- `initSettings` / `initGames` / `initPlayers` は GAS エディタから手動実行のみ
- doGet 経由での呼び出しは全て不可とする
- 本番稼働後に初期化が必要な場合はGASエディタで直接実行

---

## Issue-3: ソルト付きパスワードハッシュ

### 変更ファイル
- `index.html`
- スプレッドシート（手動更新）

### index.html 変更箇所
ログイン処理のハッシュ計算部分:

```javascript
// 変更前
const hash = await sha256(password);

// 変更後
const SALT = 'hnts2026_';
const hash = await sha256(SALT + password);
```

### Code.gs
`adminLogin` はハッシュ値を受け取るだけなので変更不要。

### 新しいハッシュ値（スプレッドシートに手動設定）

| ロール | パスワード | ソルト付きハッシュ（SHA-256） |
|---|---|---|
| チケット担当 | `1234` | `245bcf738697fd2a395f6ccd445eaff32b08b340098510bad9da528dea7201ae` |
| マネージャー | `manager1234` | `75dba5516e94695ce6c0871d9d41300715b72592b2580591ea013d1375115700` |

計算式: `sha256("hnts2026_" + password)`

### スプレッドシート更新手順
1. `settings` シートの `adminPasswordHash` 行を上記ハッシュ値に更新
2. `settings` シートの `managerPasswordHash` 行を上記ハッシュ値に更新

---

## Issue-4: 管理者API再検証

### 変更ファイル
- `admin.html`
- `Code.gs`

### admin.html 変更箇所

**ログイン成功時に `passwordHash` を sessionStorage に保存:**
```javascript
// adminLogin 成功レスポンス後
sessionStorage.setItem('passwordHash', enteredHash); // ハッシュ値を保存
```

**callGAS POST 呼び出し全てに `passwordHash` を追加:**
```javascript
// 変更前
const params = { action: 'updateStatus', applicationId, status };

// 変更後
const params = {
  action: 'updateStatus',
  applicationId,
  status,
  passwordHash: sessionStorage.getItem('passwordHash')
};
```

対象action（全てに適用）:
- `updateStatus`
- `updateDeadline`
- `updateDeadlineBulk`
- その他管理者専用action全て

### Code.gs 変更箇所

**`verifyAdmin` 関数を追加:**
```javascript
function verifyAdmin(passwordHash) {
  const settings = getSettings(); // 既存のsettings取得関数
  const validHashes = [
    settings.adminPasswordHash,
    settings.managerPasswordHash
  ];
  if (!passwordHash || !validHashes.includes(passwordHash)) {
    throw new Error('認証エラー: 管理者権限がありません');
  }
}
```

**管理者専用action の先頭で呼び出し:**
```javascript
case 'updateStatus':
  verifyAdmin(params.passwordHash); // ← 先頭に追加
  return updateStatus(params);

case 'updateDeadline':
  verifyAdmin(params.passwordHash); // ← 先頭に追加
  return updateDeadline(params);

// 他の管理者actionも同様
```

**エラー時のレスポンス:**
```javascript
// verifyAdmin内でthrowした場合、doPost側でcatch:
} catch (e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: e.message })
  ).setMimeType(ContentService.MimeType.JSON);
}
```

---

## Issue-5: 外国籍選手向け英語併記

### 変更ファイル
- `index.html`
- `player-form.html`
- `player-dashboard.html`

### 共通CSS追加（各ファイルの `<style>` に追記）
```css
.en-sub {
  font-size: 11px;
  color: var(--text-sub);
  display: block;
  font-weight: normal;
}
```

### index.html 変更箇所
タイトル・ラベルへの英語サブテキスト追加:

```html
<!-- 例: タイトル -->
<h1>選手家族チケット申込<span class="en-sub">Player Family Ticket Application</span></h1>

<!-- 例: ログインラベル -->
<label>パスワード<span class="en-sub">Password</span></label>
```

### player-form.html 変更箇所
チケット種別タブ・フォームラベル・ボタンへの追加:

```html
<!-- チケット種別タブ -->
<button class="tab">招待チケット<span class="en-sub">Complimentary</span></button>
<button class="tab">家族割引<span class="en-sub">Family Discount</span></button>
<button class="tab">一般購入<span class="en-sub">General Purchase</span></button>

<!-- フォームラベル例 -->
<label>枚数<span class="en-sub">Number of Tickets</span></label>
<label>備考<span class="en-sub">Notes</span></label>

<!-- ボタン -->
<button type="submit">申込む<span class="en-sub">Submit</span></button>
```

### player-dashboard.html 変更箇所
フィルターボタン・ステータスバッジへの追加:

```html
<!-- フィルターボタン -->
<button class="filter-btn">すべて<span class="en-sub">All</span></button>
<button class="filter-btn">申込済<span class="en-sub">Applied</span></button>
<button class="filter-btn">承認済<span class="en-sub">Approved</span></button>

<!-- ステータスバッジ（既存バッジのdata属性またはテキスト） -->
<!-- 承認済 → "承認済 / Approved" のように併記 -->
```

---

## Issue-12: マトリクスビュー複数申込対応

### 変更ファイル
- `admin.html`

### 変更箇所: `renderMatrix()` 内の `appMap` 構造変更

```javascript
// 変更前: 1エントリに1申込
const appMap = {};
applications.forEach(app => {
  const key = `${app.playerId}_${app.gameId}`;
  appMap[key] = app;
});

// 変更後: 配列で複数申込を保持
const appMap = {};
applications.forEach(app => {
  const key = `${app.playerId}_${app.gameId}`;
  if (!appMap[key]) appMap[key] = [];
  appMap[key].push(app);
});
```

### セル描画変更

```javascript
// 変更前
const app = appMap[key];
cell.textContent = app ? getStatusBadge(app) : '—';

// 変更後
const apps = appMap[key] || [];
if (apps.length === 0) {
  cell.textContent = '—';
} else {
  cell.innerHTML = apps.map(app => getStatusBadge(app)).join('<br>');
}
```

### `getStatusBadge` 関数: 種別バッジを含む形式に更新

```javascript
function getStatusBadge(app) {
  const typeLabel = {
    'invite': '招待',
    'family': '家族',
    'general': '一般'
  }[app.ticketType] || app.ticketType;

  const statusIcon = {
    'approved': '○',
    'pending': '◐',
    'rejected': '×',
    'cancelled': '－'
  }[app.status] || '?';

  return `<span class="badge badge-${app.status}">${typeLabel}:${statusIcon}</span>`;
}
```

### 凡例更新

```html
<!-- 凡例に種別表示を追加 -->
<div class="legend">
  <span>招待:○ = 招待チケット承認済</span>
  <span>家族:◐ = 家族割引申請中</span>
  <span>一般:× = 一般購入否認</span>
  <span>複数バッジ = 同一試合で複数種別申込</span>
</div>
```

---

## 成功基準チェックリスト

### Issue-1 重複申込防止
- [ ] 同一試合×同一種別で2回目の送信ボタン押下時にエラーメッセージが表示される
- [ ] エラー時に実際のPOST送信が発生しない（ブラウザNetworkタブで確認）
- [ ] GAS側でも重複データがスプレッドシートに書き込まれない
- [ ] キャンセル済み申込がある場合は再申込が可能

### Issue-2 initData認証バイパス修正
- [ ] `?action=initData` をURLに付与してGASにアクセスしても404または空レスポンスが返る
- [ ] GASエディタから `initSettings()` 等を手動実行すると正常動作する

### Issue-3 ソルト付きパスワードハッシュ
- [ ] `1234` でチケット担当ロールにログインできる
- [ ] `manager1234` でマネージャーロールにログインできる
- [ ] 旧ハッシュ（ソルトなし）ではログインが失敗する
- [ ] スプレッドシートのハッシュ値が新しい値に更新されている

### Issue-4 管理者API再検証
- [ ] ログイン後、sessionStorageに `passwordHash` が保存されている
- [ ] 有効なpasswordHashなしでupdateStatusを呼ぶと `{ok:false, error:'認証エラー...'}` が返る
- [ ] 正常なpasswordHashでupdateStatusが成功する
- [ ] updateDeadline / updateDeadlineBulk も同様に検証済み

### Issue-5 外国籍選手向け英語併記
- [ ] 全3ファイルで `.en-sub` CSSが適用されている
- [ ] 英語テキストが日本語ラベルの下に小さく表示される
- [ ] モバイル表示でレイアウト崩れがない

### Issue-12 マトリクスビュー複数申込対応
- [ ] 同一選手×同一試合で複数種別を申込んだ場合、セルに複数バッジが縦並びで表示される
- [ ] 1申込のみの場合は従来通り1バッジ表示
- [ ] 凡例が更新されている

---

## 実装上の注意事項

1. **Issue-2とIssue-4は必ずセットで実装**。initData削除後に管理者認証を強化する順序で進める
2. **Issue-3のスプレッドシート更新は実装デプロイ後に即実施**。更新前はログイン不能になる
3. **Issue-4のverifyAdmin**はGASの `try-catch` の外側で呼び出すと500エラーになる。必ずdoPostのtry内で呼ぶ
4. **Issue-5の英語テキスト**はHTMLに直書きでよい（i18n不要）。外国籍選手は限定的なため

---

_SPEC version: 1.0 | 2026-05-11_
