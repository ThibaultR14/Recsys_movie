// Step 8 (R6b): quality term before the pool; estimated films never cited in the explanations.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importExport, loadEngine } from './engine';
import { qualityPool } from './recommend';
import { createHandler, type RecommendResult } from './workerCore';

describe('qualityPool (synthetic)', () => {
  it('same pool as a full sort on score / s_max + gamma q, ties by item', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const n = 400;
    const scores = Float64Array.from({ length: n }, () => rand() * 2 - 0.5);
    const quality = Array.from({ length: n }, () => Math.round(rand() * 1600 - 800));
    quality[5] = quality[6] = 900; // ties of quality
    const popularity = Uint32Array.from({ length: n }, () => Math.floor(rand() * 5000));
    const ranked = Int32Array.from(
      [...Array(n).keys()].sort((a, b) => scores[b]! - scores[a]! || a - b),
    );
    for (const cap of [null, 2000]) {
      const got = qualityPool(ranked, scores, popularity, cap, quality, 0.1, 1000, 40, 0.9);
      const cand = [...ranked].filter((i) => cap === null || popularity[i]! <= cap);
      const d = scores[cand[0]!]! > 0 ? scores[cand[0]!]! : 1;
      const adj = (i: number) => scores[i]! / d + 0.1 * (quality[i]! / 1000);
      const want = [...cand].sort((a, b) => adj(b) - adj(a) || a - b).slice(0, 40);
      expect(got.items).toEqual(want);
      expect(got.scores).toEqual(want.map(adj));
    }
  });
});

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../public/exemple/letterboxd-exemple.zip', import.meta.url),
);
const ready =
  existsSync(EXAMPLE) &&
  ['embeddings.bin', 'yty.bin', 'popularity.bin', 'model-meta.json', 'catalog.json'].every((f) =>
    existsSync(DATA + f),
  );

async function fileFetch(url: string): Promise<Response> {
  return new Response(readFileSync(DATA + url.replace('/data/', '')));
}

describe.skipIf(!ready)('quality term and explanations (real files)', () => {
  it('model-meta and catalog.json carry the quality term', async () => {
    const engine = await loadEngine(fileFetch);
    expect(engine.model.meta.quality).toMatchObject({ gamma: 0.1, scale: 1000 });
    expect(engine.catalog.quality).toHaveLength(engine.model.nItems);
  });

  it('an estimated film of the history is never cited (example: Anora, The Substance)', async () => {
    const engine = await loadEngine(fileFetch);
    const { matched } = importExport(engine, {
      kind: 'zip',
      bytes: new Uint8Array(readFileSync(EXAMPLE)),
    });
    const n = engine.catalog.n_trained!;
    expect(matched.some((m) => m.result.status === 'exact' && m.result.item! >= n)).toBe(true);
    const handle = createHandler(fileFetch);
    await handle({ id: 1, type: 'init' });
    await handle({
      id: 2,
      type: 'import',
      input: { kind: 'zip', bytes: new Uint8Array(readFileSync(EXAMPLE)) },
    });
    const r = await handle({ id: 3, type: 'recommend', n: 48 });
    if (!r.ok) throw new Error(r.error);
    const cited = (r.result as RecommendResult).positions.flatMap((p) =>
      p.films.flatMap((f) => f.because?.items ?? []),
    );
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((i) => i < n)).toBe(true);
  });
});
