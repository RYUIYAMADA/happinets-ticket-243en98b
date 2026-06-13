export function normalizePlayerNo(playerId) {
  const normalized = String(parseInt(String(playerId), 10));
  return normalized === "NaN" ? "" : normalized;
}

export function mapGameRow(row, nowIso) {
  const nowDate = nowIso.slice(0, 10);
  return {
    gameId: row.game_no,
    gameNo: row.game_no,
    date: row.date,
    dayOfWeek: row.day_of_week,
    tipoff: row.tipoff ?? null,
    opponent: row.opponent,
    deadline: row.deadline,
    isDeadlinePassed: Boolean(row.deadline && row.deadline < nowDate),
    season: row.season,
    isActive: row.is_active === 1,
  };
}
