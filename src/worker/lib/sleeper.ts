const BASE = "https://api.sleeper.app";

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string | null;
  metadata: Record<string, string | null> | null;
}

export function leagueUserTeamName(u: SleeperLeagueUser): string {
  return u.metadata?.team_name ?? u.display_name ?? "Unknown manager";
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
}

export interface SleeperNflState {
  week: number;
  season: string;
  season_type: string;
}

export interface SleeperPlayer {
  player_id: string | null;
  full_name: string | null;
  position: string | null;
  team: string | null;
  status: string | null;
  injury_status: string | null;
  gsis_id: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper API ${url} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const sleeper = {
  getUser: (usernameOrId: string) => getJson<SleeperUser>(`${BASE}/v1/user/${usernameOrId}`),

  getLeaguesForUser: (userId: string, season: string) =>
    getJson<SleeperLeague[]>(`${BASE}/v1/user/${userId}/leagues/nfl/${season}`),

  getLeague: (leagueId: string) => getJson<SleeperLeague>(`${BASE}/v1/league/${leagueId}`),

  getLeagueUsers: (leagueId: string) =>
    getJson<SleeperLeagueUser[]>(`${BASE}/v1/league/${leagueId}/users`),

  getRosters: (leagueId: string) => getJson<SleeperRoster[]>(`${BASE}/v1/league/${leagueId}/rosters`),

  getNflState: () => getJson<SleeperNflState>(`${BASE}/v1/state/nfl`),

  /** Undocumented but widely used by the fantasy dev community; same source Sleeper's live scoring uses. */
  getWeeklyStats: (season: string, week: number) =>
    getJson<Record<string, Record<string, number>>>(`${BASE}/v1/stats/nfl/regular/${season}/${week}`),

  /** ~5MB payload — cache aggressively, refresh at most daily (see KvStore.playersCacheAgeMillis). */
  getAllPlayers: () => getJson<Record<string, SleeperPlayer>>(`${BASE}/v1/players/nfl`)
};
