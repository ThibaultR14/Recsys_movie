/**
 * IMDb ratings export adapter (docs/etape-6-imdb.md, D1). Runs locally, no network.
 *
 * Reads Const, Your Rating, Date Rated, Title, Original Title, Title Type and Year by header name;
 * every other column (IMDb Rating, Num Votes, Genres, Directors…) is ignored.
 */
import { parseCsv } from './letterboxd';
import { detectCsv } from './detect';
import type { AdapterResult, HistoryEntry } from './types';

export const IMDB_SCALE_MAX = 10;

/**
 * Title types that get the title fallback (D3): the six IMDb types of the catalogue's films.
 * A row without a type counts as a film. Every other type (series, episodes, games…) does not.
 */
export const FILM_TITLE_TYPES: ReadonlySet<string> = new Set([
  'movie',
  'tvmovie',
  'short',
  'video',
  'tvspecial',
  'tvshort',
]);

/** "TV Movie", "tvMovie", "tv-movie" -> "tvmovie". */
export function normalizeTitleType(value: string | undefined): string | undefined {
  const t = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  return t || undefined;
}

export function isFilmType(titleType: string | undefined): boolean {
  return titleType === undefined || FILM_TITLE_TYPES.has(titleType);
}

/** Strict UTF-8, else Windows-1252 (some old IMDb exports); a BOM is dropped. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const IMDB_ID = /^tt\d+$/;

function parseYear(value: string | undefined): number | undefined {
  const y = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(y) && y > 1800 && y < 2200 ? y : undefined;
}

function parseRating(value: string | undefined, warnings: string[]): number | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const r = Number(v);
  if (Number.isInteger(r) && r >= 1 && r <= IMDB_SCALE_MAX) return r;
  warnings.push(`note ignorée : « ${v} »`);
  return undefined;
}

function parseDate(value: string | undefined): string | undefined {
  const d = (value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

/** IMDb ratings CSV (already decoded) -> one entry per row. */
export function parseImdbCsv(text: string): AdapterResult {
  const source = detectCsv(text);
  if (source !== 'imdb-ratings') {
    const warning =
      source === 'imdb-list'
        ? 'liste ou watchlist imdb : pas de notes'
        : 'fichier non reconnu comme export imdb';
    return { entries: [], filesRead: [], warnings: [warning] };
  }
  const warnings: string[] = [];
  const entries: HistoryEntry[] = [];
  for (const row of parseCsv(text)) {
    const title = (row['Title'] ?? '').trim();
    const rawId = (row['Const'] ?? '').trim().toLowerCase();
    if (!title && !rawId) continue;
    const imdbId = IMDB_ID.test(rawId) ? rawId : undefined;
    if (rawId && !imdbId) warnings.push(`identifiant imdb ignoré : « ${rawId} »`);
    const year = parseYear(row['Year']);
    const original = (row['Original Title'] ?? '').trim();
    const entry: HistoryEntry = {
      title: title || original,
      year,
      imdbId,
      rating: parseRating(row['Your Rating'], warnings),
      scaleMax: IMDB_SCALE_MAX,
      date: parseDate(row['Date Rated']),
      source: 'imdb',
      sourceKey: imdbId ?? `title:${title}|${year ?? ''}`,
    };
    if (original && original !== entry.title) entry.originalTitle = original;
    const titleType = normalizeTitleType(row['Title Type']);
    if (titleType) entry.titleType = titleType;
    entries.push(entry);
  }
  return { entries, filesRead: ['imdb'], warnings };
}
