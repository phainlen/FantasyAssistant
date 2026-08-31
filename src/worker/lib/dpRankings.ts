// src/worker/lib/dpRankings.ts
import type { ExternalProjection } from "./projectionSources";

/**
 * Free mirror of FantasyPros expert consensus rankings, maintained by
 * DynastyProcess.com. Confirmed live on 2026-08-31: this CSV bundles many
 * ranking sets (redraft/dynasty/best-ball/IDP) together, distinguished by
 * page_type. We only want the standard PPR redraft positional sheets.
 */
const REDRAFT_PPR_PAGE_TYPES: Record<string, string> = {
  QB: "redraft-qb",
  RB: "redraft-rb",
  WR: "redraft-wr",
  TE: "redraft-te",
  K: "redraft-k",
  DST: "redraft-dst"
};

// DynastyProcess's team abbreviations mostly match Sleeper's, with one
// confirmed exception: JAC vs Sleeper's JAX.
const TEAM_ABBREV_FIX: Record<string, string> = {
  JAC: "JAX"
};

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

export async function getDpRankings(): Promise<ExternalProjection[]> {
  const url = "https://github.com/dynastyprocess/data/raw/master/files/db_fpecr_latest.csv";
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`DynastyProcess rankings fetch failed: HTTP ${res.status}`);
    return [];
  }

  const rows = parseCsv(await res.text());
  const wantedPageTypes = new Set(Object.values(REDRAFT_PPR_PAGE_TYPES));

  const projections: ExternalProjection[] = [];
  for (const row of rows) {
    if (!wantedPageTypes.has(row.page_type)) continue;
    const ecr = Number(row.ecr);
    if (!Number.isFinite(ecr)) continue;

    const team = TEAM_ABBREV_FIX[row.team] ?? row.team;

    // This is the "cleaned-up push" — replaces the earlier version that
    // pushed first and then bolted `.team` on as an `any`-cast afterthought.
    projections.push({
      playerId: row.id,
      position: row.pos,
      fantasyProsRank: ecr,
      fullName: row.player,
      team
    });
  }

  return projections;
}
