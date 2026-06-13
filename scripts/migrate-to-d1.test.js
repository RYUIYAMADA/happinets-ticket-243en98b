const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMigrationSql,
  normalizeMigrationData,
  sqlString,
} = require("./migrate-to-d1-lib.js");

test("normalizeMigrationData drops APP-T* rows and strips admin hashes", () => {
  const normalized = normalizeMigrationData({
    exportedAt: "2026-06-13T16:00:00+09:00",
    season: "2026-27",
    players: [
      { playerNo: "006", name: "#6 赤穂雷太", lineUserId: "U123" },
    ],
    admins: [
      { role: "ticket", pw_hash: "should-not-survive", apiToken: "token-1" },
    ],
    games: [
      { gameNo: "G01", date: "2026/10/08", dayOfWeek: "木", opponent: "川崎", tipoff: "19:00", deadline: "2026/10/01" },
    ],
    applications: [
      { appId: "APP-T01", playerNo: "006", gameNo: "G01", category: "family" },
      { appId: "APP-1", playerNo: "006", gameNo: "G01", category: "family" },
    ],
  });

  assert.equal(normalized.players[0].playerNo, "6");
  assert.equal(normalized.applications.length, 1);
  assert.equal(normalized.applications[0].appId, "APP-1");
  assert.deepEqual(normalized.admins, [{ role: "ticket", apiToken: "token-1" }]);
});

test("sqlString escapes single quotes", () => {
  assert.equal(sqlString("O'Brien"), "'O''Brien'");
});

test("buildMigrationSql emits deterministic inserts with tipoff and receivers json", () => {
  const sql = buildMigrationSql(normalizeMigrationData({
    exportedAt: "2026-06-13T16:00:00+09:00",
    season: "2026-27",
    players: [
      { playerNo: "006", name: "#6 赤穂雷太", lineUserId: "U123" },
    ],
    admins: [],
    games: [
      { gameNo: "G01", date: "2026/10/08", dayOfWeek: "木", opponent: "川崎ブレイブサンダース", tipoff: "19:00", deadline: "2026/10/01" },
    ],
    applications: [
      {
        appId: "APP-1",
        playerNo: "006",
        gameNo: "G01",
        category: "family",
        quantityAdult: 2,
        quantityChild: 1,
        quantityInfant: 0,
        seatType: "",
        seatRequest: "",
        receivers: [{ name: "赤穂 由美" }],
        pickupMethod: "pre",
        paymentMethod: "",
        parking: 1,
        note: "備考",
        status: "confirmed",
        lang: "ja",
        source: "web",
        createdAt: "2026-10-01 09:00:00",
        updatedAt: "2026-10-01 09:00:00",
      },
    ],
  }));

  assert.match(sql, /DELETE FROM applications;/);
  assert.match(sql, /INSERT OR IGNORE INTO games/);
  assert.match(sql, /'19:00'/);
  assert.match(sql, /'\[\{"name":"赤穂 由美"\}\]'/);
  assert.match(sql, /SELECT id FROM players WHERE player_no = '6'/);
});
