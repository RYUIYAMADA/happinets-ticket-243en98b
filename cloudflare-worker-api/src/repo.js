import {
  deriveDayOfWeek,
  deriveDeadline,
  formatPlayerNo,
  mapApplicationRow,
  mapGameRow,
  mapPlayerRow,
  normalizePlayerNo,
} from "./domain.js";
import { HttpError } from "./http.js";

export async function findPlayerByPlayerNo(db, playerId) {
  const playerNo = normalizePlayerNo(playerId);
  if (!playerNo) return null;
  return db.prepare(
    `SELECT id, player_no, name
     FROM players
     WHERE player_no = ?1 AND is_active = 1`
  ).bind(playerNo).first();
}

export async function findPlayerByLineUserId(db, lineUserId) {
  if (!lineUserId) return null;
  return db.prepare(
    `SELECT id, player_no, name, name_en, line_user_id
     FROM players
     WHERE line_user_id = ?1 AND is_active = 1`
  ).bind(lineUserId).first();
}

export async function linkLineUserIdToPlayer(db, playerId, lineUserId) {
  const player = await findPlayerByPlayerNo(db, playerId);
  if (!player) return null;

  // 既存の line_user_id が別 player に紐付いている場合は解除（再連携対応）
  const operations = [
    // 旧 player の line_user_id を解除
    db.prepare(`UPDATE players SET line_user_id = NULL WHERE line_user_id = ?1 AND id != ?2`).bind(lineUserId, player.id),
    // 新 player に line_user_id を付与
    db.prepare(`UPDATE players SET line_user_id = ?1 WHERE id = ?2`).bind(lineUserId, player.id),
    audit(db, `player:${player.id}`, "line_link", `player:${player.player_no}`, { linked: true, lineUserId }),
  ];

  await db.batch(operations);
  return player;
}

export async function createPlayerSession(db, token, playerId, expiresAt) {
  await db.batch([
    db.prepare(`INSERT INTO sessions (token, player_id, expires_at) VALUES (?1, ?2, ?3)`).bind(token, playerId, expiresAt),
    audit(db, `player:${playerId}`, "login", `player:${playerId}`, { tokenIssued: true }),
  ]);
}

export async function createAdminSession(db, token, admin, expiresAt) {
  await db.batch([
    db.prepare(`UPDATE admins SET failed_count = 0, locked_until = NULL WHERE id = ?1`).bind(admin.id),
    db.prepare(`INSERT INTO admin_sessions (token, admin_role, expires_at) VALUES (?1, ?2, ?3)`).bind(token, admin.role, expiresAt),
    audit(db, `admin:${admin.id}`, "admin_login", `admin:${admin.role}`, { tokenIssued: true }),
  ]);
}

export async function recordAdminLoginFailure(db, admin, nowIso) {
  const nextCount = Number(admin.failed_count || 0) + 1;
  const lockedUntil = nextCount >= 5 ? new Date(new Date(nowIso).getTime() + 10 * 60 * 1000).toISOString() : null;
  await db.batch([
    db.prepare(`UPDATE admins SET failed_count = ?1, locked_until = ?2 WHERE id = ?3`).bind(nextCount, lockedUntil, admin.id),
    audit(db, `admin:${admin.id}`, "admin_login_failed", `admin:${admin.role}`, { failedCount: nextCount }),
  ]);
}

export async function findAdminByRole(db, role = "ticket") {
  return db.prepare(
    `SELECT id, role, pw_hash, failed_count, locked_until
     FROM admins
     WHERE role = ?1`
  ).bind(role).first();
}

export async function logoutSession(db, token) {
  const playerSession = await db.prepare(`SELECT token, player_id FROM sessions WHERE token = ?1`).bind(token).first();
  const adminSession = await db.prepare(`SELECT token, admin_role FROM admin_sessions WHERE token = ?1`).bind(token).first();
  const statements = [
    db.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token),
    db.prepare(`DELETE FROM admin_sessions WHERE token = ?1`).bind(token),
  ];
  if (playerSession) statements.push(audit(db, `player:${playerSession.player_id}`, "logout", `player:${playerSession.player_id}`, {}));
  if (adminSession) statements.push(audit(db, `admin:${adminSession.admin_role}`, "logout", `admin:${adminSession.admin_role}`, {}));
  await db.batch(statements);
}

export async function listGames(db, filters, nowIso) {
  const where = [];
  const params = [];
  if (filters.season) {
    params.push(filters.season);
    where.push(`season = ?${params.length}`);
  }
  if (filters.active === true) where.push("is_active = 1");
  const result = await db.prepare(
    `SELECT game_no, date, day_of_week, tipoff, opponent, deadline, season, is_active
     FROM games
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY date ASC, game_no ASC`
  ).bind(...params).all();
  return (result.results || []).map((row) => mapGameRow(row, nowIso));
}

export async function findGameByIdentifier(db, gameId) {
  if (/^G\d+$/i.test(String(gameId))) {
    return db.prepare(
      `SELECT id, game_no, date, day_of_week, opponent, deadline, season, is_active
       FROM games
       WHERE game_no = ?1`
    ).bind(String(gameId)).first();
  }
  return db.prepare(
    `SELECT id, game_no, date, day_of_week, opponent, deadline, season, is_active
     FROM games
     WHERE id = ?1`
  ).bind(Number.parseInt(String(gameId), 10)).first();
}

export async function ensureNoDuplicateApplication(db, playerId, gameId, category) {
  const existing = await db.prepare(
    `SELECT app_id
     FROM applications
     WHERE player_id = ?1 AND game_id = ?2 AND category = ?3 AND status != 'cancelled'`
  ).bind(playerId, gameId, category).first();
  if (existing) throw new HttpError(409, "DUPLICATE", "Duplicate application");
}

export async function createApplication(db, playerSession, payload, appId, nowIso) {
  const game = await findGameByIdentifier(db, payload.gameId);
  if (!game) throw new HttpError(404, "NOT_FOUND", "Game not found");
  if (game.deadline && game.deadline < nowIso.slice(0, 10)) {
    throw new HttpError(410, "DEADLINE_PASSED", "Deadline passed");
  }
  await ensureNoDuplicateApplication(db, playerSession.player_id, game.id, payload.category);
  await db.batch([
    db.prepare(
      `INSERT INTO applications (
        app_id, player_id, game_id, category, quantity_adult, quantity_child, quantity_infant,
        seat_type, seat_request, receivers, pickup_method, payment_method, parking, note,
        status, lang, source, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'pending', ?15, ?16, ?17, ?18)`
    ).bind(
      appId,
      playerSession.player_id,
      game.id,
      payload.category,
      payload.quantityAdult,
      payload.quantityChild,
      payload.quantityInfant,
      payload.seatType,
      payload.seatRequest,
      JSON.stringify(payload.receiverName ? [{ name: payload.receiverName }] : []),
      payload.pickupMethod,
      payload.paymentMethod,
      payload.parkingCount,
      payload.note,
      payload.lang,
      payload.source,
      nowIso,
      nowIso
    ),
    audit(db, `player:${playerSession.player_id}`, "submit", `application:${appId}`, { gameNo: game.game_no, category: payload.category }),
  ]);
}

export async function cancelApplication(db, appId, playerId, nowIso) {
  const result = await db.batch([
    db.prepare(
      `UPDATE applications
       SET status = 'cancelled', updated_at = ?1
       WHERE app_id = ?2 AND player_id = ?3`
    ).bind(nowIso, appId, playerId),
    audit(db, `player:${playerId}`, "cancel", `application:${appId}`, {}),
  ]);
  if ((result[0]?.meta?.changes || 0) === 0) {
    const exists = await db.prepare(`SELECT app_id FROM applications WHERE app_id = ?1`).bind(appId).first();
    if (!exists) throw new HttpError(404, "NOT_FOUND", "Application not found");
    throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  }
  return { applicationId: appId, status: "cancelled" };
}

export async function listApplicationsByPlayer(db, playerId) {
  const result = await db.prepare(applicationQuery(`
    WHERE a.player_id = ?1
  `)).bind(playerId).all();
  return (result.results || []).map(mapApplicationRow);
}

export async function listAdminApplications(db, filters = {}) {
  const where = [];
  const params = [];
  if (filters.gameId) {
    params.push(filters.gameId);
    where.push(`g.game_no = ?${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    where.push(`a.category = ?${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`a.status = ?${params.length}`);
  }
  if (filters.playerId) {
    params.push(normalizePlayerNo(filters.playerId));
    where.push(`p.player_no = ?${params.length}`);
  }
  const result = await db.prepare(applicationQuery(where.length ? `WHERE ${where.join(" AND ")}` : "")).bind(...params).all();
  return (result.results || []).map(mapApplicationRow);
}

export async function updateApplicationStatus(db, appId, status, adminSession, nowIso) {
  const existing = await db.prepare(`SELECT app_id FROM applications WHERE app_id = ?1`).bind(appId).first();
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Application not found");
  await db.batch([
    db.prepare(`UPDATE applications SET status = ?1, updated_at = ?2 WHERE app_id = ?3`).bind(status, nowIso, appId),
    audit(db, `admin:${adminSession.admin_role}`, "status_update", `application:${appId}`, { status }),
  ]);
  return { applicationId: appId, status, updated: true };
}

export async function findApplicationForNotification(db, appId) {
  const row = await db.prepare(
    `SELECT
       a.app_id,
       a.category,
       p.line_user_id,
       g.date,
       g.day_of_week,
       g.opponent
     FROM applications a
     INNER JOIN players p ON p.id = a.player_id
     INNER JOIN games g ON g.id = a.game_id
     WHERE a.app_id = ?1`
  ).bind(appId).first();
  if (!row) return null;
  return {
    ...row,
    game_label: buildGameLabel({ date: row.date, day_of_week: row.day_of_week, opponent: row.opponent }),
  };
}

export async function listPlayers(db) {
  const result = await db.prepare(
    `SELECT player_no, name, name_en, line_user_id, is_active
     FROM players
     ORDER BY CAST(player_no AS INTEGER) ASC`
  ).bind().all();
  return (result.results || []).map(mapPlayerRow);
}

export async function createPlayer(db, payload) {
  const existing = await db.prepare(`SELECT id FROM players WHERE player_no = ?1`).bind(payload.playerNo).first();
  if (existing) throw new HttpError(409, "DUPLICATE", "Duplicate player");
  await db.batch([
    db.prepare(
      `INSERT INTO players (player_no, name, name_en, line_user_id, is_active)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(payload.playerNo, payload.name, payload.nameEn || "", payload.lineUserId || null, payload.isActive === false ? 0 : 1),
    audit(db, "admin:ticket", "player_crud", `player:${payload.playerNo}`, { type: "create" }),
  ]);
  return {
    playerId: payload.playerNo,
    playerNo: formatPlayerNo(payload.playerNo),
    name: payload.name,
  };
}

export async function updatePlayer(db, playerNo, payload) {
  const existing = await db.prepare(`SELECT id, player_no, name, name_en, line_user_id, is_active FROM players WHERE player_no = ?1`).bind(playerNo).first();
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Player not found");
  const next = {
    name: payload.name ?? existing.name,
    nameEn: payload.nameEn ?? existing.name_en,
    lineUserId: payload.lineUserId === undefined ? existing.line_user_id : payload.lineUserId,
    isActive: payload.isActive === undefined ? existing.is_active : payload.isActive ? 1 : 0,
  };
  await db.batch([
    db.prepare(
      `UPDATE players
       SET name = ?1, name_en = ?2, line_user_id = ?3, is_active = ?4
       WHERE player_no = ?5`
    ).bind(next.name, next.nameEn, next.lineUserId || null, next.isActive, playerNo),
    audit(db, "admin:ticket", "player_crud", `player:${playerNo}`, { type: "update" }),
  ]);
  return mapPlayerRow({
    player_no: playerNo,
    name: next.name,
    name_en: next.nameEn,
    line_user_id: next.lineUserId,
    is_active: next.isActive,
  });
}

export async function createGame(db, payload) {
  const nextNo = await nextGameNo(db);
  const date = payload.date;
  const dayOfWeek = payload.dayOfWeek || deriveDayOfWeek(date);
  const deadline = payload.deadline || deriveDeadline(date);
  await db.batch([
    db.prepare(
      `INSERT INTO games (game_no, date, tipoff, opponent, day_of_week, deadline, season, is_active)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)`
    ).bind(nextNo, date, payload.tipoff, payload.opponent, dayOfWeek, deadline, payload.season || "2026-27"),
    audit(db, "admin:ticket", "game_crud", `game:${nextNo}`, { type: "create" }),
  ]);
  return mapGameRow({
    game_no: nextNo,
    date,
    day_of_week: dayOfWeek,
    tipoff: payload.tipoff,
    opponent: payload.opponent,
    deadline,
    season: payload.season || "2026-27",
    is_active: 1,
  }, new Date().toISOString());
}

export async function updateGame(db, gameNo, payload, nowIso) {
  const existing = await db.prepare(
    `SELECT game_no, date, tipoff, opponent, day_of_week, deadline, season, is_active
     FROM games
     WHERE game_no = ?1`
  ).bind(gameNo).first();
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Game not found");
  const date = payload.date ?? existing.date;
  const next = {
    date,
    tipoff: payload.tipoff === undefined ? existing.tipoff : payload.tipoff,
    opponent: payload.opponent ?? existing.opponent,
    dayOfWeek: payload.date ? deriveDayOfWeek(date) : payload.dayOfWeek ?? existing.day_of_week,
    deadline: payload.deadline === undefined ? existing.deadline : payload.deadline,
    season: payload.season ?? existing.season,
    isActive: payload.isActive === undefined ? existing.is_active : payload.isActive ? 1 : 0,
  };
  await db.batch([
    db.prepare(
      `UPDATE games
       SET date = ?1, tipoff = ?2, opponent = ?3, day_of_week = ?4, deadline = ?5, season = ?6, is_active = ?7
       WHERE game_no = ?8`
    ).bind(next.date, next.tipoff, next.opponent, next.dayOfWeek, next.deadline, next.season, next.isActive, gameNo),
    audit(db, "admin:ticket", "game_crud", `game:${gameNo}`, { type: "update" }),
  ]);
  return mapGameRow({
    game_no: gameNo,
    date: next.date,
    tipoff: next.tipoff,
    opponent: next.opponent,
    day_of_week: next.dayOfWeek,
    deadline: next.deadline,
    season: next.season,
    is_active: next.isActive,
  }, nowIso);
}

export async function updateGameDeadline(db, gameNo, deadline) {
  const existing = await db.prepare(`SELECT game_no FROM games WHERE game_no = ?1`).bind(gameNo).first();
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Game not found");
  await db.batch([
    db.prepare(`UPDATE games SET deadline = ?1 WHERE game_no = ?2`).bind(deadline, gameNo),
    audit(db, "admin:ticket", "game_crud", `game:${gameNo}`, { type: "deadline_update", deadline }),
  ]);
  return { gameNo, deadline, updated: true };
}

export async function deleteGame(db, gameNo) {
  const existing = await db.prepare(`SELECT game_no FROM games WHERE game_no = ?1`).bind(gameNo).first();
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Game not found");
  const hasApps = await db.prepare(
    `SELECT 1
     FROM applications a
     INNER JOIN games g ON g.id = a.game_id
     WHERE g.game_no = ?1
     LIMIT 1`
  ).bind(gameNo).first();
  if (hasApps) throw new HttpError(409, "HAS_APPLICATIONS", "Game has applications");
  await db.batch([
    db.prepare(`DELETE FROM games WHERE game_no = ?1`).bind(gameNo),
    audit(db, "admin:ticket", "game_crud", `game:${gameNo}`, { type: "delete" }),
  ]);
  return { gameNo, deleted: true };
}

export async function replaceSeason(db, season, games) {
  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM games WHERE season = ?1) AS games_count,
       (SELECT COUNT(*) FROM applications WHERE game_id IN (SELECT id FROM games WHERE season = ?1)) AS apps_count`
  ).bind(season).first();
  const statements = [
    db.prepare(`DELETE FROM applications WHERE game_id IN (SELECT id FROM games WHERE season = ?1)`).bind(season),
    db.prepare(`DELETE FROM games WHERE season = ?1`).bind(season),
  ];
  for (const game of games) {
    statements.push(
      db.prepare(
        `INSERT INTO games (game_no, date, tipoff, opponent, day_of_week, deadline, season, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)`
      ).bind(game.gameNo, game.date, game.tipoff ?? null, game.opponent, game.dayOfWeek || deriveDayOfWeek(game.date), game.deadline || deriveDeadline(game.date), season)
    );
  }
  statements.push(audit(db, "admin:ticket", "replace_season", `season:${season}`, { inserted: games.length }));
  await db.batch(statements);
  return {
    backedUpGames: counts?.games_count || 0,
    backedUpApps: counts?.apps_count || 0,
    inserted: games.length,
  };
}

export async function getLineStats(env) {
  const token = env?.LINE_CHANNEL_ACCESS_TOKEN || "";
  if (!token) {
    return { quota: 200, used: 0, remaining: 200, note: "LINE未設定" };
  }
  const headers = { Authorization: `Bearer ${token}` };
  const [quotaRes, usedRes] = await Promise.all([
    fetch("https://api.line.me/v2/bot/message/quota", { headers }),
    fetch("https://api.line.me/v2/bot/message/quota/consumption", { headers }),
  ]);
  if (!quotaRes.ok || !usedRes.ok) {
    return { quota: 0, used: 0, remaining: 0, note: "LINE quota fetch failed" };
  }
  const quotaJson = await quotaRes.json();
  const usedJson = await usedRes.json();
  const quota = Number(quotaJson?.value || 0);
  const used = Number(usedJson?.totalUsage || 0);
  return { quota, used, remaining: Math.max(0, quota - used) };
}

export async function saveConversationState(db, lineUserId, state, expiresAt) {
  await db.batch([
    db.prepare(
      `INSERT INTO line_conv_state (line_user_id, state, expires_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(line_user_id) DO UPDATE SET state = excluded.state, expires_at = excluded.expires_at`
    ).bind(lineUserId, JSON.stringify(state || {}), expiresAt),
  ]);
}

export async function getConversationState(db, lineUserId, nowIso) {
  const row = await db.prepare(
    `SELECT state, expires_at
     FROM line_conv_state
     WHERE line_user_id = ?1`
  ).bind(lineUserId).first();
  if (!row || row.expires_at <= nowIso) return null;
  try {
    return JSON.parse(row.state || "{}");
  } catch {
    return null;
  }
}

export async function clearConversationState(db, lineUserId) {
  await db.batch([
    db.prepare(`DELETE FROM line_conv_state WHERE line_user_id = ?1`).bind(lineUserId),
  ]);
}

export async function listUpcomingGamesForLine(db, nowIso, limit = 20) {
  const result = await db.prepare(
    `SELECT game_no, date, day_of_week, tipoff, opponent, deadline, season, is_active
     FROM games
     WHERE is_active = 1
       AND deadline IS NOT NULL
       AND deadline >= ?1
     ORDER BY date ASC, game_no ASC
     LIMIT ?2`
  ).bind(nowIso.slice(0, 10), limit).all();
  return (result.results || []).map((row) => mapGameRow(row, nowIso));
}

export async function listConfirmedApplicationsForDate(db, date) {
  const result = await db.prepare(
    `SELECT
       p.line_user_id,
       g.date,
       g.day_of_week,
       g.opponent,
       a.category,
       a.quantity_adult,
       a.quantity_child,
       a.quantity_infant,
       a.receivers
     FROM applications a
     INNER JOIN players p ON p.id = a.player_id
     INNER JOIN games g ON g.id = a.game_id
     WHERE g.date = ?1
       AND a.status = 'confirmed'
       AND p.line_user_id IS NOT NULL
     ORDER BY p.player_no ASC, a.app_id ASC`
  ).bind(date).all();
  const grouped = new Map();
  for (const row of result.results || []) {
    if (!grouped.has(row.line_user_id)) {
      grouped.set(row.line_user_id, {
        lineUserId: row.line_user_id,
        gameLabel: buildGameLabel({ date: row.date, day_of_week: row.day_of_week, opponent: row.opponent }),
        applications: [],
      });
    }
    const receivers = safeParseReceivers(row.receivers);
    grouped.get(row.line_user_id).applications.push({
      ticketType: row.category,
      quantityAdult: row.quantity_adult,
      quantityChild: row.quantity_child,
      quantityInfant: row.quantity_infant,
      receiverName: receivers[0]?.name || "",
    });
  }
  return [...grouped.values()];
}

export async function deleteExpiredSessions(db, nowIso) {
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at <= ?1`).bind(nowIso),
    db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?1`).bind(nowIso),
    db.prepare(`DELETE FROM line_conv_state WHERE expires_at <= ?1`).bind(nowIso),
  ]);
}

function audit(db, actor, action, target, detail) {
  return db.prepare(
    `INSERT INTO audit_log (actor, action, target, detail)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(actor, action, target, JSON.stringify(detail || {}));
}

async function nextGameNo(db) {
  const row = await db.prepare(
    `SELECT MAX(CAST(SUBSTR(game_no, 2) AS INTEGER)) AS max_no
     FROM games`
  ).bind().first();
  const next = Number(row?.max_no || 0) + 1;
  return `G${String(next).padStart(2, "0")}`;
}

function applicationQuery(whereClause) {
  return `
    SELECT
      a.app_id,
      p.player_no,
      p.name AS player_name,
      g.game_no,
      g.date AS game_date,
      g.day_of_week AS game_day_of_week,
      g.opponent,
      a.category,
      a.quantity_adult,
      a.quantity_child,
      a.quantity_infant,
      a.seat_type,
      a.seat_request,
      a.receivers,
      a.pickup_method,
      a.payment_method,
      a.parking,
      a.note,
      a.status,
      a.lang,
      a.source,
      a.created_at,
      a.updated_at
    FROM applications a
    INNER JOIN players p ON p.id = a.player_id
    INNER JOIN games g ON g.id = a.game_id
    ${whereClause}
    ORDER BY a.created_at DESC, a.app_id DESC
  `;
}

function safeParseReceivers(receivers) {
  try {
    const parsed = JSON.parse(receivers || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
