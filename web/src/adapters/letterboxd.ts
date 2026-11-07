/**
 * Letterboxd export adapter (docs/etape-3-letterboxd.md, D4). Runs locally, no network.
 *
 * Reads ratings.csv, watched.csv and diary.csv only (profile.csv is never decompressed nor read).
 * A film is identified by its Letterboxd link in ratings.csv / watched.csv; diary.csv links point
 * to diary entries, so the diary is attached to films by (Name, Year).
 */
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import type { AdapterResult, HistoryEntry } from './types';

export const LETTERBOXD_SCALE_MAX = 5;
const READ_FILES = ['ratings.csv', 'watched.csv', 'diary.csv'] as const;
type ReadFile = (typeof READ_FILES)[number];
const IGNORED_FOLDERS = ['deleted', 'orphaned', 'likes', 'lists'];

type Row = Record<string, string | undefined>;

/** ratings/watched/diary files at the top of an export (one wrapping folder accepted). */
export function exportFileName(path: string): ReadFile | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.at(-1)?.toLowerCase();
  if (!name || !(READ_FILES as readonly string[]).includes(name)) return null;
  if (parts.slice(0, -1).some((p) => IGNORED_FOLDERS.includes(p.toLowerCase()))) return null;
  if (parts.length > 2) return null;
  return name as ReadFile;
}

export function parseCsv(text: string): Row[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return Papa.parse<Row>(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  }).data;
}

function parseYear(value: string | undefined): number | undefined {
  const y = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(y) && y > 1800 && y < 2200 ? y : undefined;
}

function parseRating(value: string | undefined, warnings: string[]): number | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const r = Number(v);
  if (Number.isFinite(r) && r >= 0.5 && r <= LETTERBOXD_SCALE_MAX && Number.isInteger(r * 2)) {
    return r;
  }
  warnings.push(`note ignorée : « ${v} »`);
  return undefined;
}

function parseDate(value: string | undefined): string | undefined {
  const d = (value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

interface Film {
  title: string;
  year?: number;
  key: string;
  watchedDate?: string;
  ratedDate?: string;
  rating?: number;
  diaryDate?: string;
  diaryRating?: number;
}

const nameYear = (name: string, year: number | undefined) => `${name.trim()}|${year ?? ''}`;

/** Merge the three files into one entry per film (D4). */
export function buildEntries(files: Partial<Record<ReadFile, Row[]>>): AdapterResult {
  const warnings: string[] = [];
  const films = new Map<string, Film>();
  const byNameYear = new Map<string, string>();

  const filmFor = (title: string, year: number | undefined, link: string): Film => {
    const key = link || `title:${nameYear(title, year)}`;
    let film = films.get(key);
    if (!film) {
      film = { title, year, key };
      films.set(key, film);
      const ny = nameYear(title, year);
      const other = byNameYear.get(ny);
      if (other === undefined) byNameYear.set(ny, key);
      else if (other !== key) warnings.push('deux films avec le même titre et la même année');
    }
    return film;
  };
  const fromRow = (row: Row): Film | null => {
    const title = (row['Name'] ?? '').trim();
    if (!title) return null;
    return filmFor(title, parseYear(row['Year']), (row['Letterboxd URI'] ?? '').trim());
  };

  for (const row of files['watched.csv'] ?? []) {
    const film = fromRow(row);
    if (film) film.watchedDate = parseDate(row['Date']) ?? film.watchedDate;
  }
  for (const row of files['ratings.csv'] ?? []) {
    const film = fromRow(row);
    if (!film) continue;
    film.rating = parseRating(row['Rating'], warnings);
    film.ratedDate = parseDate(row['Date']);
  }
  for (const row of files['diary.csv'] ?? []) {
    const title = (row['Name'] ?? '').trim();
    if (!title) continue;
    const year = parseYear(row['Year']);
    // diary links point to the diary entry, not to the film: attach by (Name, Year)
    const known = byNameYear.get(nameYear(title, year));
    const film = (known !== undefined && films.get(known)) || filmFor(title, year, '');
    const d = parseDate(row['Watched Date']) ?? parseDate(row['Date']);
    const r = parseRating(row['Rating'], warnings);
    if (film.diaryDate === undefined || (d !== undefined && d >= film.diaryDate)) {
      // latest diary entry wins (ties: the later row)
      film.diaryDate = d ?? film.diaryDate;
      if (r !== undefined) film.diaryRating = r;
    } else if (film.diaryRating === undefined && r !== undefined) {
      film.diaryRating = r;
    }
  }

  const entries: HistoryEntry[] = [...films.values()].map((f) => ({
    title: f.title,
    year: f.year,
    rating: f.rating ?? f.diaryRating,
    scaleMax: LETTERBOXD_SCALE_MAX,
    date: f.diaryDate ?? f.ratedDate ?? f.watchedDate,
    source: 'letterboxd',
    sourceKey: f.key,
  }));
  return { entries, filesRead: [], warnings };
}

/** Export given as {path: text} (unzipped folder, or files picked by the user). */
export function parseLetterboxdFiles(files: Record<string, string>): AdapterResult {
  const rows: Partial<Record<ReadFile, Row[]>> = {};
  const filesRead: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const name = exportFileName(path);
    if (!name || rows[name]) continue;
    rows[name] = parseCsv(text);
    filesRead.push(name);
  }
  if (filesRead.length === 0) {
    return {
      entries: [],
      filesRead,
      warnings: ['aucun fichier ratings.csv, watched.csv ou diary.csv'],
    };
  }
  return { ...buildEntries(rows), filesRead: filesRead.sort() };
}

/** Letterboxd ZIP export. Only the three files are decompressed (never profile.csv). */
export function parseLetterboxdZip(zip: Uint8Array): AdapterResult {
  const unzipped = unzipSync(zip, { filter: (file) => exportFileName(file.name) !== null });
  const decoder = new TextDecoder('utf-8');
  const files: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(unzipped)) files[path] = decoder.decode(bytes);
  return parseLetterboxdFiles(files);
}

/** A single CSV picked by the user: recognised by its name, then by its columns. */
export function parseLetterboxdCsv(fileName: string, text: string): AdapterResult {
  const base = fileName.toLowerCase().split(/[\\/]/).at(-1) ?? '';
  if (base.includes('watchlist')) {
    return { entries: [], filesRead: [], warnings: ['la watchlist ne contient pas de films vus'] };
  }
  const rows = parseCsv(text);
  const headers = new Set(Object.keys(rows[0] ?? {}));
  let kind: ReadFile | null = exportFileName(base);
  if (!kind) {
    if (headers.has('Watched Date')) kind = 'diary.csv';
    else if (headers.has('Rating')) kind = 'ratings.csv';
    else if (headers.has('Letterboxd URI')) kind = 'watched.csv';
  }
  if (!kind || !headers.has('Name')) {
    return {
      entries: [],
      filesRead: [],
      warnings: ['fichier non reconnu comme export Letterboxd'],
    };
  }
  return { ...buildEntries({ [kind]: rows }), filesRead: [kind] };
}
