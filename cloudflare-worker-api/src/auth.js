import { error, HttpError } from "./http.js";

export function readBearerToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : "";
}

export async function requirePlayerSession(request, env, origin, nowIso) {
  const token = readBearerToken(request);
  if (!token) {
    return { ok: false, response: error(401, "UNAUTHORIZED", "Unauthorized", origin) };
  }

  const session = await env.DB.prepare(
    `SELECT s.token, s.player_id, s.expires_at, p.player_no, p.name
     FROM sessions s
     INNER JOIN players p ON p.id = s.player_id
     WHERE s.token = ?1 AND p.is_active = 1`
  ).bind(token).first();

  if (!session || session.expires_at <= nowIso) {
    return { ok: false, response: error(401, "UNAUTHORIZED", "Unauthorized", origin) };
  }

  return { ok: true, session };
}

export async function requireAdminSession(request, env, origin, nowIso) {
  const token = readBearerToken(request);
  if (!token) {
    return { ok: false, response: error(401, "UNAUTHORIZED", "Unauthorized", origin) };
  }

  const session = await env.DB.prepare(
    `SELECT token, admin_role, expires_at
     FROM admin_sessions
     WHERE token = ?1`
  ).bind(token).first();

  if (!session || session.expires_at <= nowIso) {
    return { ok: false, response: error(401, "UNAUTHORIZED", "Unauthorized", origin) };
  }

  return { ok: true, session };
}

export function requireTicketAdmin(adminSession) {
  if (adminSession.admin_role !== "ticket") {
    throw new HttpError(403, "FORBIDDEN", "Forbidden");
  }
}

export async function verifyAdminPassword(password, salt, expectedHash) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 },
    key,
    256
  );
  const actual = [...new Uint8Array(derived)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === expectedHash;
}
