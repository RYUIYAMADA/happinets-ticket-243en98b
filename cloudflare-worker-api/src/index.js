import { normalizePlayerNo } from "./domain.js";
import { error, ok } from "./http.js";
import { createPlayerSession, findPlayerByPlayerNo, listGames } from "./repo.js";

const PLAYER_SESSION_TTL_SECONDS = 6 * 60 * 60;

export function createApp(options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const randomToken = options.randomToken || (() => crypto.randomUUID());

  return {
    async fetch(request, env) {
      const origin = env.ALLOWED_ORIGIN || "http://127.0.0.1:8787";
      try {
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          } });
        }

        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/api/auth/login") {
          return handlePlayerLogin(request, env, origin, now, randomToken);
        }

        if (request.method === "GET" && url.pathname === "/api/games") {
          return handleListGames(url, env, origin, now);
        }

        return error(404, "NOT_FOUND", "Not Found", origin);
      } catch (err) {
        console.error("worker_error", err);
        return error(500, "INTERNAL_ERROR", "Internal Server Error", origin);
      }
    },
  };
}

async function handlePlayerLogin(request, env, origin, now, randomToken) {
  const body = await readJson(request);
  const rawPlayerId = body?.playerId;
  if (!rawPlayerId) {
    return error(400, "BAD_REQUEST", "playerId is required", origin);
  }

  const player = await findPlayerByPlayerNo(env.DB, rawPlayerId);
  if (!player) {
    return error(401, "UNAUTHORIZED", "Unauthorized", origin);
  }

  const issuedAt = new Date(now());
  const expiresAt = new Date(issuedAt.getTime() + PLAYER_SESSION_TTL_SECONDS * 1000).toISOString();
  const token = randomToken();

  await createPlayerSession(env.DB, token, player.id, expiresAt);

  return ok({
    token,
    playerId: normalizePlayerNo(rawPlayerId),
    playerNo: String(player.player_no).padStart(3, "0"),
    name: player.name,
    role: "player",
    expiresAt,
  }, origin);
}

async function handleListGames(url, env, origin, now) {
  const activeParam = url.searchParams.get("active");
  const filters = {
    season: url.searchParams.get("season") || "",
    active: activeParam === null ? undefined : activeParam === "true",
  };
  const games = await listGames(env.DB, filters, now());
  return ok(games, origin);
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  return request.json();
}

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
};
