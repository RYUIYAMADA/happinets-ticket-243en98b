export default {
  async fetch(request, env, ctx) {
    // 必須環境変数チェック（0バイト鍵による署名バイパス防止）
    if (!env.LINE_CHANNEL_SECRET || !env.GAS_URL || !env.WEBHOOK_SECRET) {
      return new Response('Service Unavailable: missing required environment variables', { status: 503 });
    }

    // POST 以外は 405
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // body を一度だけ取得
    const body = await request.text();

    // X-Line-Signature ヘッダ確認
    const signature = request.headers.get('X-Line-Signature');
    if (!signature) {
      return new Response('Bad Request: missing X-Line-Signature', { status: 400 });
    }

    // HMAC-SHA256 署名検証（WebCrypto）
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.LINE_CHANNEL_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body)
    );
    const computedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBytes))
    );

    if (computedSignature !== signature) {
      return new Response('Unauthorized: signature mismatch', { status: 401 });
    }

    // 署名 OK: GAS へバックグラウンド転送
    const gasUrl = env.GAS_URL + '?whsec=' + env.WEBHOOK_SECRET;
    ctx.waitUntil(
      fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }).catch((e) => {
        console.error('GAS forward failed', e);
      })
    );

    // LINE には即 200 を返す
    return new Response('{"status":"ok"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
