// Step 6 (G2-G3): the IMDb example export on the real files. Films found by id enter the fold-in;
// the title fallback goes to « à vérifier », unticked, and only a user's choice uses it (D3).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseImdbCsv } from '../adapters/imdb';
import { matchHistory } from '../matching/history';
import { groupUnrecognized } from '../pages/analysis';
import { loadEngine, type Engine } from './engine';
import { createHandler, type ImportResult, type RecommendResult } from './workerCore';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../../public/exemple/imdb-exemple.csv', import.meta.url));
const ready =
  existsSync(EXAMPLE) &&
  [
    'embeddings.bin',
    'yty.bin',
    'popularity.bin',
    'model-meta.json',
    'catalog.json',
    'title-index.json',
  ].every((f) => existsSync(DATA + f));
const fileFetch = async (url: string) =>
  new Response(readFileSync(DATA + url.replace('/data/', '')));
const CHERBOURG = 'Die Regenschirme von Cherbourg';

describe.skipIf(!ready)('IMDb example export (real files)', () => {
  it('ids -> fold-in; title fallback -> to verify, excluded, then confirmed', async () => {
    const urls: string[] = [];
    const handle = createHandler(async (url) => {
      urls.push(url);
      return fileFetch(url);
    });
    expect((await handle({ id: 1, type: 'init' })).ok).toBe(true);
    const text = readFileSync(EXAMPLE, 'utf-8');
    const imp = await handle({
      id: 2,
      type: 'import',
      input: { kind: 'imdb', name: 'imdb-exemple.csv', text },
    });
    if (!imp.ok) throw new Error(imp.error);
    const { summary, unrecognized } = imp.result as ImportResult;
    expect(summary.nEntries).toBe(68);
    expect(summary.counts).toMatchObject({
      exact: 63,
      ambiguous: 1,
      not_found: 4,
      probable_fuzzy: 0,
      probable_variant: 0,
    });
    expect(summary.nHistoryFilms).toBe(63);

    const groups = groupUnrecognized(unrecognized);
    expect(groups.toVerify.map((u) => [u.title, u.byTitle])).toEqual([[CHERBOURG, true]]);
    expect(groups.nonFilm.map((u) => u.title)).toEqual(['Chernobyl', 'Twin Peaks', 'Pilot']);
    expect(groups.tooRecent.map((u) => u.title)).toEqual(['Anora']);
    expect(groups.notInCatalog).toEqual([]);

    const cherbourg = groups.toVerify[0]!;
    const candidate = cherbourg.candidates[0]!;
    expect(candidate.year).toBe(1964);

    const recommended = async (id: number) => {
      const r = await handle({ id, type: 'recommend', n: 48 });
      if (!r.ok) throw new Error(r.error);
      const res = r.result as RecommendResult;
      return { res, items: new Set(res.positions.flatMap((p) => p.films.map((f) => f.item))) };
    };
    const before = await recommended(3);
    expect(before.res.nHistory).toBe(63);
    expect(before.items.has(candidate.item)).toBe(false); // excluded, not in the fold-in

    const conf = await handle({
      id: 4,
      type: 'confirm',
      choices: { [cherbourg.index]: candidate.item },
    });
    expect(conf.ok && conf.result).toMatchObject({ nHistoryFilms: 64 });
    const after = await recommended(5);
    expect(after.res.nHistory).toBe(64);
    expect(after.items.has(candidate.item)).toBe(false);
    // no network beyond the site's own /data/ files (D9)
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^\/data\/[\w.-]+$/);
  });

  it('3 000 IMDb rows read and matched in ≤ 300 ms (section 4 criterion)', async () => {
    const engine: Engine = await loadEngine(fileFetch);
    const ids = engine.catalog.imdb_id;
    const lines = ['Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,Year'];
    for (let k = 0; k < 3000; k++) {
      const item = (k * 7) % engine.catalog.n;
      // 1 row in 5: unknown id, title fallback on a catalogue title
      const id = k % 5 === 0 ? `tt9${String(k).padStart(7, '0')}` : ids[item]!;
      const title = `"${engine.catalog.title[item]!.replace(/"/g, '""')}"`;
      const type = k % 50 === 0 ? 'TV Series' : 'Movie';
      lines.push(
        [
          id,
          1 + (k % 10),
          '2025-01-01',
          title,
          title,
          'u',
          type,
          engine.catalog.year[item] ?? '',
        ].join(','),
      );
    }
    const text = lines.join('\n');
    const t0 = performance.now();
    const parsed = parseImdbCsv(text);
    const matched = matchHistory(engine.matcher, parsed.entries, engine.ids);
    const ms = performance.now() - t0;
    expect(matched).toHaveLength(3000);
    expect(matched.filter((m) => m.result.matchedBy === 'imdb_id')).toHaveLength(2400);
    console.log(`IMDb, 3 000 rows: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThanOrEqual(300);
  });
});
