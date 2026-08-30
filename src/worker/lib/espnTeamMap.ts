// lib/espnTeamMap.ts
/**
 * ESPN proTeamId -> Sleeper-style team abbreviation. Confirmed live against
 * https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams
 * on 2026-08-30. IDs 31 and 32 are unused gaps in ESPN's numbering (not a bug).
 * Only WSH -> WAS needs translation; every other ESPN abbreviation already
 * matches Sleeper's convention.
 */
export const ESPN_TEAM_ID_TO_SLEEPER_ABBREV: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
  28: "WAS", // ESPN's live API returns WSH; normalized to Sleeper's WAS
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"
};
