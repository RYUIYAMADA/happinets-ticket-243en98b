// =====================================================
// 選手家族チケット申込システム — GAS Web App バックエンド
// =====================================================

const SS_ID = ''; // デプロイ後にSpreadsheetIDを設定（空白=アクティブSSを使用）

// =====================================================
// LINE設定（トークンはPropertiesServiceで管理）
// GASエディタ → プロジェクト設定 → スクリプトプロパティ に以下を登録:
//   LINE_CHANNEL_ACCESS_TOKEN : チャンネルアクセストークン（長期）
// =====================================================
function getLineToken() {
  return PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';
}

// シート名（日本語）
const SHEET_PLAYERS  = '選手・スタッフ';
const SHEET_GAMES    = '試合日程';
const SHEET_SETTINGS = '設定';
const SHEET_INVITE   = '招待チケット';
const SHEET_FAMILY   = '家族席';
const SHEET_PAID     = '有料チケット';

// チケット種別 → シート名マッピング
const TICKET_SHEET = {
  invite: SHEET_INVITE,
  family: SHEET_FAMILY,
  paid:   SHEET_PAID
};

function getSpreadsheet() {
  return SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = createSheet(name);
  return sheet;
}

// =====================================================
// doGet — データ取得API
// =====================================================
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  let result;
  try {
    switch (action) {
      case 'getGames':
        result = { ok: true, data: getGames() };
        break;
      case 'getApplications':
        const pid = e.parameter.playerId;
        if (!pid) throw new Error('playerId required');
        verifyPlayerSession(e.parameter.sessionToken, pid);
        result = { ok: true, data: getApplicationsByPlayer(pid) };
        break;
      case 'getAllApplications':
        // 管理者トークン認証（P0: 必須）
        const adminTokenAll = e.parameter.adminToken;
        const storedTokenAll = PropertiesService.getScriptProperties().getProperty('ADMIN_API_TOKEN');
        if (!storedTokenAll || adminTokenAll !== storedTokenAll) {
          throw new Error('unauthorized');
        }
        result = { ok: true, data: getAllApplications() };
        break;
      case 'getPlayers':
        // 管理者トークン認証（P0: 必須）
        const adminTokenPlayers = e.parameter.adminToken;
        const storedTokenPlayers = PropertiesService.getScriptProperties().getProperty('ADMIN_API_TOKEN');
        if (!storedTokenPlayers || adminTokenPlayers !== storedTokenPlayers) {
          throw new Error('unauthorized');
        }
        result = { ok: true, data: getPlayers() };
        break;
      case 'getLineStats': {
        const adminTokenStats = e.parameter.adminToken;
        const storedTokenStats = PropertiesService.getScriptProperties().getProperty('ADMIN_API_TOKEN');
        if (!storedTokenStats || adminTokenStats !== storedTokenStats) {
          throw new Error('unauthorized');
        }
        result = { ok: true, data: getLineStats() };
        break;
      }
      case 'adminSetup': {
        const tok = e.parameter.adminToken;
        const stored = PropertiesService.getScriptProperties().getProperty('ADMIN_API_TOKEN');
        if (!stored || tok !== stored) throw new Error('unauthorized');
        const task = e.parameter.task;
        if (task === 'setRichMenuImageBase64') {
          setRichMenuImageBase64_RUNONCE();
          result = { ok: true, done: 'setRichMenuImageBase64' };
        } else if (task === 'createRichMenu') {
          createRichMenu_RUNONCE();
          const rid = PropertiesService.getScriptProperties().getProperty('LINE_RICH_MENU_ID');
          result = { ok: true, done: 'createRichMenu', richMenuId: rid };
        } else if (task === 'uploadRichMenuImage') {
          const rid2 = e.parameter.richMenuId || PropertiesService.getScriptProperties().getProperty('LINE_RICH_MENU_ID');
          uploadRichMenuImage_RUNONCE(rid2);
          result = { ok: true, done: 'uploadRichMenuImage' };
        } else if (task === 'setupDailyTrigger') {
          setupDailyTrigger_RUNONCE();
          result = { ok: true, done: 'setupDailyTrigger' };
        } else if (task === 'setBase64Chunk') {
          const chunkIdx = parseInt(e.parameter.chunk || '0', 10);
          const total = parseInt(e.parameter.total || '1', 10);
          const data = e.parameter.data || '';
          PropertiesService.getScriptProperties().setProperty('RICH_MENU_B64_CHUNK_' + chunkIdx, data);
          if (chunkIdx === total - 1) {
            var assembled = '';
            for (var ci = 0; ci < total; ci++) {
              assembled += PropertiesService.getScriptProperties().getProperty('RICH_MENU_B64_CHUNK_' + ci) || '';
            }
            PropertiesService.getScriptProperties().setProperty('RICH_MENU_IMAGE_BASE64', assembled);
            for (var di = 0; di < total; di++) {
              PropertiesService.getScriptProperties().deleteProperty('RICH_MENU_B64_CHUNK_' + di);
            }
            result = { ok: true, done: 'assembled', len: assembled.length };
          } else {
            result = { ok: true, done: 'chunk_saved', chunk: chunkIdx };
          }
        } else if (task === 'createRichMenuDirect') {
          const lineToken = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
          if (!lineToken) { result = { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN not set' }; break; }
          const menuBody = {
            size: { width: 2500, height: 843 }, selected: true,
            name: 'ハピネッツ家族チケット', chatBarText: 'チケットメニュー',
            areas: [
              { bounds: { x: 0, y: 0, width: 1250, height: 843 },
                action: { type: 'uri', uri: 'https://app-five-pi-50.vercel.app/api/serve/hnts-player-form', label: 'チケット申込' } },
              { bounds: { x: 1250, y: 0, width: 1250, height: 843 },
                action: { type: 'uri', uri: 'https://app-five-pi-50.vercel.app/api/serve/hnts-player-dashboard', label: '申込確認' } }
            ]
          };
          const cr = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + lineToken, 'Content-Type': 'application/json' },
            payload: JSON.stringify(menuBody), muteHttpExceptions: true
          });
          const crCode = cr.getResponseCode();
          const crBody = JSON.parse(cr.getContentText());
          if (crCode !== 200) { result = { ok: false, error: crBody }; break; }
          const rid = crBody.richMenuId;
          PropertiesService.getScriptProperties().setProperty('LINE_RICH_MENU_ID', rid);
          // 画像アップロード
          const b64 = PropertiesService.getScriptProperties().getProperty('RICH_MENU_IMAGE_BASE64');
          if (b64) {
            const imgBlob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'rich-menu.png');
            UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + rid + '/content', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + lineToken, 'Content-Type': 'image/png' },
              payload: imgBlob.getBytes(), muteHttpExceptions: true
            });
          }
          // デフォルト設定
          UrlFetchApp.fetch('https://api.line.me/v2/bot/user/all/richmenu/' + rid, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + lineToken }, muteHttpExceptions: true
          });
          result = { ok: true, done: 'createRichMenuDirect', richMenuId: rid };
        } else {
          result = { ok: false, error: 'unknown task: ' + task };
        }
        break;
      }
      default:
        result = { ok: false, error: 'unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
// doPost — 書き込みAPI
// =====================================================
function doPost(e) {
  let body;
  let result;
  try {
    body = JSON.parse(e.postData.contents);

    // LINE Webhook — X-Line-Signature による検証が本来の方式
    // GAS はリクエストヘッダーを読めないため、body.events の有無で LINE からのリクエストか判定

    // LINE Webhook は body.events 配列を持つ → 専用ハンドラへ振り分け
    if (body.events && Array.isArray(body.events)) {
      // LINE_WEBHOOK_SECRET チェック（LINE の再送ループを避けるため不一致でも 200 相当を返す）
      const expectedSecret = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_SECRET');
      if (!expectedSecret || e.parameter.whsec !== expectedSecret) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      handleLineWebhook(body.events);
      return ContentService.createTextOutput('OK');
    }

    const action = body.action || '';
    switch (action) {
      case 'login':
        result = { ok: true, data: login(body.playerId) };
        break;
      case 'adminLogin':
        result = { ok: true, data: adminLogin(body.passwordHash) };
        break;
      case 'submitApplication':
        verifyPlayerSession(body.sessionToken, body.playerId);
        result = { ok: true, data: submitApplication(body) };
        break;
      case 'cancelApplication':
        verifyPlayerSession(body.sessionToken, body.playerId);
        result = { ok: true, data: cancelApplication(body.applicationId, body.playerId) };
        break;
      case 'updateDeadline':
        verifyAdmin(body.pwHash);
        result = { ok: true, data: updateDeadline(body.gameId, body.deadline) };
        break;
      case 'updateStatus':
        verifyAdmin(body.pwHash);
        result = { ok: true, data: updateStatus(body.applicationId, body.status) };
        break;
      case 'initData':
        verifyAdmin(body.pwHash);
        result = { ok: true, data: initData() };
        break;
      case 'adminSetupPost': {
        const stored = PropertiesService.getScriptProperties().getProperty('ADMIN_API_TOKEN');
        if (!stored || body.adminToken !== stored) throw new Error('unauthorized');
        if (body.task === 'setRichMenuImageBase64') {
          PropertiesService.getScriptProperties().setProperty('RICH_MENU_IMAGE_BASE64', body.base64);
          result = { ok: true, done: 'setRichMenuImageBase64', len: body.base64.length };
        } else {
          result = { ok: false, error: 'unknown task' };
        }
        break;
      }
      default:
        result = { ok: false, error: 'unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
// 認証
// =====================================================
function login(playerId) {
  const sheet = getSheet(SHEET_PLAYERS);
  const data = sheet.getDataRange().getValues();
  // 数値・ゼロ埋め両方に対応（例: 6 == "006"）
  const norm = s => String(parseInt(s, 10));
  for (let i = 1; i < data.length; i++) {
    if (norm(data[i][0]) === norm(playerId)) {
      // セッショントークン発行（TTL: 6時間）
      var token = Utilities.getUuid();
      CacheService.getScriptCache().put('SESS_' + token, norm(data[i][0]), 21600);
      return { playerId: norm(data[i][0]), name: data[i][1], role: 'player', sessionToken: token };
    }
  }
  throw new Error('番号が見つかりません');
}

// 選手セッショントークン検証（playerId と一致しない場合は例外）
function verifyPlayerSession(token, playerId) {
  if (!token) throw new Error('unauthorized');
  var stored = CacheService.getScriptCache().get('SESS_' + token);
  if (!stored || String(stored) !== String(parseInt(playerId, 10))) throw new Error('unauthorized');
}

function verifyAdmin(pwHash) {
  if (!pwHash) throw new Error('認証情報がありません');
  const sheet = getSheet(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'admin_password_hash' && data[i][1] === pwHash) return true;
  }
  throw new Error('この操作にはチケット担当者権限が必要です');
}

function adminLogin(passwordHash) {
  const sheet = getSheet(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'admin_password_hash' && data[i][1] === passwordHash) {
      return { role: 'admin', adminRole: 'ticket' };
    }
    if (data[i][0] === 'manager_password_hash' && data[i][1] === passwordHash) {
      return { role: 'admin', adminRole: 'manager' };
    }
  }
  throw new Error('管理者認証失敗');
}

// =====================================================
// 試合データ
// =====================================================
function getGames() {
  const sheet = getSheet(SHEET_GAMES);
  const data = sheet.getDataRange().getValues();
  const games = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    games.push({
      gameId: row[0],
      date: row[1],
      dayOfWeek: row[2],
      opponent: row[3],
      deadline: row[4] ? Utilities.formatDate(new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
      isDeadlinePassed: row[4] ? new Date(row[4]) < new Date() : false
    });
  }
  return games;
}

function updateDeadline(gameId, deadline) {
  const sheet = getSheet(SHEET_GAMES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(gameId)) {
      sheet.getRange(i + 1, 5).setValue(deadline ? new Date(deadline) : '');
      return { updated: true };
    }
  }
  throw new Error('試合が見つかりません: ' + gameId);
}

// =====================================================
// 申込（招待チケット・家族席・有料チケット 3シート分散）
// =====================================================

// 3申込シート共通ヘッダー
// 列: 申込ID(0) 選手番号(1) 選手名(2) 試合(3) 枚数大人(4) 枚数子ども(5) 枚数乳幼児(6)
//     席種(7) 座席希望(8) 受取者氏名(9) 受取方法(10) 支払方法(11) 駐車場台数(12)
//     備考(13) 申込日時(14) ステータス(15) 試合ID＊(16)←システム用・最終列
const APP_HEADERS = [
  '申込ID', '選手番号', '選手名', '試合',
  '枚数（大人）', '枚数（子ども）', '枚数（乳幼児）',
  '席種', '座席希望', '受取者氏名', '受取方法', '支払方法',
  '駐車場台数', '備考', '申込日時', 'ステータス', '試合ID＊'
];

// 試合ラベル生成: "10月10日（土）vs 琉球"
function buildGameLabel(game) {
  const d = new Date(game.date);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return m + '月' + day + '日（' + game.dayOfWeek + '）vs ' + game.opponent;
}

// 選手名取得
function getPlayerNameById(playerId) {
  const sheet = getSheet(SHEET_PLAYERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(playerId)) return data[i][1];
  }
  return String(playerId);
}

function submitApplication(body) {
  const gameId     = body.gameId;
  const playerId   = body.playerId;
  const ticketType = body.ticketType;

  if (!TICKET_SHEET[ticketType]) throw new Error('不正なチケット種別: ' + ticketType);

  // 期限チェック（ロック取得前に実行可能な前処理）
  const games = getGames();
  const game = games.find(g => String(g.gameId) === String(gameId));
  if (!game) throw new Error('試合が見つかりません');
  if (game.isDeadlinePassed) throw new Error('申込期限を過ぎています');

  // 排他ロック（重複チェック〜appendRow を保護）
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 重複チェック（同種別シート内）
    const existing = getApplicationsByPlayer(playerId).find(
      a => String(a.gameId) === String(gameId) && a.ticketType === ticketType && a.status !== 'cancelled'
    );
    if (existing) throw new Error('この試合・種別は既に申込済みです');

    const sheet = getSheet(TICKET_SHEET[ticketType]);
    const appId = 'APP-' + new Date().getTime();
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    const playerName = getPlayerNameById(playerId);
    const gameLabel  = buildGameLabel(game);

    sheet.appendRow([
      appId,
      playerId,
      playerName,
      gameLabel,
      body.quantityAdult   || 0,
      body.quantityChild   || 0,
      body.quantityInfant  || 0,
      body.seatType        || '',
      body.seatRequest     || '',
      body.receiverName    || '',
      body.pickupMethod    || '',
      body.paymentMethod   || '',
      body.parkingCount    || 0,
      body.note            || '',
      now,
      '確認中',
      gameId
    ]);
    applyStatusDropdown(sheet, sheet.getLastRow());
    return { applicationId: appId };
  } finally {
    lock.releaseLock();
  }
}

// 日本語→英語マッピング（スプレッドシートは日本語、APIは英語キーで通信）
const STATUS_JP_TO_EN = { '確認中': 'pending', '確保済み': 'confirmed', '対応不可': 'rejected', 'キャンセル': 'cancelled' };
const STATUS_EN_TO_JP = { pending: '確認中', confirmed: '確保済み', rejected: '対応不可', cancelled: 'キャンセル' };

function updateStatus(applicationId, status) {
  if (!['pending', 'confirmed', 'rejected', 'cancelled'].includes(status)) {
    throw new Error('不正なステータス: ' + status);
  }
  const jpStatus = STATUS_EN_TO_JP[status] || status;
  const statusLabel = { pending:'確認中', confirmed:'確保済み', rejected:'対応不可', cancelled:'キャンセル' };

  for (const sheetName of [SHEET_INVITE, SHEET_FAMILY, SHEET_PAID]) {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === applicationId) {
        sheet.getRange(i + 1, 16).setValue(jpStatus); // col16 = ステータス（日本語）

        // ===== LINE通知（トークン設定後に有効化）=====
        const playerId  = data[i][1];
        const gameLabel = data[i][3]; // 試合名
        const players   = getPlayers();
        const player    = players.find(p => String(p.playerId) === String(playerId));
        if (player && player.lineUserId) {
          const msg = `【チケット申込 更新通知】\n` +
                      `試合: ${gameLabel}\n` +
                      `ステータス: ${statusLabel[status] || jpStatus}\n` +
                      `秋田ノーザンハピネッツ チケット担当`;
          sendLineMessage(player.lineUserId, msg);
        }
        // ============================================

        return { updated: true };
      }
    }
  }
  throw new Error('申込が見つかりません');
}

// 申込キャンセル（選手本人のみ実行可。doPost で sessionToken 検証済み）
function cancelApplication(applicationId, playerId) {
  for (const sheetName of [SHEET_INVITE, SHEET_FAMILY, SHEET_PAID]) {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] !== applicationId) continue;
      // 申込の playerId と要求者が一致するか確認
      if (String(data[i][1]) !== String(parseInt(playerId, 10)) &&
          String(data[i][1]) !== String(playerId)) {
        throw new Error('unauthorized');
      }
      sheet.getRange(i + 1, 16).setValue('キャンセル');
      // 更新後の申込オブジェクトを返す
      const updated = data[i].slice();
      updated[15] = 'キャンセル';
      // ticketType を逆引き
      const typeMap = {};
      typeMap[SHEET_INVITE] = 'invite';
      typeMap[SHEET_FAMILY] = 'family';
      typeMap[SHEET_PAID]   = 'paid';
      return rowToApplication(updated, typeMap[sheetName]);
    }
  }
  throw new Error('application not found');
}

function getApplicationsByPlayer(playerId) {
  const apps = [];
  for (const [type, sheetName] of Object.entries(TICKET_SHEET)) {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) !== String(playerId)) continue;
      apps.push(rowToApplication(data[i], type));
    }
  }
  return apps;
}

function getAllApplications() {
  const apps = [];
  for (const [type, sheetName] of Object.entries(TICKET_SHEET)) {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      apps.push(rowToApplication(data[i], type));
    }
  }
  return apps;
}

function rowToApplication(row, ticketType) {
  // games シートから gameId に対応するラベルを生成
  var gameLabel = row[3] || ''; // col4 = 試合（ラベル文字列）がシートに保存済み
  try {
    var gameId = row[16];
    if (gameId) {
      var games = getGames();
      var found = games.find(function(g) { return String(g.gameId) === String(gameId); });
      if (found) gameLabel = buildGameLabel(found);
    }
  } catch (e) { /* フォールバック: col4 の値をそのまま使う */ }

  return {
    applicationId: row[0],
    playerId:      row[1],
    gameId:        row[16], // 最終列（システム用）
    gameLabel:     gameLabel,
    ticketType:    ticketType,
    quantityAdult: row[4],
    quantityChild: row[5],
    quantityInfant:row[6],
    seatType:      row[7],
    seatRequest:   row[8],
    receiverName:  row[9],
    pickupMethod:  row[10],
    paymentMethod: row[11],
    parkingCount:  row[12],
    note:          row[13],
    createdAt:     row[14],
    status:        STATUS_JP_TO_EN[row[15]] || row[15] || 'pending'
  };
}

function getPlayers() {
  const sheet = getSheet(SHEET_PLAYERS);
  const data = sheet.getDataRange().getValues();
  const players = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    players.push({
      playerId:   data[i][0],
      name:       data[i][1],
      lineUserId: data[i][2] || '' // col3: LINE ユーザーID（友だち追加時に自動登録）
    });
  }
  return players;
}

// 選手シートにLINE IDを保存（友だち追加・背番号登録時に呼ぶ）
function saveLineUserId(playerId, lineUserId) {
  const sheet = getSheet(SHEET_PLAYERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(parseInt(playerId, 10)) ||
        String(data[i][0]) === String(playerId)) {
      sheet.getRange(i + 1, 3).setValue(lineUserId);
      return true;
    }
  }
  return false; // 選手番号が見つからない
}

// =====================================================
// LINE Webhook ハンドラ（チャットボット本体）
// =====================================================
function handleLineWebhook(events) {
  events.forEach(ev => {
    try {
      processLineEvent(ev);
    } catch (e) {
      if (ev.source && ev.source.userId) {
        sendLineMessage(ev.source.userId, 'エラーが発生しました。もう一度お試しください。');
      }
    }
  });
}

// LINE push通知送信（updateStatusから呼ぶ）
function sendLineMessage(lineUserId, text) {
  const token = getLineToken();
  if (!token || !lineUserId) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text: text }]
    }),
    muteHttpExceptions: true
  });
}

// =====================================================
// LINE統計
// =====================================================
function getLineStats() {
  const token = getLineToken();
  if (!token) {
    return { quota: 200, used: 0, remaining: 200, note: 'LINE未設定' };
  }
  const headers = { Authorization: 'Bearer ' + token };
  const quotaRes = JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota', { headers }).getContentText());
  const usedRes  = JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers }).getContentText());
  const quota    = quotaRes.value || 200;
  const used     = usedRes.totalUsage || 0;
  return { quota, used, remaining: quota - used };
}

// =====================================================
// 初期データ投入
// =====================================================
function initData() {
  initGames();
  initSettings();
  initSamplePlayers();
  return { message: '初期データ投入完了' };
}

function initGames() {
  const sheet = getSheet(SHEET_GAMES);
  sheet.clearContents();
  sheet.appendRow(['試合ID', '日付', '曜日', '対戦相手', '申込期限']);

  const games = [
    ['G01', '2026-10-10', '土', '琉球'],
    ['G02', '2026-10-11', '日', '琉球'],
    ['G03', '2026-10-17', '土', '島根'],
    ['G04', '2026-10-18', '日', '島根'],
    ['G05', '2026-10-24', '土', '千葉J'],
    ['G06', '2026-10-25', '日', '千葉J'],
    ['G07', '2026-11-07', '土', '群馬'],
    ['G08', '2026-11-08', '日', '群馬'],
    ['G09', '2026-11-14', '土', '横浜BC'],
    ['G10', '2026-11-15', '日', '横浜BC'],
    ['G11', '2026-11-28', '土', '名古屋D'],
    ['G12', '2026-11-29', '日', '名古屋D'],
    ['G13', '2026-12-05', '土', '仙台'],
    ['G14', '2026-12-06', '日', '仙台'],
    ['G15', '2026-12-19', '土', '三河'],
    ['G16', '2026-12-20', '日', '三河'],
    ['G17', '2027-01-09', '土', 'FE名古屋'],
    ['G18', '2027-01-10', '日', 'FE名古屋'],
    ['G19', '2027-01-23', '土', '川崎'],
    ['G20', '2027-01-24', '日', '川崎'],
    ['G21', '2027-01-30', '土', 'A東京'],
    ['G22', '2027-01-31', '日', 'A東京'],
    ['G23', '2027-02-13', '土', '大阪'],
    ['G24', '2027-02-14', '日', '大阪'],
    ['G25', '2027-02-27', '土', '茨城'],
    ['G26', '2027-02-28', '日', '茨城'],
    ['G27', '2027-03-13', '土', 'A千葉'],
    ['G28', '2027-03-14', '日', 'A千葉'],
    ['G29', '2027-04-03', '土', '京都'],
    ['G30', '2027-04-04', '日', '京都'],
  ];
  games.forEach(g => sheet.appendRow([...g, '']));
}

function initSettings() {
  const sheet = getSheet(SHEET_SETTINGS);
  sheet.clearContents();
  sheet.appendRow(['キー', '値']);
  // ADMIN_PW_HASH は Script Properties から読む。未設定時は空のまま（壊れた値を書き込まない）
  const adminHash   = PropertiesService.getScriptProperties().getProperty('ADMIN_PW_HASH') || '';
  const managerHash = PropertiesService.getScriptProperties().getProperty('MANAGER_PW_HASH') || '';
  sheet.appendRow(['admin_password_hash',   adminHash]);
  sheet.appendRow(['manager_password_hash', managerHash]);
}

function initSamplePlayers() {
  const sheet = getSheet(SHEET_PLAYERS);
  sheet.clearContents();
  // 選手番号列をテキスト形式に設定（006が6に変換されるのを防ぐ）
  sheet.getRange(1, 1, 1000, 1).setNumberFormat('@');
  sheet.appendRow(['選手番号', '氏名', 'LINE ID']);
  const members = [
    ['001', '#1 Jamel McLean'],
    ['002', '#2 栗原翼'],
    ['005', '#5 田口成浩'],
    ['006', '#6 赤穂雷太'],
    ['007', '#7 堀田 尚秀'],
    ['010', '#10 Yanni Wetzell'],
    ['011', '#11 内藤晴樹'],
    ['012', '#12 元田大陽'],
    ['013', '#13 小川瑛次郎'],
    ['014', '#14 菅原暉'],
    ['015', '#15 Tanner Leissner'],
    ['017', '#17 中山拓哉'],
    ['018', '#18 岩屋 頼'],
    ['022', '#22 Ali Mezher'],
    ['024', '#24 高比良寛治'],
    ['025', '#25 Keanu Pinder'],
    ['027', '#27 Angelo Chol'],
    ['077', '#77 土屋アリスター時生'],
    ['091', '野口侑真'],
    ['092', 'イゴール・スヴェトリシック'],
    ['093', 'アブドゥレイ・トラオレ'],
    ['094', '前田顕蔵'],
    ['101', 'HC Mick Downer'],
    ['102', 'AC 庄司和広'],
    ['103', 'AC 奈良篤人'],
    ['104', 'VC 守屋健次郎'],
    ['105', 'VC 竹田暁'],
    ['106', 'SC 大塚健吾'],
    ['107', 'AT 飯田瑶美'],
    ['108', 'AT 岡本育'],
    ['109', 'CM 小高行雄'],
    ['110', 'Mg 緑川樹'],
    ['111', 'Mg 北野陽菜'],
  ];
  // setValueで1セルずつ書くことでテキスト形式を確実に維持
  members.forEach((m, idx) => {
    const row = idx + 2;
    sheet.getRange(row, 1).setNumberFormat('@').setValue(m[0]);
    sheet.getRange(row, 2).setValue(m[1]);
  });
}

// =====================================================
// シート自動作成（日本語ヘッダー）
// =====================================================
function createSheet(name) {
  const ss = getSpreadsheet();
  const sheet = ss.insertSheet(name);
  switch (name) {
    case SHEET_PLAYERS:
      sheet.appendRow(['選手番号', '氏名', 'LINE ID']);
      break;
    case SHEET_GAMES:
      sheet.appendRow(['試合ID', '日付', '曜日', '対戦相手', '申込期限']);
      break;
    case SHEET_INVITE:
    case SHEET_FAMILY:
    case SHEET_PAID:
      sheet.appendRow(APP_HEADERS);
      break;
    case SHEET_SETTINGS:
      sheet.appendRow(['キー', '値']);
      break;
  }
  return sheet;
}

// =====================================================
// テストデータ初期化（GASエディタから手動実行）
// =====================================================
function initTestData() {
  const now = '2026-10-01 09:00:00';
  const inviteSheet = getSheet(SHEET_INVITE);
  const familySheet = getSheet(SHEET_FAMILY);
  const paidSheet   = getSheet(SHEET_PAID);

  // 既存テストデータ（APP-T*）削除
  for (const sheet of [inviteSheet, familySheet, paidSheet]) {
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).startsWith('APP-T')) sheet.deleteRow(i + 1);
    }
  }

  // ===== 招待チケット（9件）=====
  // 申込ID, 選手番号, 選手名, 試合, 大人, 子, 乳幼児, 席種, 座席希望, 受取者, 受取方法, 支払方法, 駐車場, 備考, 申込日時, ステータス, 試合ID＊
  inviteSheet.appendRow(['APP-T01','101','HC Mick Downer',  '10月10日（土）vs 琉球',3,0,0,'','','Downer Sarah',  'pre','',0,'妻と両親',         now,'確保済み','G01']);
  inviteSheet.appendRow(['APP-T02','101','HC Mick Downer',  '10月11日（日）vs 琉球',2,0,0,'','','Downer Sarah',  'day','',0,'',                  now,'確認中', 'G02']);
  inviteSheet.appendRow(['APP-T03','006','#6 赤穂雷太',     '10月10日（土）vs 琉球',2,0,0,'','','赤穂 由美',     'pre','',0,'',                  now,'確保済み','G01']);
  inviteSheet.appendRow(['APP-T04','006','#6 赤穂雷太',     '10月17日（土）vs 島根',4,0,0,'','','赤穂 由美',     'pre','',0,'家族4人分',          now,'確認中', 'G03']);
  inviteSheet.appendRow(['APP-T05','002','#2 栗原翼',       '10月10日（土）vs 琉球',2,1,0,'','','栗原 美咲',     'pre','',1,'子供連れ',            now,'確保済み','G01']);
  inviteSheet.appendRow(['APP-T06','002','#2 栗原翼',       '10月24日（土）vs 千葉J',3,0,0,'','','栗原 美咲',    'day','',0,'',                  now,'確認中', 'G05']);
  inviteSheet.appendRow(['APP-T07','005','#5 田口成浩',     '10月11日（日）vs 琉球',2,0,0,'','','田口 幸子',     'pre','',0,'',                  now,'対応不可','G02']);
  inviteSheet.appendRow(['APP-T08','011','#11 内藤晴樹',    '10月17日（土）vs 島根',3,1,0,'','','内藤 和子',     'pre','',1,'子供あり',            now,'確保済み','G03']);
  inviteSheet.appendRow(['APP-T09','102','AC 庄司和広',     '10月24日（土）vs 千葉J',2,0,0,'','','庄司 明子',    'pre','',0,'',                  now,'確認中', 'G05']);

  // ===== 家族席（6件）=====
  familySheet.appendRow(['APP-T10','101','HC Mick Downer',  '10月10日（土）vs 琉球',2,0,0,'','','Downer Sarah',  'pre','',1,'',                  now,'確認中', 'G01']);
  familySheet.appendRow(['APP-T11','006','#6 赤穂雷太',     '10月11日（日）vs 琉球',3,0,0,'','','赤穂 由美',     'pre','',1,'乳児連れ・通路側希望',now,'確保済み','G02']);
  familySheet.appendRow(['APP-T12','006','#6 赤穂雷太',     '10月17日（土）vs 島根',2,0,0,'','','赤穂 由美',     'day','',0,'',                  now,'確認中', 'G03']);
  familySheet.appendRow(['APP-T13','002','#2 栗原翼',       '10月10日（土）vs 琉球',4,0,0,'','','栗原 美咲',     'pre','',2,'父母・兄弟4名',       now,'確保済み','G01']);
  familySheet.appendRow(['APP-T14','011','#11 内藤晴樹',    '10月24日（土）vs 千葉J',2,0,0,'','','内藤 和子',    'pre','',1,'',                  now,'確認中', 'G05']);
  familySheet.appendRow(['APP-T15','012','#12 元田大陽',    '10月11日（日）vs 琉球',3,0,0,'','','元田 由里子',   'day','',0,'子供2名含む',         now,'キャンセル','G02']);

  // ===== 有料チケット（3件）=====
  paidSheet.appendRow(['APP-T16','006','#6 赤穂雷太',       '10月10日（土）vs 琉球',2,0,0,'コートサイドシート','前列','赤穂 由美', 'pre','salary',0,'前列希望', now,'確認中', 'G01']);
  paidSheet.appendRow(['APP-T17','002','#2 栗原翼',         '10月17日（土）vs 島根',2,0,0,'2F自由席','',         '栗原 美咲', 'pre','free',  0,'',          now,'確保済み','G03']);
  paidSheet.appendRow(['APP-T18','103','AC 奈良篤人',       '10月24日（土）vs 千葉J',1,0,0,'コートサイドシート','','奈良 浩二','day','salary',0,'',          now,'対応不可','G05']);

  Logger.log('テストデータ挿入完了');
}

// =====================================================
// 移行後クリーンアップ（一回だけ手動実行）
// 古い英語シートを削除 + パスワードハッシュを正しい値に更新
// =====================================================
function setupAfterMigration() {
  const ss = getSpreadsheet();

  // 古い英語シートを削除（不要シート全削除）
  const oldSheets = ['applications', 'games', 'settings', 'players'];
  oldSheets.forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) { ss.deleteSheet(s); Logger.log('削除: ' + name); }
  });

  // 申込3シートのヘッダーを最新17列に強制更新 + ステータスドロップダウン設定
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['確認中', '確保済み', '対応不可', 'キャンセル'], true)
    .setAllowInvalid(false)
    .build();

  [SHEET_INVITE, SHEET_FAMILY, SHEET_PAID].forEach(name => {
    const s = ss.getSheetByName(name);
    if (!s) return;
    // ヘッダー更新
    s.getRange(1, 1, 1, APP_HEADERS.length).setValues([APP_HEADERS]);
    // ステータス列（16列目）に全行ドロップダウン適用
    s.getRange(2, 16, s.getMaxRows() - 1, 1).setDataValidation(statusRule);
    Logger.log('ヘッダー・ドロップダウン設定: ' + name);
  });

  // パスワードハッシュを正しい値に更新（実際の値はスクリプトプロパティから取得）
  const settingsSheet = getSheet(SHEET_SETTINGS);
  const data = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'admin_password_hash') {
      settingsSheet.getRange(i + 1, 2).setValue('SET_VIA_SCRIPT_PROPERTIES'); // 実際の値はGASエディタで手動設定
    }
    if (data[i][0] === 'manager_password_hash') {
      settingsSheet.getRange(i + 1, 2).setValue('SET_VIA_SCRIPT_PROPERTIES'); // 実際の値はGASエディタで手動設定
    }
  }

  Logger.log('setupAfterMigration 完了');
}

// 新規申込行にもステータスドロップダウンを適用するヘルパー
function applyStatusDropdown(sheet, rowNum) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['確認中', '確保済み', '対応不可', 'キャンセル'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(rowNum, 16).setDataValidation(rule);
}

// =====================================================
// LINE チャットボット — 会話状態管理
// =====================================================

// CacheService で会話状態を保存（TTL: 600秒）
function getConversationState(lineUserId) {
  const cache = CacheService.getScriptCache();
  const json = cache.get('LINE_STATE_' + lineUserId);
  return json ? JSON.parse(json) : null;
}

function saveConversationState(lineUserId, stateObj) {
  const cache = CacheService.getScriptCache();
  cache.put('LINE_STATE_' + lineUserId, JSON.stringify(stateObj), 600);
}

function clearConversationState(lineUserId) {
  CacheService.getScriptCache().remove('LINE_STATE_' + lineUserId);
}

// LINE ID から選手データを逆引き
function getPlayerByLineUserId(lineUserId) {
  const sheet = getSheet(SHEET_PLAYERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] && String(data[i][2]) === String(lineUserId)) {
      return { playerId: String(data[i][0]), name: data[i][1] };
    }
  }
  return null;
}

// 申込期限内の直近n試合を返す
function getUpcomingGames(n) {
  const all = getGames();
  const now = new Date();
  return all
    .filter(g => !g.isDeadlinePassed && g.deadline)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, n || 3);
}

// LINE quickReply オブジェクトを生成
// items: [{label: string, data: string}]
function buildQuickReply(items) {
  return {
    items: items.map(item => ({
      type: 'action',
      action: { type: 'postback', label: item.label, data: item.data, displayText: item.label }
    }))
  };
}

// Reply API（replyToken使用）
function replyToLine(replyToken, messages) {
  const token = getLineToken();
  if (!token || !replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ replyToken, messages }),
    muteHttpExceptions: true
  });
}

// LINE から申込を送信
function submitLineApplication(lineUserId, stateData) {
  const player = getPlayerByLineUserId(lineUserId);
  if (!player) throw new Error('選手データが見つかりません');
  const game = getGames().find(g => g.gameId === stateData.gameId);
  if (!game) throw new Error('試合データが見つかりません');
  const gameLabel = Utilities.formatDate(new Date(game.date), 'Asia/Tokyo', 'M月d日') +
    '（' + game.dayOfWeek + '）vs ' + game.opponent;

  const body = {
    playerId: player.playerId,
    ticketType: stateData.ticketType,
    gameId: stateData.gameId,
    quantityAdult: parseInt(stateData.adultCount) || 1,
    quantityChild: 0,
    quantityInfant: 0,
    seatType: stateData.seatType || '',
    seatRequest: '',
    receiverName: stateData.receiverName || player.name,
    pickupMethod: 'pre',
    paymentMethod: stateData.payment || '',
    parkingCount: 0,
    note: 'LINE申込'
  };
  return submitApplication(body);
}

// =====================================================
// LINE チャットボット — メインフロー
// =====================================================
function processLineEvent(ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId) return;

  // 友だち追加
  if (ev.type === 'follow') {
    replyToLine(ev.replyToken, [{
      type: 'text',
      text: '🏀 Akita Northern Happinets\n\n' +
            'This account is exclusively for the Player Family Ticket Application System.\n' +
            'このアカウントは選手家族チケット申込システム専用です。\n\n' +
            'Please enter your player number (3 digits) or staff number.\n' +
            '選手番号（3桁）またはスタッフ番号を入力してください。\n\n' +
            'Your number can be confirmed with the team manager.\n' +
            '番号はチームマネージャーにご確認ください。\n\n' +
            'This system is only available for Akita Northern Happinets home games.\n' +
            'このシステムは秋田ノーザンハピネッツのホームゲームのみ対象です。\n\n' +
            'Example / 例）006 / 101'
    }]);
    return;
  }

  const player = getPlayerByLineUserId(userId);

  // テキストメッセージ
  if (ev.type === 'message' && ev.message.type === 'text') {
    const text = ev.message.text.trim();

    // 未登録 → 背番号として登録を試みる
    if (!player) {
      const saved = saveLineUserId(text, userId);
      if (saved) {
        replyToLine(ev.replyToken, [buildMainMenuMessage('Registration complete! / 登録完了しました！\nUse the menu to apply for tickets or check your applications.\nチケット申込や確認はメニューから操作できます。')]);
      } else {
        replyToLine(ev.replyToken, [{ type: 'text', text: 'Player number not found. / 選手番号が見つかりませんでした。\nPlease enter the correct number.\n正しい番号を入力してください（例：006 / 101）' }]);
      }
      return;
    }

    const state = getConversationState(userId);

    // 枚数入力待ち
    if (state && state.step === 'SELECTING_COUNT') {
      const n = parseInt(text);
      if (!n || n < 1 || n > 6) {
        replyToLine(ev.replyToken, [{ type: 'text', text: '1〜6の数字を入力してください。' }]);
        return;
      }
      state.adultCount = n;
      if (state.ticketType === 'paid') {
        state.step = 'SELECTING_SEAT_TYPE';
        saveConversationState(userId, state);
        replyToLine(ev.replyToken, [{
          type: 'text', text: '席種を選んでください。',
          quickReply: buildQuickReply([
            { label: 'コートサイドシート', data: 'seat:courtside' },
            { label: '2F自由席', data: 'seat:free' },
            { label: 'その他', data: 'seat:other' }
          ])
        }]);
      } else {
        state.step = 'SELECTING_RECEIVER';
        saveConversationState(userId, state);
        replyToLine(ev.replyToken, [{ type: 'text', text: '受取者氏名を入力してください。' }]);
      }
      return;
    }

    // 受取者入力待ち
    if (state && state.step === 'SELECTING_RECEIVER') {
      state.receiverName = text;
      state.step = 'CONFIRMING';
      saveConversationState(userId, state);
      replyToLine(ev.replyToken, [buildConfirmMessage(state, buildQuickReply([
        { label: 'はい（送信）', data: 'confirm:yes' },
        { label: 'キャンセル', data: 'confirm:no' }
      ]))]);
      return;
    }

    // SELECTING_SEAT_TYPE ステップでテキスト送信されたら案内
    if (state && state.step === 'SELECTING_SEAT_TYPE') {
      replyToLine(ev.replyToken, [{ type: 'text', text: '下のボタンから席種を選んでください。' }]);
      return;
    }

    // SELECTING_PAYMENT ステップでテキスト送信されたら案内
    if (state && state.step === 'SELECTING_PAYMENT') {
      replyToLine(ev.replyToken, [{ type: 'text', text: '下のボタンから支払方法を選んでください。' }]);
      return;
    }

    // CONFIRMING ステップでテキスト送信されたら確認画面を再表示
    if (state && state.step === 'CONFIRMING') {
      replyToLine(ev.replyToken, [buildConfirmMessage(state, buildQuickReply([
        { label: 'はい（送信）', data: 'confirm:yes' },
        { label: 'キャンセル', data: 'confirm:no' }
      ]))]);
      return;
    }

    // その他テキスト → メインメニュー表示
    replyToLine(ev.replyToken, [buildMainMenuMessage(
      'Individual inquiries cannot be accepted through this account.\n' +
      '個別のご連絡は本アカウントでは承っておりません。\n\n' +
      'Please contact the team manager or ticket team.\n' +
      'チームマネージャーまたはチケットチームまでお願いします。\n\n' +
      'Please use the menu below.\n' +
      '以下のメニューからご利用ください。'
    )]);
    return;
  }

  // postbackイベント
  if (ev.type === 'postback') {
    const data = ev.postback && ev.postback.data;
    if (!data) return;

    if (data === 'menu:apply') {
      clearConversationState(userId);
      saveConversationState(userId, { step: 'SELECTING_TYPE' });
      replyToLine(ev.replyToken, [{
        type: 'text', text: 'チケット種別を選んでください。',
        quickReply: buildQuickReply([
          { label: '招待チケット', data: 'type:invite' },
          { label: '家族席', data: 'type:family' },
          { label: '有料チケット', data: 'type:paid' }
        ])
      }]);
      return;
    }

    if (data === 'menu:check') {
      const apps = getApplicationsByPlayer(player.playerId);
      const recent = apps.slice(-5).reverse();
      const statusEmoji = { '確保済み': '✅', '確認中': '⏳', '対応不可': '❌', 'キャンセル': '🚫' };
      const lines = recent.length
        ? recent.map(a => (statusEmoji[a.status] || '📋') + ' ' + a.status + ': ' + a.gameLabel + ' ' + a.ticketType)
        : ['申込はありません。'];
      replyToLine(ev.replyToken, [{ type: 'text', text: '直近の申込状況\n\n' + lines.join('\n') }]);
      return;
    }

    if (data === 'menu:help') {
      replyToLine(ev.replyToken, [{ type: 'text', text: 'ご不明な点はチケット担当にお問い合わせください。' }]);
      return;
    }

    if (data.startsWith('game:')) {
      const state = getConversationState(userId) || {};
      state.gameId = data.split(':')[1];
      state.step = 'SELECTING_COUNT';
      saveConversationState(userId, state);
      replyToLine(ev.replyToken, [{ type: 'text', text: '大人の枚数を入力してください（1〜6）。' }]);
      return;
    }

    if (data.startsWith('type:')) {
      const state = getConversationState(userId) || {};
      state.ticketType = data.split(':')[1];
      state.step = 'SELECTING_GAME';
      saveConversationState(userId, state);
      const games = getUpcomingGames(20);
      if (!games.length) {
        replyToLine(ev.replyToken, [{ type: 'text', text: '現在申込可能な試合はありません。' }]);
        return;
      }
      replyToLine(ev.replyToken, [{
        type: 'text', text: '試合を選んでください。',
        quickReply: buildQuickReply(games.map(g => ({
          label: Utilities.formatDate(new Date(g.date), 'Asia/Tokyo', 'M/d') + ' vs ' + g.opponent,
          data: 'game:' + g.gameId
        })))
      }]);
      return;
    }

    if (data.startsWith('seat:')) {
      const state = getConversationState(userId);
      if (!state) {
        replyToLine(ev.replyToken, [buildMainMenuMessage('セッションが切れました。もう一度「チケット申込」から始めてください。')]);
        return;
      }
      state.seatType = data.split(':')[1];
      state.step = 'SELECTING_PAYMENT';
      saveConversationState(userId, state);
      replyToLine(ev.replyToken, [{
        type: 'text', text: '支払方法を選んでください。',
        quickReply: buildQuickReply([
          { label: '給与天引き', data: 'payment:salary' },
          { label: '当日現金', data: 'payment:cash' }
        ])
      }]);
      return;
    }

    if (data.startsWith('payment:')) {
      const state = getConversationState(userId);
      if (!state) {
        replyToLine(ev.replyToken, [buildMainMenuMessage('セッションが切れました。もう一度「チケット申込」から始めてください。')]);
        return;
      }
      state.payment = data.split(':')[1];
      state.step = 'CONFIRMING';
      saveConversationState(userId, state);
      replyToLine(ev.replyToken, [buildConfirmMessage(state, buildQuickReply([
        { label: 'はい（送信）', data: 'confirm:yes' },
        { label: 'キャンセル', data: 'confirm:no' }
      ]))]);
      return;
    }

    if (data === 'confirm:yes') {
      const state = getConversationState(userId);
      if (!state) {
        replyToLine(ev.replyToken, [buildMainMenuMessage('セッションが切れました。もう一度「チケット申込」から始めてください。')]);
        return;
      }
      submitLineApplication(userId, state);
      clearConversationState(userId);
      replyToLine(ev.replyToken, [buildMainMenuMessage('申込が完了しました！担当から確定の連絡が届きます。')]);
      return;
    }

    if (data === 'confirm:no') {
      clearConversationState(userId);
      replyToLine(ev.replyToken, [buildMainMenuMessage('キャンセルしました。')]);
      return;
    }
  }
}

// メインメニュー付きメッセージを生成
function buildMainMenuMessage(text) {
  return {
    type: 'text',
    text: text,
    quickReply: buildQuickReply([
      { label: 'チケット申込', data: 'menu:apply' },
      { label: '申込確認', data: 'menu:check' },
      { label: 'ヘルプ', data: 'menu:help' }
    ])
  };
}

// 確認メッセージを生成
function buildConfirmMessage(state, quickReply) {
  const game = getGames().find(g => g.gameId === state.gameId);
  const gameLabel = game
    ? Utilities.formatDate(new Date(game.date), 'Asia/Tokyo', 'M月d日') + '（' + game.dayOfWeek + '）vs ' + game.opponent
    : state.gameId;
  const typeLabel = { invite: '招待チケット', family: '家族席', paid: '有料チケット' }[state.ticketType] || state.ticketType;
  const seatLabel = { courtside: 'コートサイドシート', free: '2F自由席', other: 'その他' }[state.seatType] || '';
  const payLabel = { salary: '給与天引き', cash: '当日現金' }[state.payment] || '';

  let lines = ['以下の内容で申込みます', '', '試合: ' + gameLabel, '種別: ' + typeLabel, '大人: ' + state.adultCount + '枚'];
  if (state.receiverName) lines.push('受取者: ' + state.receiverName);
  if (seatLabel) lines.push('席種: ' + seatLabel);
  if (payLabel) lines.push('支払: ' + payLabel);

  return { type: 'text', text: lines.join('\n'), quickReply };
}

// =====================================================
// セットアップヘルパー（一度だけ実行・本番環境では削除推奨）
// setup-gas-env.sh が自動生成するコードを貼り付けて実行する代替手段
// =====================================================
function setupProperties_RUNONCE() {
  // ⚠️ このコードは setup-gas-env.sh が自動生成します
  // 手動設定が必要な場合: bash scripts/setup-gas-env.sh を実行してください
  Logger.log('setup-gas-env.sh を実行してコードを生成してください');
  Logger.log('生成されたコードをこの関数に貼り付けて実行すると設定が完了します');
}

// =====================================================
// LINE リッチメニュー管理
// =====================================================
function createRichMenu_RUNONCE() {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    Logger.log('❌ LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
    return;
  }

  // 1. リッチメニュー構造を作成
  var menuBody = {
    size: { width: 1200, height: 405 },
    selected: true,
    name: 'ハピネッツ家族チケット',
    chatBarText: 'チケットメニュー',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 600, height: 405 },
        action: {
          type: 'uri',
          uri: 'https://app-five-pi-50.vercel.app/p/hnts-player-form',
          label: 'チケット申込'
        }
      },
      {
        bounds: { x: 600, y: 0, width: 600, height: 405 },
        action: {
          type: 'uri',
          uri: 'https://app-five-pi-50.vercel.app/p/hnts-player-dashboard',
          label: '申込確認'
        }
      }
    ]
  };

  try {
    var createRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(menuBody),
      muteHttpExceptions: true
    });

    var statusCode = createRes.getResponseCode();
    var responseText = createRes.getContentText();

    if (statusCode !== 200) {
      Logger.log('❌ リッチメニュー作成エラー: ' + statusCode);
      Logger.log(responseText);
      return;
    }

    var richMenuId = JSON.parse(responseText).richMenuId;
    Logger.log('✅ リッチメニュー作成成功。ID: ' + richMenuId);

    // 2. デフォルトリッチメニューとして設定
    var setDefaultRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/user/all/richmenu/' + richMenuId, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    var setDefaultStatusCode = setDefaultRes.getResponseCode();
    if (setDefaultStatusCode === 200) {
      Logger.log('✅ デフォルトリッチメニューとして設定完了');
      // 設定を永続化（再実行時に誤操作を防ぐため）
      PropertiesService.getScriptProperties().setProperty('LINE_RICH_MENU_ID', richMenuId);
    } else {
      Logger.log('⚠️ デフォルト設定に失敗: ' + setDefaultStatusCode);
      Logger.log(setDefaultRes.getContentText());
    }

  } catch (err) {
    Logger.log('❌ エラー: ' + err.message);
  }
}

function uploadRichMenuImage_RUNONCE(richMenuId) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    Logger.log('❌ LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
    return;
  }

  if (!richMenuId) {
    richMenuId = PropertiesService.getScriptProperties().getProperty('LINE_RICH_MENU_ID');
  }

  if (!richMenuId) {
    Logger.log('❌ richMenuId が指定されていません。先に createRichMenu_RUNONCE() を実行してください');
    return;
  }

  // 注: GAS からファイルシステムの画像を直接読み込むことは難しいため、
  // 以下の方法のいずれかを使用してください:
  // 1. Google Drive に rich-menu.png をアップロード → DriveApp で読み込み
  // 2. Base64文字列をPropertiesServiceに分割保存（5KB制限あり）
  // 3. LINE Official Account Manager のUI から手動でアップロード
  var base64 = PropertiesService.getScriptProperties().getProperty('RICH_MENU_IMAGE_BASE64');
  if (!base64) {
    Logger.log('❌ RICH_MENU_IMAGE_BASE64 が未設定。setRichMenuImageBase64_RUNONCE() を先に実行してください');
    return;
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'rich-menu.png');
  var uploadRes = UrlFetchApp.fetch(
    'https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'image/png' },
      payload: blob.getBytes(),
      muteHttpExceptions: true
    }
  );
  Logger.log(uploadRes.getResponseCode() === 200 ? '✅ 画像アップロード完了' : '❌ 画像アップロード失敗: ' + uploadRes.getContentText());
}

function setRichMenuImageBase64_RUNONCE() {
  // scripts/rich-menu-base64.txt の内容をここに貼り付けて実行する
  var base64 = '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';
  PropertiesService.getScriptProperties().setProperty('RICH_MENU_IMAGE_BASE64', base64);
  Logger.log('✅ RICH_MENU_IMAGE_BASE64 を保存しました');
}

// =====================================================
// 朝10時 当日試合チケット通知
// =====================================================
function sendMorningNotifications() {
  var token = getLineToken();
  if (!token) return;

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var games = getGames();
  var todayGames = games.filter(function(g) {
    var gDate = Utilities.formatDate(new Date(g.date), 'Asia/Tokyo', 'yyyy-MM-dd');
    return gDate === today;
  });

  if (todayGames.length === 0) return;

  var players = getPlayers();
  var playerMap = {};
  players.forEach(function(p) { playerMap[String(p.playerId)] = p; });

  var allApps = getAllApplicationsInternal();
  var sent = 0;

  todayGames.forEach(function(game) {
    var gameLabel = buildGameLabel(game);
    var gameApps = allApps.filter(function(a) {
      return String(a.gameId) === String(game.gameId) && a.status === 'confirmed';
    });

    var byPlayer = {};
    gameApps.forEach(function(a) {
      if (!byPlayer[a.playerId]) byPlayer[a.playerId] = [];
      byPlayer[a.playerId].push(a);
    });

    Object.keys(byPlayer).forEach(function(pid) {
      var player = playerMap[String(pid)];
      if (!player || !player.lineUserId) return;

      var apps = byPlayer[pid];
      var lines = ['🏀 本日の試合チケット情報', '', '試合: ' + gameLabel, ''];
      apps.forEach(function(a) {
        var typeLabel = { invite: '招待', family: '家族席', paid: '有料' }[a.ticketType] || a.ticketType;
        lines.push('【' + typeLabel + '】大人' + (a.quantityAdult || 0) + '枚' +
          (a.quantityChild ? ' 子ども' + a.quantityChild + '枚' : '') +
          (a.receiverName ? ' 受取: ' + a.receiverName : ''));
      });
      lines.push('', '会場でお楽しみください！');

      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        payload: JSON.stringify({
          to: player.lineUserId,
          messages: [{ type: 'text', text: lines.join('\n') }]
        }),
        muteHttpExceptions: true
      });
      sent++;
    });
  });

  Logger.log('✅ 朝10時通知送信完了: ' + sent + '件');
}

function getAllApplicationsInternal() {
  var apps = [];
  for (var type in TICKET_SHEET) {
    var sheet = getSheet(TICKET_SHEET[type]);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      apps.push(rowToApplication(data[i], type));
    }
  }
  return apps;
}

function setupDailyTrigger_RUNONCE() {
  // 既存トリガーを削除してから再登録
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendMorningNotifications') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendMorningNotifications')
    .timeBased()
    .atHour(10)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  Logger.log('✅ 毎朝10時の通知トリガーを設定しました');
}
