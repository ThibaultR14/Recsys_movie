import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLetterboxdFiles } from '../adapters/letterboxd';
import type { HistoryEntry } from '../adapters/types';
import { matchEntry, matchHistory, toUserHistory } from './history';
import { ImdbIdIndex, imdbKey } from './imdbIds';
import { Matcher, stripArticle, variantTitles } from './match';
import { normalizeTitle } from './normalize';
import { loadTitleIndex, TitleIndex, type TitleIndexFile } from './titleIndex';

// Small synthetic catalogue: item -> (titles by source, year, MovieLens year, popularity).
const FILMS: { titles: [string, number][]; year: number | null; mlYear?: number; pop: number }[] = [
  {
    titles: [
      ['The Usual Suspects', 0],
      ['Usual Suspects, The', 1],
    ],
    year: 1995,
    pop: 900,
  },
  {
    titles: [
      ['Amélie', 0],
      ["Le Fabuleux Destin d'Amélie Poulain", 2],
    ],
    year: 2001,
    pop: 800,
  },
  { titles: [['Hamlet', 0]], year: 1964, pop: 100 }, // two Hamlets of the same year
  { titles: [['Hamlet', 0]], year: 1964, pop: 50 },
  { titles: [['Hamlet', 0]], year: 1996, pop: 300 },
  { titles: [['Mr. and Mrs. Smith', 0]], year: 2005, pop: 700 },
  { titles: [['Crash', 0]], year: 2004, mlYear: 2005, pop: 500 },
  { titles: [['Crash', 0]], year: 1996, pop: 400 },
  { titles: [['Godzilla', 0]], year: 1954, pop: 200 },
  { titles: [['Les Misérables', 0]], year: 2012, pop: 600 },
  { titles: [['Interstellar', 0]], year: 2014, pop: 1000 },
  { titles: [['Avengers: Endgame', 0]], year: 2019, pop: 950 },
  { titles: [['No Year Film', 0]], year: null, pop: 1 },
];

function syntheticIndex(): TitleIndex {
  const post = new Map<string, number[]>();
  FILMS.forEach((f, item) => {
    for (const [title, source] of f.titles) {
      const key = normalizeTitle(title);
      post.set(key, [...(post.get(key) ?? []), 4 * item + source]);
    }
  });
  const keys = [...post.keys()].sort();
  const file: TitleIndexFile = {
    v: 1,
    norm: 'titles-v2',
    keys,
    post: keys.map((k) => post.get(k)!),
    ml_year: Object.fromEntries(FILMS.flatMap((f, i) => (f.mlYear ? [[String(i), f.mlYear]] : []))),
  };
  return new TitleIndex(
    file,
    FILMS.map((f) => f.year),
    FILMS.map((f) => f.pop),
  );
}

describe('Matcher (synthetic catalogue)', () => {
  const m = new Matcher(syntheticIndex());

  it('exact: normalised title and year within ±1, either year', () => {
    expect(m.match('The Usual Suspects', 1995)).toMatchObject({ status: 'exact', item: 0 });
    expect(m.match('AMELIE', 2002)).toMatchObject({ status: 'exact', item: 1 });
    expect(m.match('Le fabuleux destin d’Amélie Poulain', 2001)).toMatchObject({
      status: 'exact',
      item: 1,
    });
    expect(m.match('Crash', 2006)).toMatchObject({ status: 'exact', item: 6 }); // via ml_year 2005
    expect(m.match('Crash', 1996)).toMatchObject({ status: 'exact', item: 7 });
    expect(m.match('Hamlet', 1996)).toMatchObject({ status: 'exact', item: 4 });
  });
  it('rejects a year gap above 1', () => {
    expect(m.match('Interstellar', 2017).status).toBe('not_found');
  });
  it('ambiguous: two films tied on year gap and source', () => {
    const r = m.match('Hamlet', 1964);
    expect(r).toMatchObject({ status: 'ambiguous', item: undefined });
    expect(r.candidates.map((c) => c.item)).toEqual([2, 3]); // more popular first
  });
  it('no year: unique key -> exact, shared key -> ambiguous', () => {
    expect(m.match('Interstellar')).toMatchObject({ status: 'exact', item: 10 });
    expect(m.match('Crash').status).toBe('ambiguous');
    expect(m.match('No Year Film', 2010)).toMatchObject({ status: 'exact', item: 12 });
  });
  it('probable_variant: &, article, (year), main title', () => {
    expect(m.match('Mr. & Mrs. Smith', 2005)).toMatchObject({
      status: 'probable_variant',
      item: 5,
    });
    expect(m.match('Misérables', 2012)).toMatchObject({ status: 'probable_variant', item: 9 });
    expect(m.match('Interstellar (2014)', 2014)).toMatchObject({
      status: 'probable_variant',
      item: 10,
    });
    expect(m.match('Godzilla: King of the Monsters', 1954)).toMatchObject({
      status: 'probable_variant',
      item: 8,
    });
  });
  it('probable_fuzzy: small typo, same year window only', () => {
    expect(m.match('Interstelar', 2014)).toMatchObject({ status: 'probable_fuzzy', item: 10 });
    expect(m.match('Avengers Endgaem', 2019).status).toBe('probable_fuzzy');
    expect(m.match('Interstelar', 1990).status).toBe('not_found');
    expect(m.match('Interstelar').status).toBe('not_found'); // no fuzzy without a year
  });
  it('not_found: unknown or empty title', () => {
    expect(m.match('A Film Nobody Made', 2001).status).toBe('not_found');
    expect(m.match('???', 2001).status).toBe('not_found');
  });
  it('variantTitles and stripArticle', () => {
    expect(stripArticle('the matrix')).toBe('matrix');
    expect(stripArticle('les miserables')).toBe('miserables');
    expect(stripArticle('them')).toBe('them');
    expect(variantTitles('Kill Bill: Vol. 1')).toContainEqual({ title: 'Kill Bill', unique: true });
    expect(variantTitles('Mr. & Mrs. Smith')[0]?.title).toBe('Mr.  and  Mrs. Smith');
  });
  it('article ignored on both sides', () => {
    const m2 = new Matcher(syntheticIndex());
    expect(m2.match('The Interstellar', 2014)).toMatchObject({
      status: 'probable_variant',
      item: 10,
    });
  });
});

describe('toUserHistory', () => {
  it('keeps usable statuses, one film per item (latest), percentiles', () => {
    const m = new Matcher(syntheticIndex());
    const matched = matchHistory(m, [
      {
        title: 'Amélie',
        year: 2001,
        rating: 2,
        date: '2020-01-01',
        scaleMax: 5,
        source: 'letterboxd',
        sourceKey: 'a',
      },
      {
        title: 'Amelie',
        year: 2001,
        rating: 5,
        date: '2023-01-01',
        scaleMax: 5,
        source: 'letterboxd',
        sourceKey: 'b',
      },
      {
        title: 'Interstellar',
        year: 2014,
        rating: 3,
        scaleMax: 5,
        source: 'letterboxd',
        sourceKey: 'c',
      },
      { title: 'Hamlet', year: 1964, rating: 4, scaleMax: 5, source: 'letterboxd', sourceKey: 'd' },
      {
        title: 'Interstelar',
        year: 2014,
        rating: 1,
        scaleMax: 5,
        source: 'letterboxd',
        sourceKey: 'e',
      },
      { title: 'Godzilla', year: 1954, scaleMax: 5, source: 'letterboxd', sourceKey: 'f' },
    ]);
    const history = toUserHistory(matched);
    expect(history.map((h) => [h.item, h.rating, h.percentile])).toEqual([
      [1, 5, 1],
      [10, 3, 0],
      [8, undefined, 0.5],
    ]);
  });
});

describe('privacy (D6)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads only /data/ files and matching makes no network call', async () => {
    const urls: string[] = [];
    const fakeFetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (!url.startsWith('/data/')) throw new Error(`forbidden URL ${url}`);
      if (url.endsWith('.bin')) return new Response(new Uint32Array([5, 6]).buffer);
      const body = url.endsWith('catalog.json')
        ? { year: [2001, 2002] }
        : { v: 1, norm: 'titles-v2', keys: ['amelie'], post: [[0]], ml_year: {} };
      return new Response(JSON.stringify(body));
    });
    const index = await loadTitleIndex(fakeFetch);
    expect(urls.sort()).toEqual([
      '/data/catalog.json',
      '/data/popularity.bin',
      '/data/title-index.json',
    ]);
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    const m = new Matcher(index);
    m.match('Amélie', 2001);
    m.match('Amelei', 2001);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

// Real site data (web/public/data, not versioned): a few known films and the speed criterion.
const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const hasData = ['title-index.json', 'catalog.json', 'popularity.bin'].every((f) =>
  existsSync(DATA + f),
);

describe.skipIf(!hasData)('real catalogue', async () => {
  const fileFetch = async (url: string) =>
    new Response(readFileSync(DATA + url.replace('/data/', '')));
  const index = hasData ? await loadTitleIndex(fileFetch) : null;

  it('finds well-known films', () => {
    const m = new Matcher(index!);
    for (const [title, year] of [
      ['Amélie', 2001],
      ['The Usual Suspects', 1995],
      ['Spirited Away', 2001],
      ['Seven Samurai', 1954],
      ['Parasite', 2019],
    ] as const) {
      expect(m.match(title, year).status, title).toBe('exact');
    }
  });

  it('matches 3 000 entries in <= 300 ms', () => {
    const m = new Matcher(index!);
    const catalog = JSON.parse(readFileSync(DATA + 'catalog.json', 'utf-8')) as {
      title: string[];
      year: (number | null)[];
    };
    const entries = Array.from({ length: 3000 }, (_, k) => {
      const i = (k * 7919) % catalog.title.length;
      const title = k % 10 === 0 ? catalog.title[i]! + 'x' : catalog.title[i]!; // 10 % misses
      return { title, year: catalog.year[i] ?? undefined };
    });
    const t0 = performance.now();
    for (const e of entries) m.match(e.title, e.year);
    const elapsed = performance.now() - t0;
    console.info(`3000 entries matched in ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThanOrEqual(300);
  });
});

// keep the adapter import used (real-export end-to-end check lives in scripts/match-report.ts)
void parseLetterboxdFiles;

// --- step 6: IMDb ids and the title fallback (docs/etape-6-imdb.md, D2-D4) ----------------------

describe('ImdbIdIndex', () => {
  const ids = new ImdbIdIndex(['tt0114814', 'tt0211915', null, 'tt1234567'], {
    '1': ['tt9999999', 'tt0114814'], // an alias equal to a main id is ignored
  });
  it('numeric part of the id, case-insensitive; main ids before aliases', () => {
    expect(imdbKey('tt0114814')).toBe(114814);
    expect(imdbKey('TT114814')).toBe(114814);
    expect(imdbKey('nm0000001')).toBeNull();
    expect(ids.lookup('tt114814')).toEqual({ item: 0, by: 'imdb_id' });
    expect(ids.lookup('tt9999999')).toEqual({ item: 1, by: 'imdb_alias' });
    expect(ids.lookup('tt0000002')).toBeNull();
    expect(ids.lookup(undefined)).toBeNull();
  });
});

describe('matchEntry (synthetic catalogue)', () => {
  const m = new Matcher(syntheticIndex());
  const ids = new ImdbIdIndex(FILMS.map((_, i) => `tt${1000000 + i}`));
  const imdb = (over: Partial<HistoryEntry>): HistoryEntry => ({
    title: 'X',
    scaleMax: 10,
    rating: 8,
    source: 'imdb',
    sourceKey: 'k',
    titleType: 'movie',
    ...over,
  });

  it('found by id: exact, whatever the title or the type', () => {
    const r = matchEntry(
      m,
      imdb({ imdbId: 'tt1000004', title: 'Rien à voir', titleType: 'tvseries' }),
      ids,
    );
    expect(r).toEqual({ status: 'exact', item: 4, candidates: [], matchedBy: 'imdb_id' });
  });

  it('id unknown, film type: title fallback always sent to review (ambiguous, by title)', () => {
    const r = matchEntry(m, imdb({ imdbId: 'tt9', title: 'The Usual Suspects', year: 1995 }), ids);
    expect(r).toMatchObject({ status: 'ambiguous', titleStatus: 'exact', matchedBy: 'title' });
    expect(r.item).toBeUndefined();
    expect(r.candidates.map((c) => c.item)).toEqual([0]);
  });

  it('localized Title, then Original Title', () => {
    const r = matchEntry(
      m,
      imdb({
        title: 'Die fabelhafte Welt der Amélie',
        originalTitle: "Le Fabuleux Destin d'Amélie Poulain",
        year: 2001,
      }),
      ids,
    );
    expect(r).toMatchObject({ status: 'ambiguous', titleStatus: 'exact', matchedBy: 'title' });
    expect(r.candidates[0]!.item).toBe(1);
  });

  it('id unknown, not a film: no title fallback (non_film)', () => {
    for (const titleType of ['tvseries', 'tvepisode', 'videogame', 'somethingnew']) {
      expect(matchEntry(m, imdb({ title: 'Interstellar', year: 2014, titleType }), ids)).toEqual({
        status: 'not_found',
        candidates: [],
        reason: 'non_film',
      });
    }
  });

  it('nothing found by title stays not_found; Letterboxd unchanged', () => {
    expect(matchEntry(m, imdb({ title: 'Inconnu au bataillon', year: 2001 }), ids).status).toBe(
      'not_found',
    );
    const lb: HistoryEntry = {
      title: 'The Usual Suspects',
      year: 1995,
      scaleMax: 5,
      source: 'letterboxd',
      sourceKey: 'u',
    };
    expect(matchEntry(m, lb, ids)).toEqual(m.match('The Usual Suspects', 1995));
  });

  it('title matches never enter the fold-in; ids do', () => {
    const entries = [
      imdb({ imdbId: 'tt1000010', sourceKey: 'a' }),
      imdb({ imdbId: 'tt9', title: 'Godzilla', year: 1954, sourceKey: 'b' }),
    ];
    const history = toUserHistory(matchHistory(m, entries, ids));
    expect(history.map((h) => h.item)).toEqual([10]);
  });
});
