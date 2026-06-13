import test from "node:test";
import assert from "node:assert/strict";

import { mapGameRow, normalizePlayerNo } from "../src/domain.js";
import { createApp } from "../src/index.js";

test("normalizePlayerNo strips zero padding like GAS", () => {
  assert.equal(normalizePlayerNo("006"), "6");
  assert.equal(normalizePlayerNo("101"), "101");
});

test("mapGameRow returns API contract shape with computed deadline flag", () => {
  const game = mapGameRow({
    game_no: "G01",
    date: "2026-10-08",
    day_of_week: "木",
    tipoff: null,
    opponent: "川崎ブレイブサンダース",
    deadline: "2099-10-01",
    season: "2026-27",
    is_active: 1,
  }, "2026-06-13T00:00:00.000Z");

  assert.deepEqual(game, {
    gameId: "G01",
    gameNo: "G01",
    date: "2026-10-08",
    dayOfWeek: "木",
    tipoff: null,
    opponent: "川崎ブレイブサンダース",
    deadline: "2099-10-01",
    isDeadlinePassed: false,
    season: "2026-27",
    isActive: true,
  });
});

test("POST /api/auth/login returns 401 when player does not exist", async () => {
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
    randomToken: () => "fixed-token",
  });
  const request = new Request("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: "999" }),
  });
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return null;
              },
            };
          },
        };
      },
      async batch() {
        return [];
      },
    },
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  const response = await app.fetch(request, env, {});
  const json = await response.json();

  assert.equal(response.status, 401);
  assert.deepEqual(json, {
    ok: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    },
  });
});

test("POST /api/auth/login returns token payload for an active player", async () => {
  const batchCalls = [];
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
    randomToken: () => "fixed-token",
  });
  const request = new Request("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: "006" }),
  });
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              sql,
              values,
              async first() {
                return { id: 6, player_no: "6", name: "#6 赤穂雷太" };
              },
            };
          },
        };
      },
      async batch(statements) {
        batchCalls.push(statements);
        return [];
      },
    },
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  const response = await app.fetch(request, env, {});
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.data, {
    token: "fixed-token",
    playerId: "6",
    playerNo: "006",
    name: "#6 赤穂雷太",
    role: "player",
    expiresAt: "2026-06-13T06:00:00.000Z",
  });
  assert.equal(batchCalls.length, 1);
});

test("GET /api/games is public and returns mapped games", async () => {
  const app = createApp({
    now: () => "2026-06-13T00:00:00.000Z",
  });
  const request = new Request("https://example.com/api/games?season=2026-27&active=true");
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      game_no: "G01",
                      date: "2026-10-08",
                      day_of_week: "木",
                      tipoff: null,
                      opponent: "川崎ブレイブサンダース",
                      deadline: "2026-10-01",
                      season: "2026-27",
                      is_active: 1,
                    },
                  ],
                };
              },
            };
          },
        };
      },
    },
    ALLOWED_ORIGIN: "http://127.0.0.1:8787",
  };

  const response = await app.fetch(request, env, {});
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(json, {
    ok: true,
    data: [
      {
        gameId: "G01",
        gameNo: "G01",
        date: "2026-10-08",
        dayOfWeek: "木",
        tipoff: null,
        opponent: "川崎ブレイブサンダース",
        deadline: "2026-10-01",
        isDeadlinePassed: false,
        season: "2026-27",
        isActive: true,
      },
    ],
  });
});
