import { error } from "./http.js";

export function readBearerToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : "";
}

export async function requirePlayerSession(request, env, origin) {
  const token = readBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: error(401, "UNAUTHORIZED", "Unauthorized", origin),
    };
  }

  const session = await env.DB
    .prepare(
      `SELECT s.token, s.player_id, s.expires_at, p.player_no, p.name
       FROM sessions s
       INNER JOIN players p ON p.id = s.player_id
       WHERE s.token = ?1 AND p.is_active = 1`
    )
    .bind(token)
    .first();

  if (!session || session.expires_at <= new Date().toISOString()) {
    return {
      ok: false,
      response: error(401, "UNAUTHORIZED", "Unauthorized", origin),
    };
  }

  return {
    ok: true,
    session,
  };
}
