import { mapGameRow, normalizePlayerNo } from "./domain.js";

export async function findPlayerByPlayerNo(db, playerId) {
  const playerNo = normalizePlayerNo(playerId);
  if (!playerNo) return null;
  return db
    .prepare(
      `SELECT id, player_no, name
       FROM players
       WHERE player_no = ?1 AND is_active = 1`
    )
    .bind(playerNo)
    .first();
}

export async function createPlayerSession(db, token, playerId, expiresAt) {
  const insertSession = db
    .prepare(
      `INSERT INTO sessions (token, player_id, expires_at)
       VALUES (?1, ?2, ?3)`
    )
    .bind(token, playerId, expiresAt);
  const insertAudit = db
    .prepare(
      `INSERT INTO audit_log (actor, action, target, detail)
       VALUES (?1, 'login', ?2, ?3)`
    )
    .bind(`player:${playerId}`, `player:${playerId}`, JSON.stringify({ tokenIssued: true }));
  await db.batch([insertSession, insertAudit]);
}

export async function listGames(db, filters, nowIso) {
  const where = [];
  const params = [];

  if (filters.season) {
    params.push(filters.season);
    where.push(`season = ?${params.length}`);
  }

  if (filters.active === true) {
    where.push(`is_active = 1`);
  }

  const sql = `
    SELECT game_no, date, day_of_week, tipoff, opponent, deadline, season, is_active
    FROM games
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY date ASC, game_no ASC
  `;

  const result = await db.prepare(sql).bind(...params).all();
  return (result.results || []).map((row) => mapGameRow(row, nowIso));
}
