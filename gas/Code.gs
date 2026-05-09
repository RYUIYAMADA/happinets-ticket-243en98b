// =====================================================
// 選手家族チケット申込システム — GAS Web App バックエンド
// =====================================================

const SS_ID = ''; // デプロイ後にSpreadsheetIDを設定（空白=アクティブSSを使用）
const LINE_CHANNEL_ACCESS_TOKEN = ''; // LINE Messaging API チャンネルアクセストークン
const SHEET_PLAYERS = 'players';
const SHEET_GAMES = 'games';
const SHEET_APPLICATIONS = 'applications';
const SHEET_SETTINGS = 'settings';

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
        result = { ok: true, data: getApplicationsByPlayer(pid) };
        break;
      case 'getAllApplications':
        result = { ok: true, data: getAllApplications() };
        break;
      case 'getPlayers':
        result = { ok: true, data: getPlayers() };
        break;
      case 'getLineStats':
        result = { ok: true, data: getLineStats() };
        break;
      case 'initData':
        result = { ok: true, data: initData() };
        break;
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
    const action = body.action || '';
    switch (action) {
      case 'login':
        result = { ok: true, data: login(body.playerId) };
        break;
      case 'adminLogin':
        result = { ok: true, data: adminLogin(body.passwordHash) };
        break;
      case 'submitApplication':
        result = { ok: true, data: submitApplication(body) };
        break;
      case 'updateApplication':
        result = { ok: true, data: updateApplication(body) };
        break;
      case 'cancelApplication':
        result = { ok: true, data: cancelApplication(body.applicationId, body.playerId) };
        break;
      case 'updateDeadline':
        result = { ok: true, data: updateDeadline(body.gameId, body.deadline) };
        break;
      case 'updateStatus':
        result = { ok: true, data: updateStatus(body.applicationId, body.status) };
        break;
      case 'initData':
        result = { ok: true, data: initData() };
        break;
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
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(playerId)) {
      return { playerId: data[i][0], name: data[i][1], role: 'player' };
    }
  }
  throw new Error('番号が見つかりません');
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
// 申込
// =====================================================
function submitApplication(body) {
  const gameId = body.gameId;
  const playerId = body.playerId;

  // 期限チェック
  const games = getGames();
  const game = games.find(g => String(g.gameId) === String(gameId));
  if (!game) throw new Error('試合が見つかりません');
  if (game.isDeadlinePassed) throw new Error('申込期限を過ぎています');

  // 重複チェック
  const existing = getApplicationsByPlayer(playerId).find(
    a => String(a.gameId) === String(gameId) && a.ticketType === body.ticketType && a.status !== 'cancelled'
  );
  if (existing) throw new Error('この試合・種別は既に申込済みです');

  const sheet = getSheet(SHEET_APPLICATIONS);
  const appId = 'APP-' + new Date().getTime();
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  sheet.appendRow([
    appId,
    playerId,
    gameId,
    body.ticketType,
    body.quantityAdult || 0,
    body.quantityChild || 0,
    body.quantityInfant || 0,
    body.seatType || '',
    body.seatRequest || '',
    body.receiverName || '',
    body.pickupMethod || '',
    body.paymentMethod || '',
    body.parkingCount || 0,
    body.note || '',
    now,
    'pending'
  ]);
  return { applicationId: appId };
}

function updateApplication(body) {
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.applicationId && String(data[i][1]) === String(body.playerId)) {
      // 期限チェック
      const games = getGames();
      const game = games.find(g => String(g.gameId) === String(data[i][2]));
      if (game && game.isDeadlinePassed) throw new Error('申込期限を過ぎています');

      sheet.getRange(i + 1, 5).setValue(body.quantityAdult || 0);
      sheet.getRange(i + 1, 6).setValue(body.quantityChild || 0);
      sheet.getRange(i + 1, 7).setValue(body.quantityInfant || 0);
      sheet.getRange(i + 1, 8).setValue(body.seatType || '');
      sheet.getRange(i + 1, 9).setValue(body.seatRequest || '');
      sheet.getRange(i + 1, 10).setValue(body.receiverName || '');
      sheet.getRange(i + 1, 11).setValue(body.pickupMethod || '');
      sheet.getRange(i + 1, 12).setValue(body.paymentMethod || '');
      sheet.getRange(i + 1, 13).setValue(body.parkingCount || 0);
      sheet.getRange(i + 1, 14).setValue(body.note || '');
      return { updated: true };
    }
  }
  throw new Error('申込が見つかりません');
}

function cancelApplication(applicationId, playerId) {
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === applicationId && String(data[i][1]) === String(playerId)) {
      const games = getGames();
      const game = games.find(g => String(g.gameId) === String(data[i][2]));
      if (game && game.isDeadlinePassed) throw new Error('申込期限を過ぎています');
      sheet.getRange(i + 1, 16).setValue('cancelled');
      return { cancelled: true };
    }
  }
  throw new Error('申込が見つかりません');
}

function updateStatus(applicationId, status) {
  if (!['pending', 'confirmed', 'rejected', 'cancelled'].includes(status)) {
    throw new Error('不正なステータス: ' + status);
  }
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === applicationId) {
      sheet.getRange(i + 1, 16).setValue(status);
      return { updated: true };
    }
  }
  throw new Error('申込が見つかりません');
}

function getApplicationsByPlayer(playerId) {
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  const apps = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(playerId)) continue;
    apps.push(rowToApplication(data[i]));
  }
  return apps;
}

function getAllApplications() {
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  const apps = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    apps.push(rowToApplication(data[i]));
  }
  return apps;
}

function rowToApplication(row) {
  return {
    applicationId: row[0],
    playerId: row[1],
    gameId: row[2],
    ticketType: row[3],
    quantityAdult: row[4],
    quantityChild: row[5],
    quantityInfant: row[6],
    seatType: row[7],
    seatRequest: row[8],
    receiverName: row[9],
    pickupMethod: row[10],
    paymentMethod: row[11],
    parkingCount: row[12],
    note: row[13],
    createdAt: row[14],
    status: row[15]
  };
}

function getPlayers() {
  const sheet = getSheet(SHEET_PLAYERS);
  const data = sheet.getDataRange().getValues();
  const players = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    players.push({ playerId: data[i][0], name: data[i][1] });
  }
  return players;
}

// =====================================================
// LINE統計
// =====================================================
function getLineStats() {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    return { quota: 200, used: 0, remaining: 200, note: 'LINE未設定' };
  }
  const headers = { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN };
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
  const headers = ['gameId', 'date', 'dayOfWeek', 'opponent', 'deadline'];
  sheet.appendRow(headers);

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
  sheet.appendRow(['key', 'value']);
  // デフォルト管理者パスワード: "admin1234" のSHA-256
  sheet.appendRow(['admin_password_hash', 'sha256_of_admin1234_set_manually']);
  sheet.appendRow(['manager_password_hash', 'sha256_of_manager1234_set_manually']);
}

function initSamplePlayers() {
  const sheet = getSheet(SHEET_PLAYERS);
  sheet.clearContents();
  sheet.appendRow(['playerId', 'name', 'passwordHash']);
  // 実際のメンバーリスト（パスワードは管理者が別途設定）
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
  members.forEach(m => sheet.appendRow([m[0], m[1]]));
}

// =====================================================
// シート自動作成
// =====================================================
function createSheet(name) {
  const ss = getSpreadsheet();
  const sheet = ss.insertSheet(name);
  switch (name) {
    case SHEET_PLAYERS:
      sheet.appendRow(['playerId', 'name', 'passwordHash']);
      break;
    case SHEET_GAMES:
      sheet.appendRow(['gameId', 'date', 'dayOfWeek', 'opponent', 'deadline']);
      break;
    case SHEET_APPLICATIONS:
      sheet.appendRow(['applicationId', 'playerId', 'gameId', 'ticketType',
        'quantityAdult', 'quantityChild', 'quantityInfant', 'seatType', 'seatRequest',
        'receiverName', 'pickupMethod', 'paymentMethod', 'parkingCount', 'note', 'createdAt', 'status']);
      break;
    case SHEET_SETTINGS:
      sheet.appendRow(['key', 'value']);
      break;
  }
  return sheet;
}

// =====================================================
// テストデータ初期化（GASエディタから手動実行）
// =====================================================
function initTestData() {
  const sheet = getSheet(SHEET_APPLICATIONS);
  const now = '2026-10-01 09:00:00';

  const testRows = [
    // HC Mick Downer (101) × G01 招待チケット
    ['APP-T01','101','G01','invite',3,0,0,'','','Downer Sarah','pre','',0,'妻と両親',now,'confirmed'],
    // HC Mick Downer (101) × G01 家族席
    ['APP-T02','101','G01','family',2,1,0,'','','Downer Sarah','pre','',1,'',now,'pending'],
    // HC Mick Downer (101) × G02 招待チケット
    ['APP-T03','101','G02','invite',2,0,0,'','','Downer Sarah','day','',0,'',now,'pending'],
    // #6 赤穂 雷太 (006) × G01 招待チケット
    ['APP-T04','006','G01','invite',2,1,0,'','','赤穂 由美','pre','',0,'',now,'confirmed'],
    // #6 赤穂 雷太 (006) × G01 有料チケット
    ['APP-T05','006','G01','paid',2,0,0,'コートサイドシート','','赤穂 由美','pre','salary',0,'前列希望',now,'pending'],
    // #6 赤穂 雷太 (006) × G02 家族席
    ['APP-T06','006','G02','family',2,2,1,'','','赤穂 由美','pre','',1,'乳児連れ・通路側希望',now,'confirmed'],
  ];

  // 既存のテストデータ（APP-T*）を削除してから挿入
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).startsWith('APP-T')) sheet.deleteRow(i + 1);
  }

  testRows.forEach(row => sheet.appendRow(row));
  Logger.log('テストデータ挿入完了: ' + testRows.length + '件');
}
