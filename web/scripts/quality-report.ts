/**
 * Step 6c diagnostics (docs/etape-6c-qualite.md), terminal only, counts and shares only (no title).
 *
 *   npx tsx scripts/quality-report.ts <export.zip | export folder> [--lambdas 0,0.9,0.99]
 *
 * 1. Genres (MovieLens genres of catalog.json): share of each dominant genre of the history among
 *    the first 16 recommendations of each notch, in the history, and in the catalogue under each
 *    cap (recommendable films).
 * 3. With --lambdas: genre calibration (step 6c, D1, `calibrate.ts`) for each λ: share of
 *    animation in the first 16 films of each notch, and miscalibration C_KL of the first 20.
 * 2. Disliked neighbours: among the first 16 recommendations of each notch, how many have, among
 *    their 2 (and 5) closest rated history films (cosine), one with a percentile < 0.2 / < 0.3.
 * 5. With --mus 0,0.25,1 [--all-positions]: proximity penalty to the disliked films (step 6c, D1b)
 *    at the positions where λ = 0.9 (or all): disliked neighbours, animation, mean score of the 16.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bernoulliDivergence,
  calibrate,
  calibrateShare,
  genreProfile,
  genreRows,
  klDivergence,
  lambdaOf,
  POOL,
  proximity,
  shareProfile,
  type CalibrationMode,
} from '../src/reco/calibrate';
import { explain } from '../src/reco/explain';
import { keptForFoldIn, signal } from '../src/reco/foldIn';
import { importExport, loadEngine, recommend } from '../src/reco/engine';
import { exportInput, WEB_ROOT } from './local';

const SHOWN = 16;
const DATA = join(WEB_ROOT, 'public', 'data');

const pct = (x: number) => `${(100 * x).toFixed(0)} %`.padStart(5);

async function main() {
  const path = process.argv[2];
  const lamAt = process.argv.indexOf('--lambdas');
  const lambdas = lamAt > 0 ? process.argv[lamAt + 1]!.split(',').map(Number) : [];
  const poolAt = process.argv.indexOf('--pool');
  const poolSize = poolAt > 0 ? Number(process.argv[poolAt + 1]) : POOL;
  const mode: CalibrationMode = process.argv.includes('--share') ? 'share' : 'mass';
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

  // ---- 3. calibration by genres (step 6c, D1)
  if (lambdas.length) {
    const meta = model.meta;
    const kept = keptForFoldIn(
      history.map((h) => h.percentile),
      history.map((h) => h.rating !== undefined),
      meta.foldin_drop_below,
      meta.foldin_min_kept ?? 0,
    );
    const films = history.filter((_, i) => kept[i]);
    const rows = genreRows(catalog.genres, mode);
    const nG = catalog.genre_names.length;
    const p = genreProfile(
      rows,
      nG,
      films.map((h) => h.item),
      films.map((h) => signal(h.percentile, meta.beta)),
      mode,
    );
    const anim = catalog.genre_names.indexOf('Animation');
    const pools = recommend(engine, matched, { n: poolSize });
    const div = mode === 'mass' ? klDivergence : bernoulliDivergence;
    const qOf = (items: readonly number[]) =>
      genreProfile(
        rows,
        nG,
        items,
        items.map(() => 1),
      );
    console.log(
      `
── calibration ${mode} (vivier ${poolSize}) : part de films d'animation (16 premières) · C_KL@20, par cran ; ` +
        `historique gardé : ${pct(
          share(
            films.map((h) => h.item),
            'Animation',
          ),
        )} des films, ` +
        `profil : ${pct(p[anim]!)} de la masse des genres ──`,
    );
    for (const lam of lambdas) {
      const t0 = performance.now();
      const cells = pools.positions.map((pos) => {
        const list = calibrate(pos.items, pos.scores, p, rows, lam, 48, mode);
        const top = list.slice(0, SHOWN);
        return `${pct(share(top, 'Animation'))} · ${div(p, qOf(list.slice(0, 20))).toFixed(2)}`;
      });
      const ms = performance.now() - t0;
      console.log(
        `λ ${String(lam).padEnd(5)} ${cells.map((c) => c.padStart(13)).join(' ')}  (${ms.toFixed(0)} ms)`,
      );
    }

    // ---- 4. λ per notch (--tables "name:λ∞,λ20000,…,λ200|…"): transitions between notches
    const tablesAt = process.argv.indexOf('--tables');
    if (tablesAt > 0) {
      const tables = process.argv[tablesAt + 1]!.split('|').map((t) => {
        const [name, values] = t.split(':');
        return { name: name!, lams: values!.split(',').map(Number) };
      });
      const genreShares = (items: readonly number[]) =>
        catalog.genre_names.map((g) => share(items, g));
      console.log(
        `\n── λ par cran : animation (16 premières) par cran ; entre crans voisins : films communs dans ` +
          `les 16 premières · écart de genres (somme des |Δ part|) ──`,
      );
      for (const { name, lams } of tables) {
        const lists = pools.positions.map((pos, i) =>
          calibrate(pos.items, pos.scores, p, rows, lams[i]!, 48, mode).slice(0, SHOWN),
        );
        const anim = lists.map((l) => pct(share(l, 'Animation')).trim()).join(' ');
        const steps = lists.slice(1).map((l, i) => {
          const prev = new Set(lists[i]);
          const common = l.filter((x) => prev.has(x)).length;
          const a = genreShares(lists[i]!);
          const b = genreShares(l);
          const dist = a.reduce((t, x, g) => t + Math.abs(x - b[g]!), 0);
          return `${common}/${SHOWN} · ${dist.toFixed(2)}`;
        });
        console.log(`${name.padEnd(8)} animation ${anim}`);
        console.log(`${''.padEnd(8)} transitions ${steps.join(' | ')}`);
      }
    }
  }

  // ---- 5. proximity penalty to the disliked films (step 6c, D1b, Q4b): --mus 0,0.25,1
  const musAt = process.argv.indexOf('--mus');
  const calibration = model.meta.calibration;
  if (musAt > 0 && calibration) {
    const mus = process.argv[musAt + 1]!.split(',').map(Number);
    const everywhere = process.argv.includes('--all-positions');
    const meta = model.meta;
    const kept = keptForFoldIn(
      history.map((h) => h.percentile),
      history.map((h) => h.rating !== undefined),
      meta.foldin_drop_below,
      meta.foldin_min_kept ?? 0,
    );
    const films = history.filter((_, i) => kept[i]);
    const disliked = history
      .filter((h, i) => !kept[i] && h.rating !== undefined)
      .map((h) => h.item);
    const p = shareProfile(
      catalog.genres,
      catalog.genre_names.length,
      films.map((h) => h.item),
      films.map((h) => signal(h.percentile, meta.beta)),
    );
    // pools in model order (recommend returns them calibrated): score desc, then item
    const pools = recommend(engine, matched, { n: calibration.pool }).positions.map((pos) => {
      const order = pos.items.map((item, k) => ({ item, score: pos.scores[k]! }));
      order.sort((a, b) => b.score - a.score || a.item - b.item);
      return { cap: pos.cap, items: order.map((o) => o.item), scores: order.map((o) => o.score) };
    });
    const near = pools.map((pos) => proximity(pos.items, disliked, model.vectors, model.dims));
    const scoreOf = new Map<number, number>();
    for (const pos of pools) pos.items.forEach((i, k) => scoreOf.set(i, pos.scores[k]!));
    const neighbours = (top: readonly number[]) => {
      const nn = explain(model.vectors, model.dims, rated, top, {
        likedPercentile: 0,
        minCosine: -Infinity,
        maxCited: 2,
      });
      return top.filter((i) => (nn.get(i)?.items ?? []).some((h) => (pctOf.get(h) ?? 1) < 0.3))
        .length;
    };
    console.log(
      `\n── pénalité de proximité (D1b, ${everywhere ? 'tous les crans' : 'crans à λ = 0,9'}) : ` +
        `${disliked.length} films hors du fold-in ; par cran : voisins mal notés (2 plus proches) /16 · ` +
        `animation (16 premières) · score moyen des 16 / μ = 0 ──`,
    );
    console.log(
      `${'μ'.padEnd(6)} ${pools.map((p) => String(p.cap ?? '∞').padStart(16)).join(' ')}`,
    );
    const mean16 = (l: readonly number[]) =>
      l.slice(0, SHOWN).reduce((t, i) => t + scoreOf.get(i)!, 0) / Math.min(SHOWN, l.length);
    const base = pools.map((pos) =>
      mean16(
        calibrateShare(
          pos.items,
          pos.scores,
          p,
          catalog.genres,
          lambdaOf(calibration, pos.cap),
          48,
          calibration.alpha,
        ),
      ),
    );
    for (const mu of mus) {
      const t0 = performance.now();
      let total = 0;
      const cells = pools.map((pos, k) => {
        const lam = lambdaOf(calibration, pos.cap);
        const on = mu !== 0 && (everywhere || lam === 0.9);
        const list = calibrateShare(
          pos.items,
          pos.scores,
          p,
          catalog.genres,
          lam,
          48,
          calibration.alpha,
          on ? near[k]!.map((c) => mu * c) : undefined,
        );
        const top = list.slice(0, SHOWN);
        const bad = neighbours(top);
        total += bad;
        return `${String(bad).padStart(2)} · ${pct(share(top, 'Animation'))} · ${(mean16(list) / base[k]!).toFixed(2)}`;
      });
      const ms = performance.now() - t0;
      console.log(
        `${String(mu).padEnd(6)} ${cells.map((c) => c.padStart(16)).join(' ')}  (total ${total} ; ${ms.toFixed(0)} ms)`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
