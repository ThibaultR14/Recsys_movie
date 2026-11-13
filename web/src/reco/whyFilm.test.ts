// « pourquoi pas ce film ? » (step 8): diagnosis consistent with the lists of the engine.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importExport, loadEngine, recommend } from './engine';
import { whyFilm } from './whyFilm';

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

describe.skipIf(!ready)('whyFilm (real files, example export)', () => {
  it('a seen film is excluded; a shown film has its place; notches follow the popularity', async () => {
    const engine = await loadEngine(fileFetch);
    const { matched } = importExport(engine, {
      kind: 'zip',
      bytes: new Uint8Array(readFileSync(EXAMPLE)),
    });
    const rec = recommend(engine, matched, { n: 48 });

    const seen = rec.history[0]!.item;
    const w1 = whyFilm(engine, matched, seen, { rec });
    expect(w1.excluded).toBe('vu');
    expect(w1.seen).not.toBeNull();
    expect(w1.rankAll).toBeNull();

    const shown = rec.positions[0]!.items[3]!;
    const w2 = whyFilm(engine, matched, shown, { rec });
    expect(w2.excluded).toBeNull();
    expect(w2.notches[0]!.rankAfter).toBe(4);
    expect(w2.notches[0]!.inPool).toBe(true);
    expect(w2.rankAll).toBe(rec.ranked.indexOf(shown) + 1);
    for (const n of w2.notches) {
      expect(n.visible).toBe(n.cap === null || w2.popularity <= n.cap);
      if (!n.visible) expect(n.rankAfter).toBeNull();
    }
    expect(w2.nearest).toHaveLength(3);
    expect(w2.nearest[0]!.cosine).toBeGreaterThanOrEqual(w2.nearest[1]!.cosine);
  });
});
