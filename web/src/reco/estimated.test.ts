// Step 8 (docs/etape-8-films-recents.md): estimated films (TMDB films missing from MovieLens) on
// the real files: after the trained films, recognised in an export, counted in the fold-in, shown
// with their TMDB rating and « (estimé) ».
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importExport, loadEngine, recommend } from './engine';
import { filmCard, isEstimated } from './workerCore';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../public/exemple/letterboxd-exemple.zip', import.meta.url),
);
const FILES = [
  'embeddings.bin',
  'yty.bin',
  'popularity.bin',
  'model-meta.json',
  'catalog.json',
  'title-index.json',
];
const ready = existsSync(EXAMPLE) && FILES.every((f) => existsSync(DATA + f));

async function fileFetch(url: string): Promise<Response> {
  return new Response(readFileSync(DATA + url.replace('/data/', '')));
}

describe.skipIf(!ready)('estimated films (real files)', () => {
  it('follow the trained films; YᵀY covers the trained films only', async () => {
    const engine = await loadEngine(fileFetch);
    const c = engine.catalog;
    const meta = engine.model.meta as unknown as { n_trained: number };
    expect(c.n_trained).toBe(meta.n_trained);
    expect(c.n).toBeGreaterThan(c.n_trained!);
    expect(c.tmdb_mean).toHaveLength(c.n - c.n_trained!);
    expect(isEstimated(c, c.n_trained! - 1)).toBe(false);
    const card = filmCard(engine, c.n_trained!);
    expect(card.estimated).toBe(true);
    expect(card.publicRating).toBeUndefined();
    expect(card.tmdbRating).toBeDefined();
  });

  it('recognised in the example export (Anora, The Substance) and counted in the fold-in', async () => {
    const engine = await loadEngine(fileFetch);
    const n = engine.catalog.n_trained!;
    const { matched } = importExport(engine, {
      kind: 'zip',
      bytes: new Uint8Array(readFileSync(EXAMPLE)),
    });
    const recent = matched.filter(
      (m) => m.entry.year === 2024 && m.result.status === 'exact' && m.result.item! >= n,
    );
    expect(recent.map((m) => m.entry.title).sort()).toEqual(['Anora', 'The Substance']);
    const res = recommend(engine, matched, { n: 48 });
    const items = res.positions.flatMap((p) => p.items);
    for (const m of recent) expect(items).not.toContain(m.result.item); // seen, never proposed
    // every recommended estimated film is a recommendable one (>= 500 TMDB votes)
    for (const i of items) if (i >= n) expect(engine.model.recommendable[i]).toBe(1);
  });
});
