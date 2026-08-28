/**
 * A minimal RFC4180-ish CSV reader — same scope/limits as the Android version. Good enough for
 * nflverse's exports; swap for a real library if nflverse ever emits something gnarlier.
 */
export interface CsvTable {
  hasColumn(name: string): boolean;
  rowsAsRecords(columns: string[]): Generator<Record<string, string>>;
}

export function parseCsv(text: string): CsvTable {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { hasColumn: () => false, rowsAsRecords: function* () {} };
  }

  const header = parseLine(lines[0]);
  const columnIndex = new Map(header.map((name, i) => [name, i]));
  const rows = lines.slice(1).map(parseLine);

  return {
    hasColumn: (name: string) => columnIndex.has(name),
    rowsAsRecords: function* (columns: string[]) {
      const indices = columns
        .map((col) => [col, columnIndex.get(col)] as const)
        .filter((pair): pair is [string, number] => pair[1] !== undefined);

      for (const row of rows) {
        const record: Record<string, string> = {};
        for (const [name, idx] of indices) record[name] = row[idx] ?? "";
        yield record;
      }
    }
  };
}

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes && c === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}
