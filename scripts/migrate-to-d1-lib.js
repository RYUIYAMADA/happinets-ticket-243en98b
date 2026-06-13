const HOME_TIPOFF_BY_GAME_NO = {
  G01: "19:00", G02: "14:00", G03: "14:00", G04: "19:00", G05: "14:00",
  G06: "14:00", G07: "19:00", G08: "19:00", G09: "14:00", G10: "14:00",
  G11: "14:00", G12: "14:00", G13: "14:00", G14: "14:00", G15: "19:00",
  G16: "19:00", G17: "19:00", G18: "19:00", G19: "14:00", G20: "14:00",
  G21: "19:00", G22: "19:00", G23: "14:00", G24: "19:00", G25: "14:00",
  G26: "14:00", G27: "14:00", G28: "14:00", G29: "19:00", G30: "14:00",
};

function normalizePlayerNo(value) {
  if (value === null || value === undefined || value === "") {
    throw new Error("playerNo is required");
  }
  const digits = String(value).trim().replace(/^0+/, "");
  return digits === "" ? "0" : digits;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) {
    throw new Error(`Unsupported date format: ${value}`);
  }
  return toIsoDate(match[1], match[2], match[3]);
}

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return [
      toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`,
    ].join(" ");
  }
  const raw = String(value).trim().replace("T", " ").replace(/\.\d+Z$/, "");
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (!match) {
    throw new Error(`Unsupported datetime format: ${value}`);
  }
  const time = match[4].length === 5 ? `${match[4]}:00` : match[4];
  return `${toIsoDate(match[1], match[2], match[3])} ${time}`;
}

function normalizeTipoff(value, gameNo) {
  if (value) return String(value).trim();
  return HOME_TIPOFF_BY_GAME_NO[gameNo] || null;
}

function normalizeReceivers(value, fallbackName) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => ({ name: String(entry?.name || "").trim() }))
      .filter((entry) => entry.name);
  }
  if (value && typeof value === "object" && value.name) {
    return [{ name: String(value.name).trim() }];
  }
  if (fallbackName) {
    return [{ name: String(fallbackName).trim() }].filter((entry) => entry.name);
  }
  return [];
}

function normalizeApplication(row) {
  if (String(row.appId || "").startsWith("APP-T")) return null;
  return {
    appId: String(row.appId || "").trim(),
    playerNo: normalizePlayerNo(row.playerNo),
    gameNo: String(row.gameNo || "").trim(),
    category: String(row.category || "").trim(),
    quantityAdult: Number(row.quantityAdult || 0),
    quantityChild: Number(row.quantityChild || 0),
    quantityInfant: Number(row.quantityInfant || 0),
    seatType: String(row.seatType || ""),
    seatRequest: String(row.seatRequest || ""),
    receivers: normalizeReceivers(row.receivers, row.receiverName),
    pickupMethod: String(row.pickupMethod || ""),
    paymentMethod: String(row.paymentMethod || ""),
    parking: Number(row.parking || row.parkingCount || 0),
    note: String(row.note || ""),
    status: String(row.status || "pending"),
    lang: String(row.lang || "ja"),
    source: String(row.source || "web"),
    createdAt: normalizeDateTime(row.createdAt),
    updatedAt: normalizeDateTime(row.updatedAt || row.createdAt),
  };
}

function normalizeMigrationData(input) {
  const season = String(input.season || "2026-27");
  return {
    exportedAt: String(input.exportedAt || ""),
    season,
    admins: (input.admins || []).map((admin) => ({
      role: String(admin.role || "").trim(),
      apiToken: admin.apiToken ? String(admin.apiToken) : null,
    })),
    players: (input.players || []).map((player) => ({
      playerNo: normalizePlayerNo(player.playerNo),
      name: String(player.name || "").trim(),
      nameEn: String(player.nameEn || ""),
      lineUserId: player.lineUserId ? String(player.lineUserId) : null,
      isActive: player.isActive === 0 ? 0 : 1,
    })),
    games: (input.games || []).map((game) => ({
      gameNo: String(game.gameNo || "").trim(),
      date: normalizeDate(game.date),
      tipoff: normalizeTipoff(game.tipoff, String(game.gameNo || "").trim()),
      opponent: String(game.opponent || "").trim(),
      dayOfWeek: String(game.dayOfWeek || "").trim(),
      deadline: normalizeDate(game.deadline),
      season,
      isActive: game.isActive === 0 ? 0 : 1,
    })),
    applications: (input.applications || [])
      .map(normalizeApplication)
      .filter(Boolean),
  };
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  if (value === null || value === undefined || value === "") return "0";
  return String(Number(value));
}

function buildMigrationSql(data) {
  const lines = [
    "PRAGMA foreign_keys = ON;",
    "BEGIN TRANSACTION;",
    "",
    "-- applications -> players -> games の順で DELETE（FK 対応）",
    "DELETE FROM applications;",
    "DELETE FROM admin_sessions;",
    "DELETE FROM sessions;",
    "DELETE FROM line_conv_state;",
    "DELETE FROM audit_log;",
    "DELETE FROM games;",
    "DELETE FROM players;",
    "DELETE FROM admins;",
    "DELETE FROM sqlite_sequence WHERE name IN ('players', 'games', 'applications', 'admins', 'audit_log');",
    "",
  ];

  if (data.admins.length > 0) {
    lines.push("-- admins (pw_hash は別手順)");
    lines.push("INSERT OR IGNORE INTO admins (role, pw_hash, api_token)");
    lines.push("VALUES");
    lines.push(data.admins.map((admin) => `  (${sqlString(admin.role)}, '', ${sqlString(admin.apiToken)})`).join(",\n") + ";");
    lines.push("");
  }

  if (data.players.length > 0) {
    lines.push("-- players");
    lines.push("INSERT OR IGNORE INTO players (player_no, name, name_en, line_user_id, is_active)");
    lines.push("VALUES");
    lines.push(data.players.map((player) => `  (${sqlString(player.playerNo)}, ${sqlString(player.name)}, ${sqlString(player.nameEn)}, ${sqlString(player.lineUserId)}, ${sqlNumber(player.isActive)})`).join(",\n") + ";");
    lines.push("");
  }

  if (data.games.length > 0) {
    lines.push("-- games");
    lines.push("INSERT OR IGNORE INTO games (game_no, date, tipoff, opponent, day_of_week, deadline, season, is_active)");
    lines.push("VALUES");
    lines.push(data.games.map((game) => `  (${sqlString(game.gameNo)}, ${sqlString(game.date)}, ${sqlString(game.tipoff)}, ${sqlString(game.opponent)}, ${sqlString(game.dayOfWeek)}, ${sqlString(game.deadline)}, ${sqlString(game.season)}, ${sqlNumber(game.isActive)})`).join(",\n") + ";");
    lines.push("");
  }

  if (data.applications.length > 0) {
    lines.push("-- applications");
    for (const app of data.applications) {
      lines.push(
        "INSERT OR IGNORE INTO applications",
        "  (app_id, player_id, game_id, category, quantity_adult, quantity_child, quantity_infant,",
        "   seat_type, seat_request, receivers, pickup_method, payment_method, parking, note,",
        "   status, lang, source, created_at, updated_at)",
        "VALUES (",
        `  ${sqlString(app.appId)},`,
        `  (SELECT id FROM players WHERE player_no = ${sqlString(app.playerNo)}),`,
        `  (SELECT id FROM games WHERE game_no = ${sqlString(app.gameNo)} AND season = ${sqlString(data.season)}),`,
        `  ${sqlString(app.category)}, ${sqlNumber(app.quantityAdult)}, ${sqlNumber(app.quantityChild)}, ${sqlNumber(app.quantityInfant)},`,
        `  ${sqlString(app.seatType)}, ${sqlString(app.seatRequest)}, ${sqlString(JSON.stringify(app.receivers))}, ${sqlString(app.pickupMethod)}, ${sqlString(app.paymentMethod)}, ${sqlNumber(app.parking)}, ${sqlString(app.note)},`,
        `  ${sqlString(app.status)}, ${sqlString(app.lang)}, ${sqlString(app.source)}, ${sqlString(app.createdAt)}, ${sqlString(app.updatedAt)}`,
        ");",
        ""
      );
    }
  }

  lines.push("COMMIT;");
  lines.push("");
  return lines.join("\n");
}

module.exports = {
  HOME_TIPOFF_BY_GAME_NO,
  buildMigrationSql,
  normalizeMigrationData,
  sqlString,
};
