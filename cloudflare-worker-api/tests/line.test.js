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
              sql,
              values,
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

test("POST /line/webhook throttles repeated link failures, then allows one successful link and blocks relink", async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
    randomToken: () => "APP-LINE",
  });
  const stateByUserId = new Map();
  const linkedByUserId = new Map();
  const mock = createDbMock({
    first(sql, values) {
      if (sql.includes("FROM line_conv_state")) {
        const state = stateByUserId.get(values[0]);
        return state ? { state: JSON.stringify(state.state), expires_at: state.expiresAt } : null;
      }
      if (sql.includes("WHERE line_user_id = ?1 AND is_active = 1")) {
        const linkedPlayer = linkedByUserId.get(values[0]);
        return linkedPlayer ? { ...linkedPlayer, line_user_id: values[0] } : null;
      }
      if (sql.includes("WHERE player_no")) {
        return values[0] === "6" ? { id: 6, player_no: "6", name: "#6 赤穂雷太" } : null;
      }
      return null;
    },
    batch(statements) {
      for (const statement of statements) {
        if (statement.sql.includes("INSERT INTO line_conv_state")) {
          stateByUserId.set(statement.values[0], {
            state: JSON.parse(statement.values[1]),
            expiresAt: statement.values[2],
          });
        }
        if (statement.sql.includes("DELETE FROM line_conv_state")) {
          stateByUserId.delete(statement.values[0]);
        }
        if (statement.sql.includes("UPDATE players SET line_user_id")) {
          linkedByUserId.set(statement.values[0], { id: 6, player_no: "6", name: "#6 赤穂雷太" });
        }
      }
      return [];
    },
  });
  const env = {
    DB: mock.DB,
    LINE_CHANNEL_SECRET: "line-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  for (let i = 1; i <= 5; i += 1) {
    const failureBody = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: `reply-fail-${i}`,
          source: { userId: "U123" },
          message: { type: "text", text: "9999" },
        },
      ],
    });
    const failureRequest = new Request("https://example.com/line/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Line-Signature": await signBody(failureBody, "line-secret"),
      },
      body: failureBody,
    });
    const response = await app.fetch(failureRequest, env, {});
    assert.equal(response.status, 200);
  }

  const lockedBody = JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "reply-locked",
        source: { userId: "U123" },
        message: { type: "text", text: "006" },
      },
    ],
  });
  const lockedRequest = new Request("https://example.com/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": await signBody(lockedBody, "line-secret"),
    },
    body: lockedBody,
  });
  const lockedResponse = await app.fetch(lockedRequest, env, {});
  assert.equal(lockedResponse.status, 200);
  assert.match(JSON.parse(fetchCalls.at(-1).options.body).messages[0].text, /Too many attempts/);

  stateByUserId.set("U123", {
    state: { linkFailures: 5, linkLockedUntil: "2026-06-12T23:59:59.000Z" },
    expiresAt: "2026-06-12T23:59:59.000Z",
  });
  const successBody = JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "reply-success",
        source: { userId: "U123" },
        message: { type: "text", text: "006" },
      },
    ],
  });
  const successRequest = new Request("https://example.com/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": await signBody(successBody, "line-secret"),
    },
    body: successBody,
  });
  const successResponse = await app.fetch(successRequest, env, {});
  const successJson = await successResponse.json();

  assert.equal(successResponse.status, 200);
  assert.equal(successJson.ok, true);
  assert.equal(linkedByUserId.get("U123")?.player_no, "6");
  assert.equal(stateByUserId.has("U123"), false);
  assert.match(JSON.parse(fetchCalls.at(-1).options.body).messages[0].text, /Registration complete!/);

  const relinkBody = JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "reply-relink",
        source: { userId: "U123" },
        message: { type: "text", text: "007" },
      },
    ],
  });
  const relinkRequest = new Request("https://example.com/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Line-Signature": await signBody(relinkBody, "line-secret"),
    },
    body: relinkBody,
  });
  const relinkResponse = await app.fetch(relinkRequest, env, {});
  assert.equal(relinkResponse.status, 200);
  assert.match(JSON.parse(fetchCalls.at(-1).options.body).messages[0].text, /already linked/);
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
