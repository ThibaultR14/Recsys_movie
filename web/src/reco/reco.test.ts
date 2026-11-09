import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { percentiles } from '../adapters/normalizeRatings';
import type { MatchedEntry } from '../matching/history';
import {
  exclusions,
  loadEngine,
  calibratePositions,
  recommend,
  versionExclusions,
  versionPartners,
  type Engine,
} from './engine';
import { shareProfile } from './calibrate';
import { choleskySolve, foldIn, FoldInError, keptForFoldIn, signal } from './foldIn';
import {
  buildModelFiles,
  dequantize,
  ModelFilesError,
  parseEmbeddings,
  type ModelMeta,
} from './modelFiles';
import { rankCandidates, scoreAll, topByPosition } from './recommend';

// --- synthetic files ---------------------------------------------------------------------------

function embeddingsBuffer(q: number[][], scales: number[], magic = 'PEPE'): ArrayBuffer {
  const n = q.length;
  const d = q[0]!.length;
  const buf = new ArrayBuffer(16 + n * d + 4 * n);
  const view = new DataView(buf);
  [...magic].forEach((ch, i) => view.setUint8(i, ch.charCodeAt(0)));
  view.setUint32(4, 1, true);
  view.setUint32(8, n, true);
  view.setUint32(12, d, true);
  q.flat().forEach((v, i) => view.setInt8(16 + i, v));
  scales.forEach((s, i) => view.setFloat32(16 + n * d + 4 * i, s, true));
  return buf;
}

const f32 = (values: number[]) => new Float32Array(values).buffer;
const u32 = (values: number[]) => new Uint32Array(values).buffer;

function meta(n: number, d: number, extra: Partial<ModelMeta> = {}): ModelMeta {
  return {
    format_version: 1,
    n_items: n,
    dims: d,
    regularization: 0.05,
    alpha: 1,
    beta: 1,
    slider: { variant: 'popularity cap', positions: [null, 100, 10] },
    movie_ids: Array.from({ length: n }, (_, i) => i + 1),
    non_recommendable_item_idx: [],
    embeddings_sha256: 'x',
    ...extra,
  };
}

describe('model files (synthetic)', () => {
  const q = [
    [127, -64],
    [0, 0],
    [-127, 32],
  ];
  const scales = [0.01, 0, 2 / 127];

  it('parses the header and dequantises like numpy float32', () => {
    const emb = parseEmbeddings(embeddingsBuffer(q, scales));
    expect([emb.nItems, emb.dims]).toEqual([3, 2]);
    const y = dequantize(emb);
    expect(y[0]).toBe(Math.fround(127 * Math.fround(0.01)));
    expect(y[1]).toBe(Math.fround(-64 * Math.fround(0.01)));
    expect([y[2], y[3]]).toEqual([0, 0]);
    expect(y[5]).toBe(Math.fround(32 * Math.fround(2 / 127)));
  });
  it('rejects a bad header, a wrong size and inconsistent files', () => {
    expect(() => parseEmbeddings(embeddingsBuffer(q, scales, 'NOPE'))).toThrow(ModelFilesError);
    expect(() => parseEmbeddings(embeddingsBuffer(q, scales).slice(0, 20))).toThrow(
      ModelFilesError,
    );
    const ok = () => [embeddingsBuffer(q, scales), f32([1, 0, 0, 1]), u32([5, 6, 7])] as const;
    expect(() => buildModelFiles(meta(3, 2), ...ok())).not.toThrow();
    expect(() => buildModelFiles(meta(4, 2), ...ok())).toThrow('incohérents');
    expect(() => buildModelFiles(meta(3, 2), ...ok(), 5)).toThrow('catalog.json');
    const [e, y] = ok();
    expect(() => buildModelFiles(meta(3, 2), e, y, u32([1, 2]))).toThrow('popularity.bin');
  });
  it('marks non-recommendable films', () => {
    const m = buildModelFiles(
      meta(3, 2, { non_recommendable_item_idx: [1] }),
      embeddingsBuffer(q, scales),
      f32([1, 0, 0, 1]),
      u32([5, 6, 7]),
    );
    expect([...m.recommendable]).toEqual([1, 0, 1]);
  });
});

describe('fold-in maths', () => {
  it('choleskySolve by hand', () => {
    // [[4, 2], [2, 3]] x = [2, 1] -> x = [0.5, 0]
    expect([
      ...choleskySolve(Float64Array.from([4, 2, 2, 3]), Float64Array.from([2, 1]), 2),
    ]).toEqual([0.5, 0]);
    expect(() =>
      choleskySolve(Float64Array.from([0, 0, 0, 0]), Float64Array.from([1, 1]), 2),
    ).toThrow(FoldInError);
  });
  it('signal = fround(1 + β·p)', () => {
    expect(signal(Math.fround(1 / 3), 1)).toBe(Math.fround(1 + Math.fround(1 / 3)));
    expect(signal(0.5, 1)).toBe(1.5);
  });
  it('refuses an empty history', () => {
    const m = buildModelFiles(meta(1, 1), embeddingsBuffer([[1]], [1]), f32([1]), u32([1]));
    expect(() => foldIn(m, [], [])).toThrow('aucun film reconnu');
  });
});

describe('ranking and slider (synthetic)', () => {
  const scores = Float64Array.from([0.5, 0.9, 0.9, 0.1, 0.7]);
  const recommendable = Uint8Array.from([1, 1, 1, 1, 0]);
  const popularity = Uint32Array.from([10, 500, 50, 5, 1]);

  it('sorts by score then item, without excluded or non-recommendable films', () => {
    expect([...rankCandidates(scores, recommendable, new Set())]).toEqual([1, 2, 0, 3]);
    expect([...rankCandidates(scores, recommendable, new Set([2]))]).toEqual([1, 0, 3]);
  });
  it('caps by popularity and computes the relative score', () => {
    const ranked = rankCandidates(scores, recommendable, new Set());
    const [inf, cap50] = topByPosition(ranked, scores, popularity, [null, 50], 2);
    expect(inf).toMatchObject({ cap: null, items: [1, 2], relativeScore: 1 });
    expect(cap50!.items).toEqual([2, 0]);
    // means over the first 20 of each position: ∞ = (0.9 + 0.9 + 0.5 + 0.1) / 4, cap 50 = (0.9 + 0.5 + 0.1) / 3
    expect(cap50!.relativeScore).toBeCloseTo(1.5 / 3 / (2.4 / 4));
  });
});

describe('exclusions (D4)', () => {
  const entry = { title: 't', scaleMax: 5, source: 'letterboxd' as const, sourceKey: 'k' };
  const m = (result: MatchedEntry['result']): MatchedEntry => ({ entry, result });
  it('history + tied ambiguous candidates + main fuzzy candidate', () => {
    const matched = [
      m({ status: 'exact', item: 1, candidates: [{ item: 1, source: 0, yearGap: 0 }] }),
      m({
        status: 'ambiguous',
        candidates: [
          { item: 7, source: 0, yearGap: 0 },
          { item: 8, source: 0, yearGap: 0 },
          { item: 9, source: 2, yearGap: 0 },
        ],
      }),
      m({
        status: 'probable_fuzzy',
        item: 4,
        candidates: [
          { item: 4, source: -1, yearGap: 0 },
          { item: 5, source: -1, yearGap: 1 },
        ],
      }),
      m({ status: 'not_found', candidates: [] }),
    ];
    const history = [{ item: 1, percentile: 0.5, status: 'exact' as const }];
    expect([...exclusions(matched, history)].sort()).toEqual([1, 4, 7, 8]);
  });
});

// --- the main criterion: replay the Python fold-in cases from the real files -------------------

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../../test-data/foldin_cases.json', import.meta.url));
const ready =
  existsSync(FIXTURE) &&
  [
    'embeddings.bin',
    'yty.bin',
    'popularity.bin',
    'model-meta.json',
    'catalog.json',
    'title-index.json',
  ].every((f) => existsSync(DATA + f));

interface FixtureCase {
  name: string;
  item_idx: number[];
  rating: number[];
  percentile: number[];
  signal: number[];
  /** Films kept in the fold-in (step 6c, D2). */
  kept: boolean[];
  user_vector: number[];
  /** Other cuts of the seen films (step 6c, D3). */
  excluded_versions: number[];
  /** Calibrated lists of 48 at the 8 slider positions (step 6c, D1). */
  calibrated: Record<string, number[]>;
  top10: Record<string, { item_idx: number[]; score: number[] }>;
}

export const fileFetch = async (url: string) =>
  new Response(readFileSync(DATA + url.replace('/data/', '')));

const pick = <T>(xs: readonly T[], keep: readonly boolean[]) => xs.filter((_, i) => keep[i]);

describe.skipIf(!ready)('Python fold-in cases (foldin_cases.json)', async () => {
  const engine: Engine | null = ready ? await loadEngine(fileFetch) : null;
  const fixture = ready
    ? (JSON.parse(readFileSync(FIXTURE, 'utf-8')) as {
        embeddings_sha256: string;
        cases: FixtureCase[];
      })
    : null;

  const keptFor = (_c: FixtureCase, p: number[]) =>
    keptForFoldIn(
      p,
      p.map(() => true),
      engine!.model.meta.foldin_drop_below,
      engine!.model.meta.foldin_min_kept ?? 0,
    );

  it('uses the same model files as the fixture', () => {
    expect(fixture!.cases).toHaveLength(25); // 22 + version_seen, ties_at_threshold, guard_small (6c)
    expect(fixture!.embeddings_sha256).toBe(engine!.model.meta.embeddings_sha256);
  });

  it('25 user vectors within 1e-14, signal and kept films identical', () => {
    let worst = 0;
    for (const c of fixture!.cases) {
      const p = percentiles(c.rating);
      expect(p, c.name).toEqual(c.percentile);
      expect(
        p.map((v) => signal(v, engine!.model.meta.beta)),
        c.name,
      ).toEqual(c.signal);
      const kept = keptFor(c, p);
      expect(kept, c.name).toEqual(c.kept);
      const x = foldIn(engine!.model, pick(c.item_idx, kept), pick(p, kept));
      for (let d = 0; d < x.length; d++)
        worst = Math.max(worst, Math.abs(x[d]! - c.user_vector[d]!));
    }
    console.info(`fold-in: max |Δx| = ${worst.toExponential(2)}`);
    expect(worst).toBeLessThanOrEqual(1e-14);
  });

  it('75 top-10 lists identical (item_idx and order), scores within 1e-14', () => {
    const model = engine!.model;
    let lists = 0;
    let worst = 0;
    for (const c of fixture!.cases) {
      const p = percentiles(c.rating);
      const kept = keptFor(c, p);
      const x = foldIn(model, pick(c.item_idx, kept), pick(p, kept));
      const scores = scoreAll(model, x);
      const ranked = rankCandidates(
        scores,
        model.recommendable,
        new Set([...c.item_idx, ...c.excluded_versions]),
      );
      for (const [key, expected] of Object.entries(c.top10)) {
        const cap = key === 'inf' ? null : Number(key);
        const [got] = topByPosition(ranked, scores, model.popularity, [cap], 10);
        expect(got!.items, `${c.name} @ ${key}`).toEqual(expected.item_idx);
        got!.scores.forEach((s, k) => (worst = Math.max(worst, Math.abs(s - expected.score[k]!))));
        lists++;
      }
    }
    console.info(`top-10 lists: ${lists} identical, max |Δscore| = ${worst.toExponential(2)}`);
    expect(lists).toBe(75);
    expect(worst).toBeLessThanOrEqual(1e-14);
  });

  it('200 calibrated lists identical to Python (step 6c, D1: share mode, λ per position)', () => {
    const model = engine!.model;
    const cal = model.meta.calibration!;
    expect(cal.lambda_by_position).toEqual([0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9]);
    let lists = 0;
    for (const c of fixture!.cases) {
      const p = percentiles(c.rating);
      const kept = keptFor(c, p);
      const items = pick(c.item_idx, kept);
      const x = foldIn(model, items, pick(p, kept));
      const scores = scoreAll(model, x);
      const ranked = rankCandidates(
        scores,
        model.recommendable,
        new Set([...c.item_idx, ...c.excluded_versions]),
      );
      const pools = topByPosition(ranked, scores, model.popularity, cal.positions, cal.pool);
      const profile = shareProfile(
        engine!.catalog.genres,
        engine!.catalog.genre_names.length,
        items,
        pick(p, kept).map((v) => signal(v, model.meta.beta)),
      );
      const got = calibratePositions(pools, scores, profile, engine!.catalog.genres, cal, 48);
      for (const pos of got) {
        const key = pos.cap === null ? 'inf' : String(pos.cap);
        expect(pos.items, `${c.name} @ ${key}`).toEqual(c.calibrated[key]);
        lists++;
      }
    }
    expect(lists).toBe(200);
  });

  it('recommend(): never a seen, excluded or non-recommendable film', () => {
    const model = engine!.model;
    const c = fixture!.cases[0]!;
    const entry = { scaleMax: 5, source: 'letterboxd' as const };
    const matched: MatchedEntry[] = c.item_idx.map((item, k) => ({
      entry: { ...entry, title: `f${k}`, sourceKey: `k${k}`, rating: c.rating[k] },
      result: { status: 'exact', item, candidates: [{ item, source: 0, yearGap: 0 }] },
    }));
    const res = recommend(engine!, matched, { n: 50 });
    expect(res.positions).toHaveLength(8);
    const seen = new Set(c.item_idx);
    for (const pos of res.positions) {
      expect(pos.items).toHaveLength(50);
      for (const i of pos.items) {
        expect(seen.has(i)).toBe(false);
        expect(model.recommendable[i]).toBe(1);
        if (pos.cap !== null) expect(model.popularity[i]).toBeLessThanOrEqual(pos.cap);
      }
    }
    // the ∞ list is the fixture's calibrated list (the greedy's first picks do not depend on n)
    expect(res.positions[0]!.items.slice(0, 10)).toEqual(c.calibrated['inf']!.slice(0, 10));
  });

  it('recommend(): the other cut of a seen film is never recommended (step 6c, D3)', () => {
    const c = fixture!.cases.find((k) => k.name === 'version_seen')!;
    expect(c.excluded_versions.length).toBeGreaterThan(0);
    const entry = { scaleMax: 5, source: 'letterboxd' as const };
    const matched: MatchedEntry[] = c.item_idx.map((item, k) => ({
      entry: { ...entry, title: `f${k}`, sourceKey: `k${k}`, rating: c.rating[k] },
      result: { status: 'exact', item, candidates: [{ item, source: 0, yearGap: 0 }] },
    }));
    const res = recommend(engine!, matched, { n: 200 });
    for (const pos of res.positions)
      for (const v of c.excluded_versions) expect(pos.items).not.toContain(v);
  });
});

describe('versions (step 6c, D3)', () => {
  it('pairs both ways; only the seen films exclude their other cuts', () => {
    const v = versionPartners([
      [10, 1],
      [10, 2],
      [20, 3],
    ]);
    expect(v.get(10)).toEqual([1, 2]);
    expect(v.get(1)).toEqual([10]);
    expect(v.get(3)).toEqual([20]);
    expect([...versionExclusions(v, [1])]).toEqual([10]); // saw Vol. 1 -> no long cut
    expect([...versionExclusions(v, [10]).values()].sort()).toEqual([1, 2]); // saw the long cut
    expect(versionExclusions(v, [5]).size).toBe(0);
  });
});

describe('fold-in without the disliked films (step 6c, D2)', () => {
  it('strict threshold, ties as a whole, unrated never dropped, guard under 5 films', () => {
    const f = Math.fround;
    // 0.3 exactly (float32) is kept; below is dropped
    expect(
      keptForFoldIn([f(0.05), f(0.05), f(0.2), f(0.3), 0.4, 0.5], Array(6).fill(true), 0.3, 1),
    ).toEqual([false, false, false, true, true, true]);
    // unrated (0.5 anyway, and never dropped even under a higher threshold)
    expect(
      keptForFoldIn([0, 0.5, 0.5, 0.8, 0.9, 1], [true, false, false, true, true, true], 0.6, 5),
    ).toEqual([false, true, true, true, true, true]);
    // dropping 2 of 6 would leave 4 < 5: everything kept
    expect(keptForFoldIn([0, 0.2, 0.4, 0.6, 0.8, 1], Array(6).fill(true), 0.3, 5)).toEqual(
      Array(6).fill(true),
    );
    // no rule in an older model-meta.json
    expect(keptForFoldIn([0, 1], [true, true], undefined, 5)).toEqual([true, true]);
  });
});
