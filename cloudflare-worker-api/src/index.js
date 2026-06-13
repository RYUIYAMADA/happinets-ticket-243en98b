import {
  parseApplicationInput,
  parseGameInput,
  parsePlayerInput,
  parseStatusInput,
} from "./domain.js";
import { requireAdminSession, requirePlayerSession, requireTicketAdmin, verifyAdminPassword } from "./auth.js";
import { error, HttpError, ok } from "./http.js";
import {
  cancelApplication,
  createAdminSession,
  createApplication,
  createGame,
  createPlayer,
  createPlayerSession,
  deleteGame,
  findAdminByRole,
  findPlayerByPlayerNo,
  getLineStats,
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
      const origin = env.ALLOWED_ORIGIN || "http://127.0.0.1:8787";
      try {
        if (request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
          });
        }

        const url = new URL(request.url);
        const nowIso = now();

        if (request.method === "POST" && url.pathname === "/api/auth/login") {
          return await handlePlayerLogin(request, env, origin, nowIso, randomToken);
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
  return ok(await updateApplicationStatus(env.DB, appId, status, auth.session, nowIso), origin);
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
};
