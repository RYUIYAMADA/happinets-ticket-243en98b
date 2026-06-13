/**
 * liff.test.js — POST /api/auth/liff-login と /api/auth/link-liff の単体テスト
 *
 * LINE verify API は fetch モックで差し替える。
 * Node.js の --test ランナーで実行: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/index.js";

// ─── DB モック（api.test.js と同形式） ────────────────────────────────────────

function createDbMock(config = {}) {
  const batchCalls = [];
  return {
    batchCalls,
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
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

// ─── fetch モック用ユーティリティ ─────────────────────────────────────────────

/**
 * LINE verify API が返す正常レスポンスを模倣する fetch をグローバルに差し替える。
 * @param {object} payload - LINE verify API が返す JSON ペイロード
 */
function mockLineVerifySuccess(payload) {
  globalThis.fetch = async (url, _options) => {
    if (String(url).includes("api.line.me")) {
      return {
        ok: true,
        json: async () => payload,
      };
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

/**
 * LINE verify API がエラーを返す fetch をグローバルに差し替える。
 */
function mockLineVerifyFailure() {
  globalThis.fetch = async (url, _options) => {
    if (String(url).includes("api.line.me")) {
      return { ok: false, json: async () => ({ error: "invalid_id_token" }) };
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

const VALID_LINE_PAYLOAD = {
  iss: "https://access.line.me",
  aud: "1234567890",
  sub: "Uabcdef1234567890",
  exp: Math.floor(Date.now() / 1000) + 600, // 10分後に期限切れ
  name: "テスト太郎",
};

const FAKE_ID_TOKEN = "header.payload.signature"; // JWT形式3パートのダミー

// ─── POST /api/auth/liff-login ────────────────────────────────────────────────

test("POST /api/auth/liff-login: idToken なしは 400", async () => {
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t1" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const { DB } = createDbMock();
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error.code, "BAD_REQUEST");
});

test("POST /api/auth/liff-login: LINE_LOGIN_CHANNEL_ID 未設定は 503", async () => {
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t2" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const { DB } = createDbMock();
  // LINE_LOGIN_CHANNEL_ID を渡さない
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost" });
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.error.code, "CONFIGURATION_ERROR");
});

test("POST /api/auth/liff-login: LINE verify API がエラーを返した場合は 401", async () => {
  mockLineVerifyFailure();
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t3" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const { DB } = createDbMock();
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "INVALID_ID_TOKEN");
});

test("POST /api/auth/liff-login: 未連携 player は 409 UNLINKED", async () => {
  mockLineVerifySuccess(VALID_LINE_PAYLOAD);
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t4" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  // players に line_user_id が登録されていない（first が null を返す）
  const mock = createDbMock({ first: () => null });
  const res = await app.fetch(req, { DB: mock.DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error.code, "UNLINKED");
});

test("POST /api/auth/liff-login: 連携済み player は 200 でセッショントークンを返す", async () => {
  mockLineVerifySuccess(VALID_LINE_PAYLOAD);
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "fixed-liff-token" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const mock = createDbMock({
    first(sql) {
      if (sql.includes("FROM players")) {
        return { id: 6, player_no: "6", name: "#6 赤穂雷太", line_user_id: "Uabcdef1234567890" };
      }
      return null;
    },
  });
  const res = await app.fetch(req, { DB: mock.DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.data.token, "fixed-liff-token");
  assert.equal(json.data.playerId, "6");
  assert.equal(json.data.playerNo, "006");
  assert.equal(json.data.role, "player");
  assert.equal(mock.batchCalls.length, 1); // sessions INSERT を含む batch が1回呼ばれた
});

test("POST /api/auth/liff-login: iss が不正な場合は 401 INVALID_ID_TOKEN", async () => {
  mockLineVerifySuccess({ ...VALID_LINE_PAYLOAD, iss: "https://evil.example.com" });
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t5" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const { DB } = createDbMock();
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "INVALID_ID_TOKEN");
});

test("POST /api/auth/liff-login: aud が不一致の場合は 401 INVALID_ID_TOKEN", async () => {
  mockLineVerifySuccess({ ...VALID_LINE_PAYLOAD, aud: "9999999999" }); // aud != channelId
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t6" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const { DB } = createDbMock();
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "INVALID_ID_TOKEN");
});

test("POST /api/auth/liff-login: exp が過去の場合は 401 INVALID_ID_TOKEN", async () => {
  mockLineVerifySuccess({ ...VALID_LINE_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 60 }); // 既に期限切れ
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t7" });
  const req = new Request("https://example.com/api/auth/liff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const { DB } = createDbMock();
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "INVALID_ID_TOKEN");
});

// ─── POST /api/auth/link-liff ─────────────────────────────────────────────────

test("POST /api/auth/link-liff: playerId なしは 400", async () => {
  mockLineVerifySuccess(VALID_LINE_PAYLOAD);
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t8" });
  const req = new Request("https://example.com/api/auth/link-liff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN }),
  });
  const { DB } = createDbMock();
  const res = await app.fetch(req, { DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, "BAD_REQUEST");
});

test("POST /api/auth/link-liff: 背番号が存在しない場合は 401", async () => {
  mockLineVerifySuccess(VALID_LINE_PAYLOAD);
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "t9" });
  const req = new Request("https://example.com/api/auth/link-liff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN, playerId: "999" }),
  });
  // players に line_user_id もなく、player_no も存在しない
  const mock = createDbMock({ first: () => null });
  const res = await app.fetch(req, { DB: mock.DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("POST /api/auth/link-liff: 既に連携済みなら 200 でセッションを再発行", async () => {
  mockLineVerifySuccess(VALID_LINE_PAYLOAD);
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "reissued-token" });
  const req = new Request("https://example.com/api/auth/link-liff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN, playerId: "6" }),
  });
  const mock = createDbMock({
    first(sql) {
      // findPlayerByLineUserId → 連携済み player を返す
      if (sql.includes("line_user_id = ?1")) {
        return { id: 6, player_no: "6", name: "#6 赤穂雷太", line_user_id: "Uabcdef1234567890" };
      }
      return null;
    },
  });
  const res = await app.fetch(req, { DB: mock.DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.data.token, "reissued-token");
});

test("POST /api/auth/link-liff: 初回連携成功で 201 を返す", async () => {
  mockLineVerifySuccess(VALID_LINE_PAYLOAD);
  const app = createApp({ now: () => "2026-06-13T00:00:00.000Z", randomToken: () => "new-link-token" });
  const req = new Request("https://example.com/api/auth/link-liff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: FAKE_ID_TOKEN, playerId: "6" }),
  });
  let callCount = 0;
  const mock = createDbMock({
    first(sql) {
      // 1回目: findPlayerByLineUserId → null（未連携）
      // 2回目: findPlayerByPlayerNo → player を返す
      if (sql.includes("line_user_id = ?1")) return null; // 未連携
      if (sql.includes("player_no = ?1")) {
        callCount += 1;
        return { id: 6, player_no: "6", name: "#6 赤穂雷太" };
      }
      return null;
    },
  });
  const res = await app.fetch(req, { DB: mock.DB, ALLOWED_ORIGIN: "http://localhost", LINE_LOGIN_CHANNEL_ID: "1234567890" });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.data.token, "new-link-token");
  assert.equal(json.data.playerNo, "006");
});
