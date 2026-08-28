import { parseCsv } from "./csv";

/**
 * nflverse (https://github.com/nflverse/nflverse-data) is the free source for snap counts and
 * target share, which Sleeper doesn't expose. Data is published as CSV assets on GitHub
 * releases, refreshed roughly weekly (Tuesdays).
 *
 * IMPORTANT — verify before relying on this: the release tags and column names below reflect
 * nflverse's schema as documented/observed when this was written, but this integration has not
 * been run against live data (same caveat as the Android version — see its README). Hit both
 * endpoints once and confirm the CSV header matches the column-name constants below; if
 * nflverse has renamed anything, this file is the only place to fix it.
 */

const PLAYER_STATS_RELEASE_TAG = "stats_player";
const SNAP_COUNTS_RELEASE_TAG = "snap_counts";

const COL_PLAYER_ID = "player_id"; // GSIS id, e.g. "00-0019596"
const COL_WEEK = "week";
const COL_TARGET_SHARE = "target_share";

const COL_SNAP_PLAYER_ID = "gsis_id";
const COL_SNAP_WEEK = "week";
const COL_OFFENSE_PCT = "offense_pct";

interface GithubAsset {
  name: string;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

async function findCsvAssetUrl(releaseTag: string, season: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/nflverse/nflverse-data/releases/tags/${releaseTag}`, {
    headers: { "User-Agent": "duck-assistant-web" } // GitHub API requires a UA header
  });
  if (!res.ok) return null;
  const release = (await res.json()) as GithubRelease;
  return (
    release.assets.find((asset) => asset.name.endsWith(".csv") && asset.name.includes(season))
      ?.browser_download_url ?? null
  );
}

/** week -> gsisPlayerId -> target share (0.0-1.0) */
export async function getWeeklyTargetShare(
  season: string,
  throughWeek: number
): Promise<Map<number, Map<string, number>>> {
  const url = await findCsvAssetUrl(PLAYER_STATS_RELEASE_TAG, season);
  if (!url) return new Map();

  const text = await (await fetch(url)).text();
  const table = parseCsv(text);
  if (!table.hasColumn(COL_TARGET_SHARE)) return new Map(); // schema drifted — see file doc

  const result = new Map<number, Map<string, number>>();
  for (const row of table.rowsAsRecords([COL_PLAYER_ID, COL_WEEK, COL_TARGET_SHARE])) {
    const week = Number(row[COL_WEEK]);
    if (!week || week > throughWeek) continue;
    const playerId = row[COL_PLAYER_ID];
    const share = Number(row[COL_TARGET_SHARE]);
    if (!playerId || Number.isNaN(share)) continue;
    if (!result.has(week)) result.set(week, new Map());
    result.get(week)!.set(playerId, share);
  }
  return result;
}

/** week -> gsisPlayerId -> offensive snap percentage (0.0-1.0) */
export async function getWeeklySnapPercentage(
  season: string,
  throughWeek: number
): Promise<Map<number, Map<string, number>>> {
  const url = await findCsvAssetUrl(SNAP_COUNTS_RELEASE_TAG, season);
  if (!url) return new Map();

  const text = await (await fetch(url)).text();
  const table = parseCsv(text);
  if (!table.hasColumn(COL_OFFENSE_PCT)) return new Map(); // schema drifted — see file doc

  const result = new Map<number, Map<string, number>>();
  for (const row of table.rowsAsRecords([COL_SNAP_PLAYER_ID, COL_SNAP_WEEK, COL_OFFENSE_PCT])) {
    const week = Number(row[COL_SNAP_WEEK]);
    if (!week || week > throughWeek) continue;
    const playerId = row[COL_SNAP_PLAYER_ID];
    const pct = Number(row[COL_OFFENSE_PCT]);
    if (!playerId || Number.isNaN(pct)) continue;
    if (!result.has(week)) result.set(week, new Map());
    result.get(week)!.set(playerId, pct);
  }
  return result;
}
