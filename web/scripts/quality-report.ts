/**
 * Step 6c diagnostics (docs/etape-6c-qualite.md), terminal only, counts and shares only (no title).
 *
 *   npx tsx scripts/quality-report.ts <export.zip | export folder>
 *
 * 1. Genres (MovieLens genres of catalog.json): share of each dominant genre of the history among
 *    the first 16 recommendations of each notch, in the history, and in the catalogue under each
 *    cap (recommendable films).
 * 2. Disliked neighbours: among the first 16 recommendations of each notch, how many have, among
 *    their 2 (and 5) closest rated history films (cosine), one with a percentile < 0.2 / < 0.3.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { explain } from '../src/reco/explain';
import { importExport, loadEngine, recommend } from '../src/reco/engine';
import { exportInput, WEB_ROOT } from './local';

const SHOWN = 16;
const DATA = join(WEB_ROOT, 'public', 'data');

const pct = (x: number) => `${(100 * x).toFixed(0)} %`.padStart(5);

async function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path)) throw new Error('usage : quality-report <export.zip | dossier>');
  const engine = await loadEngine(async (url) => {
    if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
    return new Response(readFileSync(join(DATA, url.slice('/data/'.length))));
  });
  const { matched } = importExport(engine, exportInput(path));
  const reco = recommend(engine, matched, { n: 48 });
  const { catalog, model } = engine;
  const genresOf = (item: number) =>
    (catalog.genres[item] ?? []).map((g) => catalog.genre_names[g]!);

  // ---- 1. genres
  const history = reco.history;
  const histCount = new Map<string, number>();
  for (const h of history)
    for (const g of genresOf(h.item)) histCount.set(g, (histCount.get(g) ?? 0) + 1);
  const dominant = [...histCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([g]) => g);
  if (!dominant.includes('Animation')) dominant.push('Animation');
  const share = (items: readonly number[], g: string) =>
    items.length ? items.filter((i) => genresOf(i).includes(g)).length / items.length : 0;
  const histItems = history.map((h) => h.item);
  console.log(`\nhistorique : ${history.length} films`);
  console.log(
    `\n── part de chaque genre (MovieLens) : historique | 16 premières recos par cran | catalogue sous le plafond ──`,
  );
  console.log(
    `${'genre'.padEnd(12)} hist. | ${reco.positions.map((p) => String(p.cap ?? '∞').padStart(13)).join(' ')}`,
  );
  for (const g of dominant) {
    const cells = reco.positions.map((p) => {
      const top = p.items.slice(0, SHOWN);
      const cand: number[] = [];
      for (let i = 0; i < model.nItems; i++) {
        if (model.recommendable[i] && (p.cap === null || model.popularity[i]! <= p.cap))
          cand.push(i);
      }
      return `${pct(share(top, g))} /${pct(share(cand, g))}`;
    });
    console.log(`${g.padEnd(12)} ${pct(share(histItems, g))} | ${cells.join(' ')}`);
  }

  // ---- 2. disliked neighbours (every rated film may be a neighbour)
  const rated = history.filter((h) => h.rating !== undefined);
  const pctOf = new Map(rated.map((h) => [h.item, h.percentile]));
  console.log(
    `\n── voisins mal notés : films notés ${rated.length}, dont ${rated.filter((h) => h.percentile < 0.2).length} sous 0,2 et ${rated.filter((h) => h.percentile < 0.3).length} sous 0,3 ──`,
  );
  for (const k of [2, 5]) {
    const lines: string[] = [];
    for (const p of reco.positions) {
      const top = p.items.slice(0, SHOWN);
      const near = explain(model.vectors, model.dims, rated, top, {
        likedPercentile: 0,
        minCosine: -Infinity,
        maxCited: k,
      });
      const count = (th: number) =>
        top.filter((i) => (near.get(i)?.items ?? []).some((h) => (pctOf.get(h) ?? 1) < th)).length;
      lines.push(
        `${String(p.cap ?? '∞').padStart(6)} : ${count(0.2)}/${top.length} (< 0,2) · ${count(0.3)}/${top.length} (< 0,3)`,
      );
    }
    console.log(`${k} voisins les plus proches :\n  ${lines.join('\n  ')}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
