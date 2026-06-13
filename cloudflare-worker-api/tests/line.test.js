import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/index.js";

function createDbMock(config = {}) {
  const batchCalls = [];
  const prepareCalls = [];
  return {
    batchCalls,
    prepareCalls,
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            prepareCalls.push({ sql, values });
            return {
              async first() {
                return config.first ? config.first(sql, values) : null;
              },
              async all() {
                return config.all ? config.all(sql, values) : { results: [] };
              },
              async run() {
                return config.run ? config.run(sql, values) : { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
      async batch(statements) {
        batchCalls.push(statements);
        return config.batch ? config.batch(statements) : [];
      },
    },
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("POST /line/webhook returns 401 for invalid signature", async () => {
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
    randomToken: () => "APP-LINE",
  });
  const request = new Request("https://example.com/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": "invalid-signature",
    },
    body: JSON.stringify({ events: [] }),
  });
  const { DB } = createDbMock();
  const env = {
    DB,
    LINE_CHANNEL_SECRET: "line-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  const response = await app.fetch(request, env, {});
  const json = await response.json();

  assert.equal(response.status, 401);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("POST /line/webhook links player number and replies main menu for valid signature", async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const body = JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "reply-token",
        source: { userId: "U123" },
        message: { type: "text", text: "006" },
      },
    ],
  });
  const signature = await signBody(body, "line-secret");
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
    randomToken: () => "APP-LINE",
  });
  const request = new Request("https://example.com/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": signature,
    },
    body,
  });
  const mock = createDbMock({
    first(sql, values) {
      if (sql.includes("WHERE line_user_id")) return null;
      if (sql.includes("WHERE player_no")) return { id: 6, player_no: "6", name: "#6 赤穂雷太" };
      return null;
    },
  });
  const env = {
    DB: mock.DB,
    LINE_CHANNEL_SECRET: "line-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  const response = await app.fetch(request, env, {});
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(mock.batchCalls.length, 1);
  assert.equal(fetchCalls.length, 1);
  const replyPayload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(replyPayload.replyToken, "reply-token");
  assert.match(replyPayload.messages[0].text, /Registration complete!/);
});

test("POST /line/webhook menu:apply saves state and returns type quick reply", async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const body = JSON.stringify({
    events: [
      {
        type: "postback",
        replyToken: "reply-token",
        source: { userId: "U123" },
        postback: { data: "menu:apply" },
      },
    ],
  });
  const signature = await signBody(body, "line-secret");
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
    randomToken: () => "APP-LINE",
  });
  const request = new Request("https://example.com/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": signature,
    },
    body,
  });
  const mock = createDbMock({
    first(sql) {
      if (sql.includes("WHERE line_user_id")) {
        return { id: 6, player_no: "6", name: "#6 赤穂雷太", line_user_id: "U123" };
      }
      return null;
    },
  });
  const env = {
    DB: mock.DB,
    LINE_CHANNEL_SECRET: "line-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  const response = await app.fetch(request, env, {});
  assert.equal(response.status, 200);
  assert.equal(mock.batchCalls.length, 2);
  const replyPayload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(replyPayload.messages[0].text, "チケット種別を選んでください。");
  assert.equal(replyPayload.messages[0].quickReply.items.length, 3);
});

async function signBody(body, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Buffer.from(signature).toString("base64");
}
