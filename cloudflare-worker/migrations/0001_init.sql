-- =====================================================
-- family-tickets D1 migration 0001
-- Cloudflare D1 (SQLite) 初期スキーマ
-- 実行: wrangler d1 execute family-tickets-db --file=cloudflare-worker/migrations/0001_init.sql
-- =====================================================

-- =====================================================
-- players
-- GAS 対応: 選手・スタッフシート (col0=選手番号, col1=氏名, col2=LINE ID)
-- =====================================================
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_no  TEXT    NOT NULL,                          -- 正規化済み番号("1"形式。0埋め不要)。GAS: String(parseInt(data[i][0]))
  name       TEXT    NOT NULL,                          -- 氏名 (#6 赤穂雷太 形式含む)
  name_en    TEXT    NOT NULL DEFAULT '',               -- 英語名(外国籍選手用)
  line_user_id TEXT  DEFAULT NULL,                      -- LINE UID (友だち追加時に登録)。GAS: col2
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_players_player_no ON players(player_no);
CREATE INDEX       IF NOT EXISTS idx_players_line_user_id ON players(line_user_id) WHERE line_user_id IS NOT NULL;

-- =====================================================
-- games
-- GAS 対応: 試合日程シート (col0=試合ID, col1=日付, col2=曜日, col3=対戦相手, col4=申込期限)
-- GAS gameId = game_no ('G01'形式)
-- =====================================================
CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_no     TEXT    NOT NULL,               -- 'G01' 形式。GAS: row[0]
  date        TEXT    NOT NULL,               -- ISO 8601 'YYYY-MM-DD'。GAS: Utilities.formatDate(row[1])
  tipoff      TEXT    DEFAULT NULL,           -- 'HH:MM' 形式 (GAS未保持・将来用)
  opponent    TEXT    NOT NULL,               -- 対戦相手チーム名。GAS: row[3]
  day_of_week TEXT    NOT NULL,               -- 曜日('月'〜'日')。GAS: row[2]
  deadline    TEXT    DEFAULT NULL,           -- 申込期限 'YYYY-MM-DD'。GAS: row[4] → formatDate
  season      TEXT    NOT NULL DEFAULT '2026-27',
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  CHECK(date GLOB '????-??-??'),
  CHECK(deadline IS NULL OR deadline GLOB '????-??-??'),
  CHECK(day_of_week IN ('月','火','水','木','金','土','日'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_games_game_no ON games(game_no);
CREATE INDEX       IF NOT EXISTS idx_games_date ON games(date);
CREATE INDEX       IF NOT EXISTS idx_games_deadline ON games(deadline);

-- =====================================================
-- applications
-- GAS 対応: 招待チケット/家族席/有料チケット 3シートを1テーブルに正規化
-- APP_HEADERS 17列: 申込ID(0) 選手番号(1) 選手名(2) 試合ラベル(3)
--   大人枚数(4) 子ども(5) 乳幼児(6) 席種(7) 座席希望(8)
--   受取者氏名(9) 受取方法(10) 支払方法(11) 駐車場台数(12)
--   備考(13) 申込日時(14) ステータス(15) 試合ID*(16)
-- =====================================================
CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id          TEXT    NOT NULL,           -- 'APP-{timestamp}' 形式 (既存互換)。GAS: 'APP-' + Date.getTime()
  player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  game_id         INTEGER NOT NULL REFERENCES games(id)   ON DELETE RESTRICT,
  category        TEXT    NOT NULL CHECK(category IN ('invite','family','paid')),
                                              -- GAS 3シート→ ticketType (invite/family/paid)
  quantity_adult  INTEGER NOT NULL DEFAULT 1 CHECK(quantity_adult >= 0 AND quantity_adult <= 10),
  quantity_child  INTEGER NOT NULL DEFAULT 0 CHECK(quantity_child >= 0 AND quantity_child <= 10),
  quantity_infant INTEGER NOT NULL DEFAULT 0 CHECK(quantity_infant >= 0 AND quantity_infant <= 10),
  seat_type       TEXT    NOT NULL DEFAULT '',   -- GAS: row[7] (コートサイドシート/2F自由席/その他)
  seat_request    TEXT    NOT NULL DEFAULT '',   -- GAS: row[8] 座席希望
  receivers       TEXT    NOT NULL DEFAULT '[]', -- JSON配列: [{name: string}]。GAS: row[9]=受取者氏名を1要素として格納
  pickup_method   TEXT    NOT NULL DEFAULT '' CHECK(pickup_method IN ('','pre','day')),
                                              -- GAS: row[10] pre=事前受取, day=当日受取
  payment_method  TEXT    NOT NULL DEFAULT '' CHECK(payment_method IN ('','salary','cash','free')),
                                              -- GAS: row[11] salary=給与天引き, cash=当日現金, free=FREE(招待)
  parking         INTEGER NOT NULL DEFAULT 0 CHECK(parking >= 0 AND parking <= 10),
                                              -- GAS: row[12] 駐車場台数
  note            TEXT    NOT NULL DEFAULT '',   -- GAS: row[13] 備考
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','confirmed','rejected','cancelled')),
                                              -- GAS STATUS_EN: pending/confirmed/rejected/cancelled
                                              -- GAS STATUS_JP: 確認中/確保済み/対応不可/キャンセル
  lang            TEXT    NOT NULL DEFAULT 'ja' CHECK(lang IN ('ja','en')),
  source          TEXT    NOT NULL DEFAULT 'web' CHECK(source IN ('web','line')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_app_id ON applications(app_id);
CREATE INDEX       IF NOT EXISTS idx_applications_player_game ON applications(player_id, game_id);
CREATE INDEX       IF NOT EXISTS idx_applications_game_id     ON applications(game_id);
CREATE INDEX       IF NOT EXISTS idx_applications_status      ON applications(status);

-- =====================================================
-- sessions
-- GAS 対応: CacheService.getScriptCache().put('SESS_{token}', playerId, 21600)
-- TTL はアプリ層で管理（expires_at との比較）
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT    PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL    -- ISO 8601 datetime
);

CREATE INDEX IF NOT EXISTS idx_sessions_player_id  ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- =====================================================
-- admin_sessions
-- GAS 対応: adminLogin が返す { role: 'admin', adminRole: 'ticket'|'manager' }
-- GAS は stateless(ハッシュ照合)。Worker はセッショントークンで管理
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT    PRIMARY KEY,
  admin_role  TEXT    NOT NULL CHECK(admin_role IN ('ticket','manager')),
  expires_at  TEXT    NOT NULL
);

-- =====================================================
-- admins
-- GAS 対応: 設定シート admin_password_hash / manager_password_hash
-- =====================================================
CREATE TABLE IF NOT EXISTS admins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT    NOT NULL UNIQUE CHECK(role IN ('ticket','manager')),
  pw_hash    TEXT    NOT NULL,     -- SHA-256(salt + password)。GAS互換
  api_token  TEXT    DEFAULT NULL, -- 管理 API トークン (GAS: ADMIN_API_TOKEN スクリプトプロパティ相当)
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================
-- audit_log
-- GAS 未実装。新規追加（管理操作・申込変更を全記録）
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT    NOT NULL,  -- 'player:{player_no}' | 'admin:{role}' | 'line:{line_user_id}' | 'system'
  action     TEXT    NOT NULL,  -- 'login' | 'submit' | 'cancel' | 'status_update' | 'game_crud' | 'player_crud'
  target     TEXT    NOT NULL,  -- 'application:{app_id}' | 'game:{game_no}' | 'player:{player_no}'
  detail     TEXT    NOT NULL DEFAULT '{}',  -- JSON
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- =====================================================
-- line_conv_state
-- GAS 対応: CacheService.getScriptCache() 'LINE_STATE_{lineUserId}' TTL=600秒
-- D1 で管理。TTL はアプリ層で expires_at 比較
-- =====================================================
CREATE TABLE IF NOT EXISTS line_conv_state (
  line_user_id TEXT    PRIMARY KEY,
  state        TEXT    NOT NULL DEFAULT '{}',  -- JSON (step, ticketType, gameId, adultCount, ...)
  expires_at   TEXT    NOT NULL
);

-- =====================================================
-- export_state (フェーズ5: シート出力用)
-- =====================================================
CREATE TABLE IF NOT EXISTS export_state (
  id              INTEGER PRIMARY KEY CHECK(id = 1),  -- シングルトン行
  last_exported_at TEXT    DEFAULT NULL,              -- 最終エクスポート datetime
  last_app_id     INTEGER DEFAULT 0                   -- 最後に出力した applications.id
);

INSERT OR IGNORE INTO export_state(id, last_exported_at, last_app_id) VALUES(1, NULL, 0);
