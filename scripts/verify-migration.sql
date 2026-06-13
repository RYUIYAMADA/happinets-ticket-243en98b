SELECT 'players' AS tbl, COUNT(*) AS cnt FROM players
UNION ALL SELECT 'games', COUNT(*) FROM games
UNION ALL SELECT 'applications', COUNT(*) FROM applications
UNION ALL SELECT 'admins', COUNT(*) FROM admins;

SELECT COUNT(*) AS missing_player_name
FROM players
WHERE TRIM(name) = '';

SELECT COUNT(*) AS missing_game_tipoff
FROM games
WHERE season = '2026-27' AND (tipoff IS NULL OR TRIM(tipoff) = '');

SELECT COUNT(*) AS missing_application_status
FROM applications
WHERE status NOT IN ('pending', 'confirmed', 'rejected', 'cancelled');

SELECT category, COUNT(*) AS cnt
FROM applications
GROUP BY category
ORDER BY category;

SELECT COUNT(*) AS players_with_line_user_id
FROM players
WHERE line_user_id IS NOT NULL AND TRIM(line_user_id) != '';

SELECT player_id, game_id, category, COUNT(*) AS duplicate_count
FROM applications
WHERE status != 'cancelled'
GROUP BY player_id, game_id, category
HAVING COUNT(*) > 1;
