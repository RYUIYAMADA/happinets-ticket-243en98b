import {
  parseApplicationInput,
  parseGameInput,
  parsePlayerInput,
  parseStatusInput,
} from "./domain.js";
import { requireAdminSession, requirePlayerSession, requireTicketAdmin, verifyAdminPassword } from "./auth.js";
import { error, HttpError, ok } from "./http.js";
import { broadcastDeadlineAnnouncement, buildDeadlineAnnouncementMessages, handleLineWebhook, handleScheduledLineJobs, sendApplicationConfirmPush, sendStatusUpdatePush } from "./line.js";
import { listGamesWithDeadlineTomorrow } from "./repo.js";
import {
  cancelApplication,
  createAdminSession,
  createApplication,
  createGame,
  createPlayer,
  createPlayerSession,
  deleteGame,
  findAdminByRole,
  findPlayerByLineUserId,
  findPlayerByPlayerNo,
  getLineStats,
  linkLineUserIdToPlayer,
  listAdminApplications,
  listApplicationsByPlayer,
  listGames,
  listPlayers,
  logoutSession,
  recordAdminLoginFailure,
  replaceSeason,
  updateApplicationStatus,
  updateGame,
  updateGameDeadline,
  updatePlayer,
} from "./repo.js";

const PLAYER_SESSION_TTL_SECONDS = 6 * 60 * 60;
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

export function createApp(options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const randomToken = options.randomToken || (() => crypto.randomUUID());
  const checkAdminPassword = options.verifyAdminPassword || verifyAdminPassword;

  return {
    async fetch(request, env) {
      const origin = env.ALLOWED_ORIGIN || "";
      try {
        if (request.method === "OPTIONS") {
          const corsOpts = {
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          };
          if (origin) corsOpts["Access-Control-Allow-Origin"] = origin;
          return new Response(null, { status: 204, headers: corsOpts });
        }

        const url = new URL(request.url);
        const nowIso = now();

        if (request.method === "POST" && url.pathname === "/api/auth/login") {
          return await handlePlayerLogin(request, env, origin, nowIso, randomToken);
        }
        if (request.method === "POST" && url.pathname === "/api/auth/liff-login") {
          return await handleLiffLogin(request, env, origin, nowIso, randomToken);
        }
        if (request.method === "POST" && url.pathname === "/api/auth/link-liff") {
          return await handleLinkLiff(request, env, origin, nowIso, randomToken);
        }
        if (request.method === "POST" && url.pathname === "/line/webhook") {
          return await handleLineWebhook(request, env, origin, nowIso, randomToken);
        }
        if (request.method === "POST" && url.pathname === "/api/auth/admin-login") {
          return await handleAdminLogin(request, env, origin, nowIso, randomToken, checkAdminPassword);
        }
        if (request.method === "POST" && url.pathname === "/api/auth/logout") {
          return await handleLogout(request, env, origin);
        }
        if (request.method === "GET" && url.pathname === "/api/games") {
          return await handleListGames(url, env, origin, nowIso);
        }
        if (request.method === "POST" && url.pathname === "/api/applications") {
          return await handleCreateApplication(request, env, origin, nowIso, randomToken);
        }
        if (request.method === "GET" && url.pathname === "/api/applications") {
          return await handleListOwnApplications(request, url, env, origin, nowIso);
        }
        {
          const matched = url.pathname.match(/^\/api\/applications\/([^/]+)\/cancel$/);
          if (request.method === "PUT" && matched) {
            return await handleCancelApplication(request, env, origin, nowIso, decodeURIComponent(matched[1]));
          }
        }
        if (request.method === "GET" && url.pathname === "/api/admin/applications") {
          return await handleAdminApplications(request, url, env, origin, nowIso);
        }
        {
          const matched = url.pathname.match(/^\/api\/admin\/applications\/([^/]+)\/status$/);
          if (request.method === "PUT" && matched) {
            return await handleAdminUpdateStatus(request, env, origin, nowIso, decodeURIComponent(matched[1]));
          }
        }
        if (request.method === "GET" && url.pathname === "/api/admin/players") {
          return await handleAdminPlayers(request, env, origin, nowIso);
        }
        if (request.method === "POST" && url.pathname === "/api/admin/players") {
          return await handleAdminCreatePlayer(request, env, origin, nowIso);
        }
        {
          const matched = url.pathname.match(/^\/api\/admin\/players\/([^/]+)$/);
          if (request.method === "PUT" && matched) {
            return await handleAdminUpdatePlayer(request, env, origin, nowIso, decodeURIComponent(matched[1]));
          }
        }
        if (request.method === "POST" && url.pathname === "/api/admin/games") {
          return await handleAdminCreateGame(request, env, origin, nowIso);
        }
        {
          const deadlineMatch = url.pathname.match(/^\/api\/admin\/games\/([^/]+)\/deadline$/);
          if (request.method === "PUT" && deadlineMatch) {
            return await handleAdminUpdateDeadline(request, env, origin, nowIso, decodeURIComponent(deadlineMatch[1]));
          }
        }
        if (request.method === "POST" && url.pathname === "/api/admin/games/replace-season") {
          return await handleReplaceSeason(request, env, origin, nowIso);
        }
        if (request.method === "GET" && url.pathname === "/api/admin/line-stats") {
          return await handleLineStats(request, env, origin, nowIso);
        }
        if (request.method === "POST" && url.pathname === "/api/admin/announce-deadline") {
          return await handleAnnounceDeadline(request, url, env, origin, nowIso);
        }
        {
          const gameMatch = url.pathname.match(/^\/api\/admin\/games\/([^/]+)$/);
          if (request.method === "PUT" && gameMatch) {
            return await handleAdminUpdateGame(request, env, origin, nowIso, decodeURIComponent(gameMatch[1]));
          }
          if (request.method === "DELETE" && gameMatch) {
            return await handleAdminDeleteGame(request, env, origin, nowIso, decodeURIComponent(gameMatch[1]));
          }
        }
        return error(404, "NOT_FOUND", "Not Found", origin);
      } catch (err) {
        if (err instanceof HttpError) {
          return error(err.status, err.code, err.message, origin);
        }
        console.error("worker_error", err);
        return error(500, "INTERNAL_ERROR", "Internal Server Error", origin);
      }
    },
  };
}

async function handlePlayerLogin(request, env, origin, nowIso, randomToken) {
  const body = await readJson(request);
  const rawPlayerId = body?.playerId;
  if (!rawPlayerId) throw new HttpError(400, "BAD_REQUEST", "playerId is required");
  const player = await findPlayerByPlayerNo(env.DB, rawPlayerId);
  if (!player) throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  const expiresAt = addSeconds(nowIso, PLAYER_SESSION_TTL_SECONDS);
  const token = randomToken();
  await createPlayerSession(env.DB, token, player.id, expiresAt);
  return ok({
    token,
    playerId: String(player.player_no),
    playerNo: String(player.player_no).padStart(3, "0"),
    name: player.name,
    role: "player",
    expiresAt,
  }, origin);
}

/**
 * POST /api/auth/liff-login
 * LIFFのIDトークンをLINE verify APIで検証し、player特定 → セッション発行。
 * 未連携の場合は 409 UNLINKED を返す。
 */
async function handleLiffLogin(request, env, origin, nowIso, randomToken) {
  let body;
  try {
    body = await readJson(request);
    const idToken = body?.idToken;
    if (!idToken || typeof idToken !== "string" || idToken.split(".").length !== 3) {
      throw new HttpError(400, "BAD_REQUEST", "idToken is required or invalid format");
    }
    const channelId = env.LINE_LOGIN_CHANNEL_ID;
    if (!channelId) {
      throw new HttpError(503, "CONFIGURATION_ERROR", "LINE_LOGIN_CHANNEL_ID is not configured");
    }
    const lineUserId = await verifyLineIdToken(idToken, channelId);
    const player = await findPlayerByLineUserId(env.DB, lineUserId);
    if (!player) {
      return new Response(JSON.stringify({ ok: false, error: { code: "UNLINKED", message: "Player not linked" } }), {
        status: 409,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
    const token = randomToken();
    const expiresAt = addSeconds(nowIso, PLAYER_SESSION_TTL_SECONDS);
    await createPlayerSession(env.DB, token, player.id, expiresAt);
    return ok({
      token,
      playerId: String(player.player_no),
      playerNo: String(player.player_no).padStart(3, "0"),
      name: player.name,
      role: "player",
      expiresAt,
    }, origin);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : (e.message || "Authentication failed");
    const code = e instanceof HttpError ? e.code : "AUTH_ERROR";
    const status = e instanceof HttpError ? e.status : 400;
    console.error("handleLiffLogin error:", { code, message: msg, idTokenLen: body?.idToken?.length });
    return error(status, code, msg, origin);
  }
}

/**
 * POST /api/auth/link-liff
 * 初回連携: IDトークン検証 → line_user_id を players に紐付け → セッション発行。
 * body: { idToken, playerId }  playerId は背番号 (例: "006")
 */
async function handleLinkLiff(request, env, origin, nowIso, randomToken) {
  let body;
  try {
    body = await readJson(request);
    const idToken = body?.idToken;
    const rawPlayerId = body?.playerId;
    if (!idToken || typeof idToken !== "string" || idToken.split(".").length !== 3) {
      throw new HttpError(400, "BAD_REQUEST", "idToken is required or invalid format");
    }
    if (!rawPlayerId) {
      throw new HttpError(400, "BAD_REQUEST", "playerId is required");
    }
    const channelId = env.LINE_LOGIN_CHANNEL_ID;
    if (!channelId) {
      throw new HttpError(503, "CONFIGURATION_ERROR", "LINE_LOGIN_CHANNEL_ID is not configured");
    }
    // IDトークン再検証（lineUserIdをフロントから受け取らずWorker側で取得する = 改ざん防止）
    const lineUserId = await verifyLineIdToken(idToken, channelId);
    // 既に連携済みのアカウントが存在するか確認
    const alreadyLinked = await findPlayerByLineUserId(env.DB, lineUserId);
    if (alreadyLinked) {
      // 既連携ならそのままセッション発行（再連携操作として扱う）
      const token = randomToken();
      const expiresAt = addSeconds(nowIso, PLAYER_SESSION_TTL_SECONDS);
      await createPlayerSession(env.DB, token, alreadyLinked.id, expiresAt);
      return ok({
        token,
        playerId: String(alreadyLinked.player_no),
        playerNo: String(alreadyLinked.player_no).padStart(3, "0"),
        name: alreadyLinked.name,
        role: "player",
        expiresAt,
      }, origin);
    }
    // 背番号で選手を検索して line_user_id を登録
    const player = await linkLineUserIdToPlayer(env.DB, rawPlayerId, lineUserId);
    if (!player) {
      throw new HttpError(401, "UNAUTHORIZED", "Player not found");
    }
    const token = randomToken();
    const expiresAt = addSeconds(nowIso, PLAYER_SESSION_TTL_SECONDS);
    await createPlayerSession(env.DB, token, player.id, expiresAt);
    return ok({
      token,
      playerId: String(player.player_no),
      playerNo: String(player.player_no).padStart(3, "0"),
      name: player.name,
      role: "player",
      expiresAt,
    }, origin, 201);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : (e.message || "Link failed");
    const code = e instanceof HttpError ? e.code : "LINK_ERROR";
    const status = e instanceof HttpError ? e.status : 400;
    console.error("handleLinkLiff error:", { code, message: msg, playerId: body?.playerId });
    return error(status, code, msg, origin);
  }
}

/**
 * LINE verify API でIDトークンを検証し line_user_id (sub) を返す。
 * iss / aud / exp の必須チェックを含む。
 */
async function verifyLineIdToken(idToken, channelId) {
  const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!verifyRes.ok) {
    // LINEが検証エラーを返した場合（期限切れ・不正トークン等）
    throw new HttpError(401, "INVALID_ID_TOKEN", "ID token verification failed");
  }
  const payload = await verifyRes.json();
  // 必須フィールド検証
  if (payload.iss !== "https://access.line.me") {
    throw new HttpError(401, "INVALID_ID_TOKEN", "Invalid issuer");
  }
  if (String(payload.aud) !== String(channelId)) {
    throw new HttpError(401, "INVALID_ID_TOKEN", "Invalid audience");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new HttpError(401, "INVALID_ID_TOKEN", "ID token expired");
  }
  if (!payload.sub) {
    throw new HttpError(401, "INVALID_ID_TOKEN", "Missing sub claim");
  }
  return String(payload.sub);
}

async function handleAdminLogin(request, env, origin, nowIso, randomToken, checkAdminPassword) {
  const body = await readJson(request);
  if (!body?.password) throw new HttpError(400, "BAD_REQUEST", "password is required");
  const admin = await findAdminByRole(env.DB, "ticket");
  if (!admin) throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  if (admin.locked_until && admin.locked_until > nowIso) {
    throw new HttpError(429, "RATE_LIMITED", "LOCKED");
  }
  const verified = await checkAdminPassword(body.password, env.ADMIN_SALT || "", admin.pw_hash);
  if (!verified) {
    await recordAdminLoginFailure(env.DB, admin, nowIso);
    throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  }
  const token = randomToken();
  const expiresAt = addSeconds(nowIso, ADMIN_SESSION_TTL_SECONDS);
  await createAdminSession(env.DB, token, admin, expiresAt);
  return ok({ token, role: "admin", adminRole: admin.role, expiresAt }, origin);
}

async function handleLogout(request, env, origin) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/, "") || "";
  if (token) await logoutSession(env.DB, token);
  return ok(undefined, origin);
}

async function handleListGames(url, env, origin, nowIso) {
  const activeParam = url.searchParams.get("active");
  const games = await listGames(env.DB, {
    season: url.searchParams.get("season") || "",
    active: activeParam === null ? undefined : activeParam === "true",
  }, nowIso);
  return ok(games, origin);
}

async function handleCreateApplication(request, env, origin, nowIso, randomToken) {
  const auth = await requirePlayerSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  const payload = parseApplicationInput(body, nowIso);
  const appId = randomToken();
  await createApplication(env.DB, auth.session, payload, appId, nowIso);
  // 申込完了後、非同期でLINE push（失敗しても申込成功を妨げない）
  sendApplicationConfirmPush(env, appId).catch((err) => {
    console.error("confirm_push_unhandled", { appId, error: err?.message });
  });
  return ok({ applicationId: appId }, origin, 201);
}

async function handleCancelApplication(request, env, origin, nowIso, appId) {
  const auth = await requirePlayerSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  return ok(await cancelApplication(env.DB, appId, auth.session.player_id, nowIso), origin);
}

async function handleListOwnApplications(request, url, env, origin, nowIso) {
  const auth = await requirePlayerSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  if (url.searchParams.has("playerId")) throw new HttpError(400, "BAD_REQUEST", "playerId query is not allowed");
  return ok(await listApplicationsByPlayer(env.DB, auth.session.player_id), origin);
}

async function handleAdminApplications(request, url, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  return ok(await listAdminApplications(env.DB, {
    gameId: url.searchParams.get("gameId") || "",
    category: url.searchParams.get("category") || "",
    status: url.searchParams.get("status") || "",
    playerId: url.searchParams.get("playerId") || "",
  }), origin);
}

async function handleAdminUpdateStatus(request, env, origin, nowIso, appId) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  const status = parseStatusInput(await readJson(request));
  const result = await updateApplicationStatus(env.DB, appId, status, auth.session, nowIso);
  await sendStatusUpdatePush(env, appId, status);
  return ok(result, origin);
}

async function handleAdminPlayers(request, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  return ok(await listPlayers(env.DB), origin);
}

async function handleAdminCreatePlayer(request, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  const payload = parsePlayerInput(await readJson(request));
  return ok(await createPlayer(env.DB, payload), origin, 201);
}

async function handleAdminUpdatePlayer(request, env, origin, nowIso, playerNo) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  const payload = parsePlayerInput(await readJson(request), playerNo);
  return ok(await updatePlayer(env.DB, payload.playerNo, payload), origin);
}

async function handleAdminCreateGame(request, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  return ok(await createGame(env.DB, parseGameInput(await readJson(request))), origin, 201);
}

async function handleAdminUpdateGame(request, env, origin, nowIso, gameNo) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  return ok(await updateGame(env.DB, gameNo, parseGameInput(await readJson(request), gameNo), nowIso), origin);
}

async function handleAdminDeleteGame(request, env, origin, nowIso, gameNo) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  return ok(await deleteGame(env.DB, gameNo), origin);
}

async function handleAdminUpdateDeadline(request, env, origin, nowIso, gameNo) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  const body = await readJson(request);
  if (!body?.deadline) throw new HttpError(400, "BAD_REQUEST", "deadline is required");
  return ok(await updateGameDeadline(env.DB, gameNo, body.deadline), origin);
}

async function handleReplaceSeason(request, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);
  const body = await readJson(request);
  if (!body?.season || !Array.isArray(body.games)) throw new HttpError(400, "BAD_REQUEST", "season and games are required");
  return ok(await replaceSeason(env.DB, body.season, body.games), origin);
}

async function handleLineStats(request, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  return ok(await getLineStats(env), origin);
}

/**
 * POST /api/admin/announce-deadline?dryRun=true
 * 締切前日アナウンスをプレビューまたは実送信する。
 * dryRun=true: 文面のみ返却（実 broadcast しない）。
 * dryRun=false or 省略: 実際に broadcast を実行。
 */
async function handleAnnounceDeadline(request, url, env, origin, nowIso) {
  const auth = await requireAdminSession(request, env, origin, nowIso);
  if (!auth.ok) return auth.response;
  requireTicketAdmin(auth.session);

  const dryRun = url.searchParams.get("dryRun") === "true";
  const games = await listGamesWithDeadlineTomorrow(env.DB, nowIso);

  if (dryRun) {
    const messages = games.length ? buildDeadlineAnnouncementMessages(games) : [];
    return ok({
      dryRun: true,
      gameCount: games.length,
      preview: messages.map((m) => m.text).join("\n---\n"),
    }, origin);
  }

  const result = await broadcastDeadlineAnnouncement(env, nowIso);
  return ok({ dryRun: false, ...result }, origin);
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) return null;
  return request.json();
}

function addSeconds(isoString, seconds) {
  return new Date(new Date(isoString).getTime() + seconds * 1000).toISOString();
}

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return handleScheduledLineJobs(controller, env, ctx);
  },
};
