export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

export function ok(data, origin, status = 200) {
  return json({ ok: true, data }, status, origin);
}

export function error(status, code, message, origin) {
  return json({ ok: false, error: { code, message } }, status, origin);
}

export function corsHeaders(origin) {
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
