import type { ScheduleEvent } from "../domain/kickoffWaveCalculator";

/**
 * Sleeper doesn't expose individual game kickoff times. ESPN's public scoreboard endpoint is
 * free, unauthenticated, and widely used by the fantasy dev community for this — same
 * best-free-option tradeoff as the Android version. Swap for a paid provider if reliability
 * becomes an issue.
 */
export async function getWeekSchedule(week: number): Promise<ScheduleEvent[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    events: Array<{
      date: string;
      competitions: Array<{ competitors: Array<{ team: { abbreviation: string } }> }>;
    }>;
  };
  return data.events.map((event) => ({
    kickoffEpochMillis: Date.parse(event.date),
    teamAbbreviations: event.competitions.flatMap((c) => c.competitors.map((comp) => comp.team.abbreviation))
  }));
}
