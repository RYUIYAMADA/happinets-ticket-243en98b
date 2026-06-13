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

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

export async function verifyAdminPassword(password, salt, expectedHash) {
  const expectedBytes = hexToBytes(String(expectedHash || "").toLowerCase());
  if (!expectedBytes) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 },
    key,
    256
  );
  return timingSafeEqual(new Uint8Array(derived), expectedBytes);
}
