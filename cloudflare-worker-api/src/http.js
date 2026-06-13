export function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

export function ok(data, origin) {
  return json({ ok: true, data }, 200, origin);
}

export function error(status, code, message, origin) {
  return json(
    { ok: false, error: { code, message } },
    status,
    origin,
  );
}

export function corsHeaders(origin) {
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
