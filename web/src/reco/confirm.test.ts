// Step 5 (G3): choices of the analysis screen. A confirmed candidate enters the fold-in; an entry
// left unconfirmed keeps its exclusions and its candidates are never recommended.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECOMMENDATION_STATUSES, type MatchedEntry } from '../matching/history';
import {
  applyChoices,
  exclusions,
  importExport,
  loadEngine,
  recommend,
  type Engine,
} from './engine';
import { createHandler, type ImportResult, type RecommendResult } from './workerCore';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../public/exemple/letterboxd-exemple.zip', import.meta.url),
);
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

function entry(
  title: string,
  status: MatchedEntry['result']['status'],
  items: number[],
): MatchedEntry {
  return {
    entry: { title, year: 2000, rating: 4, scaleMax: 5, source: 'letterboxd', sourceKey: title },
    result: {
      status,
      item: status === 'ambiguous' ? undefined : items[0],
      candidates: items.map((item) => ({ item, source: 0, yearGap: 0 })),
    },
  };
}

describe('applyChoices (pure)', () => {
  const matched = [
    entry('a', 'exact', [1]),
    entry('b', 'ambiguous', [2, 3]),
    entry('c', 'probable_fuzzy', [4]),
    entry('d', 'not_found', []),
  ];

  it('confirms a chosen candidate, leaves null and missing choices as they are', () => {
    const out = applyChoices(matched, { 1: 3, 2: null });
    expect(out[1]!.result).toMatchObject({ status: 'confirmed', item: 3 });
    expect(out[2]).toBe(matched[2]);
    expect(out[0]).toBe(matched[0]);
    expect(matched[1]!.result.status).toBe('ambiguous'); // input untouched
    expect(RECOMMENDATION_STATUSES).toContain('confirmed');
  });

  it('refuses a film that is not a candidate, or an entry that is not to verify', () => {
    expect(() => applyChoices(matched, { 1: 9 })).toThrow();
    expect(() => applyChoices(matched, { 0: 1 })).toThrow();
    expect(() => applyChoices(matched, { 3: null })).toThrow();
    expect(() => applyChoices(matched, { 7: 1 })).toThrow();
  });

  it('a confirmed ambiguous entry only excludes the chosen film', () => {
    const out = applyChoices(matched, { 1: 3 });
    const ex = exclusions(out, [
      { item: 1, percentile: 0.5, status: 'exact' },
      { item: 3, percentile: 0.5, status: 'confirmed' },
    ]);
    expect([...ex].sort()).toEqual([1, 3, 4]); // 2 freed, fuzzy 4 still excluded
  });
});

describe.skipIf(!ready)('choices on the example export (real files)', () => {
  it('confirmed enters the fold-in; unconfirmed candidates are never recommended', async () => {
    const handle = createHandler(fileFetch);
    expect((await handle({ id: 1, type: 'init' })).ok).toBe(true);
    const bytes = new Uint8Array(readFileSync(EXAMPLE));
    const imp = await handle({ id: 2, type: 'import', input: { kind: 'zip', bytes } });
    if (!imp.ok) throw new Error(imp.error);
    const { summary, unrecognized } = imp.result as ImportResult;
    expect(summary.counts).toMatchObject({
      ambiguous: 1,
      probable_fuzzy: 1,
      not_found: 1, // Chernobyl; Anora and The Substance are estimated films (step 8)
      confirmed: 0,
    });

    const milk = unrecognized.find((u) => u.status === 'ambiguous')!;
    const strangelove = unrecognized.find((u) => u.status === 'probable_fuzzy')!;
    expect(milk.title).toBe('Milk');
    expect(milk.candidates.length).toBeGreaterThanOrEqual(2);
    expect(strangelove.title).toBe('Dr. Strangelove');
    const pending = [
      ...milk.candidates.map((c) => c.item),
      ...strangelove.candidates.map((c) => c.item),
    ];

    const recommended = async (id: number) => {
      const r = await handle({ id, type: 'recommend', n: 48 });
      if (!r.ok) throw new Error(r.error);
      const res = r.result as RecommendResult;
      return { res, items: new Set(res.positions.flatMap((p) => p.films.map((f) => f.item))) };
    };

    // 1. nothing confirmed: no candidate of a pending entry is ever recommended
    const before = await recommended(3);
    expect(before.res.nHistory).toBe(summary.nHistoryFilms);
    for (const item of pending) expect(before.items.has(item)).toBe(false);

    // 2. Milk confirmed (first candidate), Dr. Strangelove answered « aucun de ceux-là »
    const chosen = milk.candidates[0]!.item;
    const conf = await handle({
      id: 4,
      type: 'confirm',
      choices: { [milk.index]: chosen, [strangelove.index]: null },
    });
    if (!conf.ok) throw new Error(conf.error);
    expect(conf.result).toMatchObject({ nHistoryFilms: summary.nHistoryFilms + 1 });
    const after = await recommended(5);
    expect(after.res.nHistory).toBe(summary.nHistoryFilms + 1);
    expect(after.items.has(chosen)).toBe(false); // seen now
    for (const c of strangelove.candidates) expect(after.items.has(c.item)).toBe(false);
    // the fold-in moved: scores at ∞ differ
    expect(after.res.positions[0]!.films.map((f) => f.score)).not.toEqual(
      before.res.positions[0]!.films.map((f) => f.score),
    );

    // 3. choices replace earlier ones (applied to the import, not on top of the last confirm)
    const reset = await handle({ id: 6, type: 'confirm', choices: {} });
    expect(reset.ok && reset.result).toMatchObject({ nHistoryFilms: summary.nHistoryFilms });
  });

  it('the confirmed film is in the engine history with its rating', async () => {
    const engine: Engine = await loadEngine(fileFetch);
    const { matched } = importExport(engine, {
      kind: 'zip',
      bytes: new Uint8Array(readFileSync(EXAMPLE)),
    });
    const i = matched.findIndex((m) => m.result.status === 'ambiguous');
    const item = matched[i]!.result.candidates[0]!.item;
    const res = recommend(engine, applyChoices(matched, { [i]: item }), { n: 10 });
    expect(res.history.find((h) => h.item === item)).toMatchObject({
      status: 'confirmed',
      rating: 4,
    });
  });
});
