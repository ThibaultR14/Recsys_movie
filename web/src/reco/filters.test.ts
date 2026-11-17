// Step 8b (docs/etape-8b-ux-resultats.md, D2-D3): filters of « affiner », the filtered
// recomputation from a kept fold-in, the calibration target of a chosen genre.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  importExport,
  loadEngine,
  MIN_GENRE_FOLDIN,
  recommend,
  recommendFrom,
  userProfile,
  type Engine,
} from './engine';
import { languageName } from '../content/refine';
import {
  activeCount,
  compileFilters,
  NO_FILTERS,
  refineOptions,
  sameFilters,
  type Filters,
} from './filters';

const catalog = {
  genre_names: ['Comedy', 'Documentary', 'Horror'],
  //        0      1    2     3     4     5
  genres: [[0], [1], [2], [0, 2], [], [2]],
  year: [1959, 1960, 1979, 2020, null, 2031],
  runtime: [99, 100, 135, 136, null, 90],
  languages: ['en', 'fr', 'cn'],
  language: [0, 1, 2, 0, null, 1],
};
const passing = (f: Partial<Filters>) => {
  const c = compileFilters({ ...NO_FILTERS, ...f }, catalog);
  return c ? [0, 1, 2, 3, 4, 5].filter(c.passes) : 'none';
};

describe('refineOptions', () => {
  it('counts recommendable films per language; never « xx »', () => {
    const o = refineOptions(
      {
        genre_names: ['Comedy', 'Documentary', 'IMAX'],
        languages: ['en', 'xx', 'fr'],
        language: [...Array(40).fill(0), ...Array(40).fill(1), ...Array(29).fill(2)],
      },
      new Uint8Array(109).fill(1),
    );
    expect(o).toEqual({ genres: ['Comedy'], languages: [{ code: 'en', films: 40 }] });
  });
});

describe('compileFilters', () => {
  it('no active filter -> undefined (the unfiltered lists)', () => {
    expect(compileFilters(NO_FILTERS, catalog)).toBeUndefined();
    expect(activeCount(NO_FILTERS)).toBe(0);
  });

  it('genres: OR within the section; the documentaries hidden only when unticked', () => {
    expect(passing({ genres: ['Horror'] })).toEqual([2, 3, 5]);
    expect(passing({ genres: ['Comedy', 'Horror'] })).toEqual([0, 2, 3, 5]);
    expect(passing({ docs: false })).toEqual([0, 2, 3, 4, 5]);
    expect(
      compileFilters({ ...NO_FILTERS, genres: ['Horror', 'Comedy'] }, catalog)!.genres,
    ).toEqual([2, 0]);
  });

  it('decades: bounds of « avant 1960 » and « années 2020 »; no year passes none', () => {
    expect(passing({ decades: ['avant-1960'] })).toEqual([0]);
    expect(passing({ decades: ['1960', '1970'] })).toEqual([1, 2]);
    expect(passing({ decades: ['2020'] })).toEqual([3, 5]);
  });

  it('durations: < 100, 100 to 135, > 135 minutes; unknown passes none', () => {
    expect(passing({ durations: ['court'] })).toEqual([0, 5]);
    expect(passing({ durations: ['moyen'] })).toEqual([1, 2]);
    expect(passing({ durations: ['long'] })).toEqual([3]);
  });

  it('languages; AND from one section to the next', () => {
    expect(passing({ languages: ['fr'] })).toEqual([1, 5]);
    expect(passing({ languages: ['fr', 'cn'] })).toEqual([1, 2, 5]);
    expect(passing({ languages: ['fr'], genres: ['Horror'] })).toEqual([5]);
    expect(passing({ languages: ['xx'] })).toEqual([]);
  });

  it('counts and compares', () => {
    const f = { ...NO_FILTERS, genres: ['Horror'], decades: ['1970'], docs: false };
    expect(activeCount(f)).toBe(3);
    expect(sameFilters(f, { ...f, genres: ['Horror'] })).toBe(true);
    expect(sameFilters(f, { ...f, docs: true })).toBe(false);
    expect(
      sameFilters({ ...NO_FILTERS, genres: ['A', 'B'] }, { ...NO_FILTERS, genres: ['B', 'A'] }),
    ).toBe(true);
  });
});

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../public/exemple/letterboxd-exemple.zip', import.meta.url),
);
const FILES = ['embeddings.bin', 'yty.bin', 'popularity.bin', 'model-meta.json', 'catalog.json'];
const ready = existsSync(EXAMPLE) && FILES.every((f) => existsSync(DATA + f));

async function fileFetch(url: string): Promise<Response> {
  return new Response(readFileSync(DATA + url.replace('/data/', '')));
}

describe.skipIf(!ready)('filtered recomputation (real files)', () => {
  let engine: Engine;
  const setup = async () => {
    engine ??= await loadEngine(fileFetch);
    const { matched } = importExport(engine, {
      kind: 'zip',
      bytes: new Uint8Array(readFileSync(EXAMPLE)),
    });
    return { matched, user: userProfile(engine, matched) };
  };

  it('options of « affiner »: no documentary nor IMAX; languages >= 30 films, all named', async () => {
    await setup();
    const o = refineOptions(engine.catalog, engine.model.recommendable);
    expect(o.genres).not.toContain('Documentary');
    expect(o.genres).not.toContain('IMAX');
    expect(o.genres).toHaveLength(engine.catalog.genre_names.length - 2);
    expect(o.languages[0]!.code).toBe('en');
    expect(o.languages.every((l) => l.films >= 30)).toBe(true);
    expect(o.languages.map((l) => l.films)).toEqual(
      [...o.languages.map((l) => l.films)].sort((a, b) => b - a),
    );
    expect(o.languages.map((l) => languageName(l.code)).filter((x) => !x)).toEqual([]);
    expect(languageName('cn')).toBe('cantonais');
  });

  it('without a filter: identical to recommend (same lists, same scores)', async () => {
    const { matched, user } = await setup();
    const a = recommend(engine, matched, { n: 48 });
    const b = recommendFrom(engine, user, { n: 48 });
    expect(b.positions.map((p) => p.items)).toEqual(a.positions.map((p) => p.items));
    expect(b.positions.map((p) => p.relativeScores)).toEqual(
      a.positions.map((p) => p.relativeScores),
    );
  });

  it('a filter: every shown film passes it, 48 per cap, the unfiltered base kept', async () => {
    const { user } = await setup();
    const horror = engine.catalog.genre_names.indexOf('Horror');
    const filters = { ...NO_FILTERS, genres: ['Horror'], decades: ['1970', '1980'] };
    const f = compileFilters(filters, engine.catalog)!;
    const r = recommendFrom(engine, user, { n: 48, filter: f });
    const base = recommendFrom(engine, user, { n: 48 });
    for (const [k, p] of r.positions.entries()) {
      expect(p.base).toBe(base.positions[k]!.base);
      for (const i of p.items) {
        expect(engine.catalog.genres[i]).toContain(horror);
        expect(engine.catalog.year[i]).toBeGreaterThanOrEqual(1970);
        expect(engine.catalog.year[i]).toBeLessThanOrEqual(1989);
        expect(user.excluded.has(i)).toBe(false);
      }
    }
    expect(r.positions[0]!.items).toHaveLength(48);
  });

  it('a chosen genre with fewer than 10 fold-in films: λ = 0 (the pool order)', async () => {
    const { user } = await setup();
    const counts = engine.catalog.genre_names.map(
      (_, g) => user.foldInFilms.filter((h) => engine.catalog.genres[h.item]?.includes(g)).length,
    );
    const rare = engine.catalog.genre_names.find(
      (g, k) => g !== 'Documentary' && g !== 'IMAX' && counts[k]! < MIN_GENRE_FOLDIN,
    );
    expect(rare).toBeDefined();
    const r = recommendFrom(engine, user, {
      n: 48,
      filter: compileFilters({ ...NO_FILTERS, genres: [rare!] }, engine.catalog),
    });
    // λ = 0: the calibrated list is the pool in score' order
    for (const p of r.positions) {
      const pool = r.pools.find((q) => q.cap === p.cap)!;
      const est = engine.model.meta.estimated?.per_row?.first_item_idx ?? Infinity;
      const trained = pool.items.filter((i) => i < est).slice(0, 8);
      expect(p.items.filter((i) => i < est).slice(0, 8)).toEqual(trained);
    }
  });

  it('a chosen genre with enough fold-in films: the target follows it (lists differ from λ = 0)', async () => {
    const { user } = await setup();
    const counts = engine.catalog.genre_names.map(
      (_, g) => user.foldInFilms.filter((h) => engine.catalog.genres[h.item]?.includes(g)).length,
    );
    const common = engine.catalog.genre_names[counts.indexOf(Math.max(...counts))]!;
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(MIN_GENRE_FOLDIN);
    const filter = compileFilters({ ...NO_FILTERS, genres: [common] }, engine.catalog)!;
    const r = recommendFrom(engine, user, { n: 48, filter });
    const noCal = recommendFrom(engine, user, {
      n: 48,
      filter,
      tuning: { calibration: false },
    });
    const low = r.positions.findIndex((p) => p.cap === 500);
    expect(r.positions[low]!.items).not.toEqual(noCal.positions[low]!.items);
  });
});
