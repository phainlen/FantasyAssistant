export interface KickoffWave {
  kickoffEpochMillis: number;
  playerIdsLocking: string[];
}

export interface ScheduleEvent {
  kickoffEpochMillis: number;
  teamAbbreviations: string[];
}

/**
 * Groups starters into kickoff waves for notification timing, since this league locks each
 * player individually at their own game's kickoff rather than the whole lineup at once.
 */
export function computeWaves(
  starterTeams: Record<string, string>, // playerId -> NFL team abbreviation
  weekEvents: ScheduleEvent[],
  waveGroupingMinutes = 30
): KickoffWave[] {
  const kickoffByTeam = new Map<string, number>();
  for (const event of weekEvents) {
    for (const team of event.teamAbbreviations) {
      kickoffByTeam.set(team, event.kickoffEpochMillis);
    }
  }

  const playerKickoffs: Array<[string, number]> = [];
  for (const [playerId, team] of Object.entries(starterTeams)) {
    const kickoff = kickoffByTeam.get(team);
    if (kickoff !== undefined) playerKickoffs.push([playerId, kickoff]);
  }

  playerKickoffs.sort((a, b) => a[1] - b[1]);

  const waves: Array<Array<[string, number]>> = [];
  const groupingMillis = waveGroupingMinutes * 60 * 1000;
  for (const entry of playerKickoffs) {
    const currentWave = waves[waves.length - 1];
    if (currentWave && entry[1] - currentWave[0][1] <= groupingMillis) {
      currentWave.push(entry);
    } else {
      waves.push([entry]);
    }
  }

  return waves.map((wave) => ({
    kickoffEpochMillis: wave[0][1],
    playerIdsLocking: wave.map(([playerId]) => playerId)
  }));
}

export function reminderTimeMillis(wave: KickoffWave, hoursBefore: number): number {
  return wave.kickoffEpochMillis - hoursBefore * 60 * 60 * 1000;
}
