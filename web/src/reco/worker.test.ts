import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RecoClient, type WorkerLike } from './client';
import {
  createHandler,
  type ImportResult,
  type RecoRequest,
  type RecoResponse,
  type RecommendResult,
} from './workerCore';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const ready = [
  'embeddings.bin',
  'yty.bin',
  'popularity.bin',
  'model-meta.json',
  'catalog.json',
  'title-index.json',
].every((f) => existsSync(DATA + f));

/** Fake Worker: same messages as the real one, handled in-process; records every fetched URL. */
function fakeWorker(urls: string[]): WorkerLike {
  const handle = createHandler(async (url) => {
    urls.push(url);
    if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
    return new Response(readFileSync(DATA + url.slice('/data/'.length)));
  });
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message: RecoRequest) {
      // structured clone, like a real worker boundary
      void handle(structuredClone(message)).then((r: RecoResponse) =>
        worker.onmessage?.({ data: structuredClone(r) }),
      );
    },
  };
  return worker;
}

// Synthetic Letterboxd export (real titles, invented ratings).
const WATCHED = [
  'Date,Name,Year,Letterboxd URI',
  '2024-01-01,Amélie,2001,https://boxd.it/a1',
  '2024-01-02,The Usual Suspects,1995,https://boxd.it/a2',
  '2024-01-03,Seven Samurai,1954,https://boxd.it/a3',
  '2024-01-04,Spirited Away,2001,https://boxd.it/a4',
  '2024-01-05,Hamlet,1964,https://boxd.it/a5',
  '2024-01-06,A Film Nobody Made,2001,https://boxd.it/a6',
].join('\n');
const RATINGS = [
  'Date,Name,Year,Letterboxd URI,Rating',
  '2024-02-01,Amélie,2001,https://boxd.it/a1,5',
  '2024-02-02,The Usual Suspects,1995,https://boxd.it/a2,4',
  '2024-02-03,Seven Samurai,1954,https://boxd.it/a3,4.5',
  '2024-02-04,Spirited Away,2001,https://boxd.it/a4,3',
].join('\n');

describe('handler without data', () => {
  it('answers errors in French before init', async () => {
    const handle = createHandler(async () => {
      throw new Error('pas de réseau');
    });
    expect(await handle({ id: 1, type: 'recommend' })).toEqual({
      id: 1,
      ok: false,
      error: 'modèle pas encore chargé',
    });
    expect((await handle({ id: 2, type: 'init' })).ok).toBe(false);
  });
});

describe.skipIf(!ready)('worker protocol on the real files', () => {
  it('init -> import -> recommend, only /data/ fetched, seen films excluded', async () => {
    const urls: string[] = [];
    const client = new RecoClient(fakeWorker(urls));
    await expect(client.recommend()).rejects.toThrow('modèle pas encore chargé');

    const init = await client.init();
    expect(init.nItems).toBe(23019);
    expect(init.positions).toEqual([null, 20000, 10000, 5000, 2000, 1000, 500, 200]);
    await expect(client.recommend()).rejects.toThrow('aucun historique importé');

    const imported: ImportResult = await client.importExport({
      kind: 'files',
      files: { 'watched.csv': WATCHED, 'ratings.csv': RATINGS },
    });
    expect(imported.summary.nEntries).toBe(6);
    expect(imported.summary.counts.exact).toBe(4);
    expect(imported.summary.nHistoryFilms).toBe(4);
    expect(imported.unrecognized.map((u) => u.status).sort()).toEqual(['ambiguous', 'not_found']);

    const reco: RecommendResult = await client.recommend({ n: 20 });
    expect(reco.nHistory).toBe(4);
    expect(reco.positions).toHaveLength(8);
    const seenTitles = new Set(['Amélie', 'The Usual Suspects', 'Seven Samurai', 'Spirited Away']);
    for (const p of reco.positions) {
      expect(p.films).toHaveLength(20);
      for (const f of p.films) {
        expect(seenTitles.has(f.title)).toBe(false);
        if (p.cap !== null) expect(f.popularity).toBeLessThanOrEqual(p.cap);
        expect(f.relativeScore).toBeCloseTo(
          f.score / (reco.positions[0]!.films.slice(0, 20).reduce((a, g) => a + g.score, 0) / 20),
          9,
        );
        // public rating (step 6b, D5): present, and never above the notch ceiling
        expect(f.publicRating).toBeDefined();
        expect(f.publicRating!.count).toBeLessThanOrEqual(f.popularity);
        expect(f.publicRating!.mean10).toBeGreaterThanOrEqual(5);
        expect(f.publicRating!.mean10).toBeLessThanOrEqual(50);
      }
    }
    expect(reco.positions[0]!.relativeScore).toBe(1);
    // explanations (step 6b, D6): cited films come from the history, never with a series note
    const all = reco.positions.flatMap((p) => p.films);
    expect(all.some((f) => f.because)).toBe(true);
    for (const f of all) {
      if (f.seriesOf) expect(f.because).toBeUndefined();
      for (const t of f.because?.titles ?? []) expect(seenTitles.has(t)).toBe(true);
      expect(f.because?.titles.length ?? 1).toBeLessThanOrEqual(5); // candidates, grid keeps 2
      expect(f.because?.titles.length).toBe(f.because?.items.length);
    }
    expect(reco.explainMs).toBeGreaterThanOrEqual(0);
    // the ambiguous Hamlets of 1964 are excluded (D4)
    const hamlets = imported.unrecognized.find((u) => u.status === 'ambiguous')!.candidates;
    const recommended = new Set(reco.positions.flatMap((p) => p.films.map((f) => f.item)));
    expect(hamlets.some((h) => recommended.has(h.item))).toBe(false);

    expect(new Set(urls)).toEqual(
      new Set([
        '/data/model-meta.json',
        '/data/embeddings.bin',
        '/data/yty.bin',
        '/data/popularity.bin',
        '/data/catalog.json',
        '/data/title-index.json',
      ]),
    );
  });
});
