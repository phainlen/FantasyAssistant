import type { ExternalProjection } from "./projectionSources";

const POSITION_ID_MAP: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST"
};

interface EspnPlayerEntry {
  player: {
    id: number;
    fullName: string;
    defaultPositionId: number;
    proTeamId: number;
    stats?: Array<{
      statSourceId: number;
      seasonId: number;
      scoringPeriodId: number;
      appliedTotal?: number;
    }>;
  };
}

interface EspnPlayersResponse {
  players: EspnPlayerEntry[];
}

export async function getEspnProjections(
  season: string,
  week: number
): Promise<ExternalProjection[]> {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info`;

  const res = await fetch(url, {
    headers: {
      "X-Fantasy-Filter": JSON.stringify({
        players: {
          limit: 2000,
          sortPercOwned: { sortPriority: 4, sortAsc: false }
        }
      })
    }
  });

  if (!res.ok) {
    console.error(`ESPN projections fetch failed: HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as EspnPlayersResponse;

  const projections: ExternalProjection[] = [];
  for (const entry of data.players ?? []) {
    const position = POSITION_ID_MAP[entry.player.defaultPositionId];
    if (!position) continue;

    const projectedStat = entry.player.stats?.find(
      (s) => s.statSourceId === 1 && s.scoringPeriodId === week
    );
    if (!projectedStat?.appliedTotal) continue;

    projections.push({
      playerId: String(entry.player.id),
      position,
      espnPoints: projectedStat.appliedTotal,
      proTeamId: position === "DST" ? entry.player.proTeamId : undefined
    });
  }

  return projections;
}
