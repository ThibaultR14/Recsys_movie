/**
 * Match report for a real Letterboxd export (docs/etape-3-letterboxd.md, E6). Local only.
 *
 *   npx tsx scripts/match-report.ts <export.zip | export folder> [--name <label>]
 *
 * Writes test-data/reports/<label>.json (ignored by git): every film with its status and matched
 * catalogue film, for the review and for pipeline/match_diagnostics.py. Prints counts only.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLetterboxdFiles, parseLetterboxdZip } from '../src/adapters/letterboxd';
import { matchHistory, toUserHistory } from '../src/matching/history';
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
  return parseLetterboxdZip(new Uint8Array(readFileSync(path)));
}

async function main() {
  const args = process.argv.slice(2);
  const path = args[0];
  if (!path || !existsSync(path)) throw new Error('usage: match-report.ts <export.zip|folder>');
  const nameAt = args.indexOf('--name');
  const label = nameAt >= 0 && args[nameAt + 1] ? args[nameAt + 1]! : basename(path, '.zip');

  const index = await loadTitleIndex(
    async (url) => new Response(readFileSync(join(DATA, url.replace('/data/', '')))),
  );
  const catalog = JSON.parse(readFileSync(join(DATA, 'catalog.json'), 'utf-8')) as {
    title: string[];
    year: (number | null)[];
    tmdb_id: (number | null)[];
    directors: string[][];
  };
  const parsed = readExport(path);
  const t0 = performance.now();
  const matcher = new Matcher(index);
  const t1 = performance.now();
  const matched = matchHistory(matcher, parsed.entries);
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

  const report = {
    label,
    created_at: new Date().toISOString(),
    files_read: parsed.filesRead,
    warnings: parsed.warnings,
    n_entries: parsed.entries.length,
    n_rated: parsed.entries.filter((e) => e.rating !== undefined).length,
    counts,
    n_history_films: history.length,
    timing_ms: { matcher_build: t1 - t0, matching: t2 - t1 },
    entries: matched.map((m) => ({
      title: m.entry.title,
      year: m.entry.year ?? null,
      source_key: m.entry.sourceKey,
      rating: m.entry.rating ?? null,
      status: m.result.status,
      via: m.result.via ?? null,
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
