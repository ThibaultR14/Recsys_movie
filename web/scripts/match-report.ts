/**
 * Match report for a real Letterboxd export (docs/etape-3-letterboxd.md, E6) or IMDb ratings CSV
 * (docs/etape-6-imdb.md, G4). Local only.
 *
 *   npx tsx scripts/match-report.ts <export.zip | export folder | imdb.csv> [--name <label>]
 *
 * Writes test-data/reports/<label>.json (ignored by git): every film with its status and matched
 * catalogue film, for the review and for pipeline/match_diagnostics.py. Prints counts only.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCsv } from '../src/adapters/detect';
import { decodeCsvBytes, parseImdbCsv } from '../src/adapters/imdb';
import {
  parseLetterboxdCsv,
  parseLetterboxdFiles,
  parseLetterboxdZip,
} from '../src/adapters/letterboxd';
import { matchHistory, toUserHistory } from '../src/matching/history';
import { ImdbIdIndex } from '../src/matching/imdbIds';
import { Matcher, type MatchStatus } from '../src/matching/match';
import { loadTitleIndex } from '../src/matching/titleIndex';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'public', 'data');
const REPORTS = join(ROOT, 'test-data', 'reports');
const STATUSES: MatchStatus[] = [
  'exact',
  'probable_variant',
  'probable_fuzzy',
  'ambiguous',
  'not_found',
];

function readExport(path: string) {
  if (statSync(path).isDirectory()) {
    const files: Record<string, string> = {};
    for (const f of readdirSync(path)) {
      if (f.endsWith('.csv')) files[f] = readFileSync(join(path, f), 'utf-8');
    }
    return parseLetterboxdFiles(files);
  }
  if (path.toLowerCase().endsWith('.csv')) {
    const text = decodeCsvBytes(new Uint8Array(readFileSync(path)));
    return detectCsv(text) === 'imdb-ratings'
      ? parseImdbCsv(text)
      : parseLetterboxdCsv(basename(path), text);
  }
  return parseLetterboxdZip(new Uint8Array(readFileSync(path)));
}

async function main() {
  const args = process.argv.slice(2);
  const path = args[0];
  if (!path || !existsSync(path)) throw new Error('usage: match-report.ts <export.zip|folder>');
  const nameAt = args.indexOf('--name');
  const label =
    nameAt >= 0 && args[nameAt + 1]
      ? args[nameAt + 1]!
      : basename(path).replace(/.(zip|csv)$/i, '');

  const index = await loadTitleIndex(
    async (url) => new Response(readFileSync(join(DATA, url.replace('/data/', '')))),
  );
  const catalog = JSON.parse(readFileSync(join(DATA, 'catalog.json'), 'utf-8')) as {
    title: string[];
    year: (number | null)[];
    tmdb_id: (number | null)[];
    directors: string[][];
    imdb_id: (string | null)[];
    imdb_id_aliases?: Record<string, string[]>;
  };
  const ids = new ImdbIdIndex(catalog.imdb_id, catalog.imdb_id_aliases);
  const parsed = readExport(path);
  const t0 = performance.now();
  const matcher = new Matcher(index);
  const t1 = performance.now();
  const matched = matchHistory(matcher, parsed.entries, ids);
  const t2 = performance.now();

  const film = (item: number | undefined) =>
    item === undefined
      ? null
      : {
          item,
          title: catalog.title[item],
          year: catalog.year[item],
          directors: catalog.directors[item],
          tmdb: catalog.tmdb_id[item]
            ? `https://www.themoviedb.org/movie/${catalog.tmdb_id[item]}`
            : null,
        };
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<MatchStatus, number>;
  for (const m of matched) counts[m.result.status]++;
  const history = toUserHistory(matched);
  // IMDb (step 6): how entries were matched, title fallback by the matcher's own status, non-films
  const byMatch: Record<string, number> = {};
  for (const m of matched) {
    const r = m.result;
    const k = r.reason ?? (r.matchedBy ? `${r.matchedBy}:${r.titleStatus ?? r.status}` : null);
    if (k) byMatch[k] = (byMatch[k] ?? 0) + 1;
  }

  const report = {
    label,
    created_at: new Date().toISOString(),
    files_read: parsed.filesRead,
    warnings: parsed.warnings,
    n_entries: parsed.entries.length,
    n_rated: parsed.entries.filter((e) => e.rating !== undefined).length,
    counts,
    by_match: byMatch,
    n_history_films: history.length,
    timing_ms: { matcher_build: t1 - t0, matching: t2 - t1 },
    entries: matched.map((m) => ({
      title: m.entry.title,
      year: m.entry.year ?? null,
      source_key: m.entry.sourceKey,
      rating: m.entry.rating ?? null,
      status: m.result.status,
      via: m.result.via ?? null,
      imdb_id: m.entry.imdbId ?? null,
      original_title: m.entry.originalTitle ?? null,
      title_type: m.entry.titleType ?? null,
      matched_by: m.result.matchedBy ?? null,
      title_status: m.result.titleStatus ?? null,
      reason: m.result.reason ?? null,
      match: film(m.result.item),
      candidates: m.result.candidates.map((c) => ({
        ...film(c.item),
        yearGap: c.yearGap,
        fuzzyScore: c.fuzzyScore ?? null,
      })),
    })),
  };
  mkdirSync(REPORTS, { recursive: true });
  const out = join(REPORTS, `${label}.json`);
  writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(
    JSON.stringify(
      {
        label,
        n_entries: report.n_entries,
        n_rated: report.n_rated,
        counts,
        by_match: byMatch,
        n_history_films: report.n_history_films,
        warnings: parsed.warnings.length,
        timing_ms: report.timing_ms,
        report: out,
      },
      null,
      2,
    ),
  );
}

void main();
