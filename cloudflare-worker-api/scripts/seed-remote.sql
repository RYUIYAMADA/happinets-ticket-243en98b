-- remote seed for testing (2026-06-13)
-- テスト選手・試合・admin を投入

-- 選手
INSERT OR IGNORE INTO players (player_no, name, name_en, is_active)
VALUES
  ('6',   '#6 赤穂雷太',      'Raita Ako',        1),
  ('14',  '#14 中山拓哉',     'Takuya Nakayama',   1),
  ('22',  '#22 テストスタッフ', 'Test Staff',       1),
  ('99',  '#99 テスト選手',   'Test Player',       1),
  ('101', '#101 通訳スタッフ', 'Interpreter Staff', 1);

-- 試合（2026-27シーズン。締切は未来日）
INSERT OR IGNORE INTO games (game_no, date, tipoff, opponent, day_of_week, deadline, season, is_active)
VALUES
  ('G01', '2026-10-08', '19:05', '川崎ブレイブサンダース', '木', '2026-10-01', '2026-27', 1),
  ('G02', '2026-10-15', '19:05', '宇都宮ブレックス',       '木', '2026-10-08', '2026-27', 1),
  ('G03', '2026-10-22', '19:05', '広島ドラゴンフライズ',   '木', '2026-10-15', '2026-27', 1),
  ('G04', '2026-11-01', '14:05', '千葉ジェッツ',           '日', '2026-10-25', '2026-27', 1),
  ('G05', '2026-11-08', '14:05', '琉球ゴールデンキングス', '日', '2026-11-01', '2026-27', 1);

-- admin (password=happinets-test, salt=hnts-admin-salt-2026, PBKDF2/SHA-256/100000/32bytes)
INSERT OR REPLACE INTO admins (role, pw_hash)
VALUES (
  'ticket',
  '88c4ae817fea1e6ceb8b7b35350623df3072e0f031bf80b5ec9367aff6e3be69'
);
