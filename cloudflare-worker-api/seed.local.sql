DELETE FROM sessions;
DELETE FROM audit_log;
DELETE FROM applications;
DELETE FROM admin_sessions;
DELETE FROM players;
DELETE FROM games;
DELETE FROM sqlite_sequence WHERE name IN ('players', 'games', 'applications', 'admins', 'audit_log');

INSERT INTO players (player_no, name, name_en, is_active)
VALUES
  ('6', '#6 赤穂雷太', 'Raita Ako', 1),
  ('101', '#101 通訳スタッフ', 'Interpreter Staff', 1);

INSERT INTO games (game_no, date, tipoff, opponent, day_of_week, deadline, season, is_active)
VALUES
  ('G01', '2026-10-08', NULL, '川崎ブレイブサンダース', '木', '2026-10-01', '2026-27', 1),
  ('G02', '2026-10-15', '19:05', '宇都宮ブレックス', '木', '2026-10-08', '2026-27', 1),
  ('G03', '2026-09-20', NULL, '群馬クレインサンダーズ', '日', '2026-09-10', '2026-27', 0);

-- admin ローカル検証用 (password=admin-local-pass, salt=local-salt, PBKDF2/SHA-256/100000)
INSERT OR REPLACE INTO admins (role, pw_hash)
VALUES ('ticket', '5e480829ce06b0575567cc34f0e78546be19a5a722b4ecc0bb5de7829af124ea');
