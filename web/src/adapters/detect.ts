/**
 * Source of a dropped CSV, from its header only (docs/etape-6-imdb.md, D5): IMDb and Letterboxd
 * both name their file `ratings.csv`, so the file name never decides.
 */
import Papa from 'papaparse';

export type CsvSource = 'imdb-ratings' | 'imdb-list' | 'letterboxd' | 'unknown';

/** Column names of the first line, lower case, without BOM, quotes or surrounding spaces. */
export function headerColumns(text: string): string[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const row = Papa.parse<string[]>(firstLine, { header: false }).data[0] ?? [];
  return row.map((c) => c.trim().replace(/^"|"$/g, '').trim().toLowerCase());
}

export function detectCsv(text: string): CsvSource {
  const cols = new Set(headerColumns(text));
  if (cols.has('const')) {
    return cols.has('your rating') && !cols.has('position') ? 'imdb-ratings' : 'imdb-list';
  }
  if (cols.has('name') && cols.has('letterboxd uri')) return 'letterboxd';
  return 'unknown';
}
