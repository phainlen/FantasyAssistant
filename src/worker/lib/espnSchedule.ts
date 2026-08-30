// lib/espnSchedule.ts
import type { ScheduleEvent } from "../domain/kickoffWaveCalculator";

export async function getWeekSchedule(week: number): Promise<ScheduleEvent[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
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
