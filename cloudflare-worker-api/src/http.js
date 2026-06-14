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
  const headers = {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  // origin が空文字の場合は CORS ヘッダーを付与しない（env.ALLOWED_ORIGIN 未設定時のフォールバック防止）
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
