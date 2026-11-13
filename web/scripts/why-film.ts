/**
 * « pourquoi pas ce film ? » (step 8): where one film stands in the lists of an export, with the
 * same engine as the site (`whyFilm`). Titles in the terminal only; writes nothing.
 *
 *   npx tsx scripts/why-film.ts <export.zip | folder> --title "12 Angry Men" [--year 1957]
 *   npx tsx scripts/why-film.ts <export> --item 1234
 *   ... --gammas 0,0.05,0.1,0.2,0.3 [--shrink 50]   # + quality term at ∞ (offline measure, step 8)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importExport, loadEngine, recommend, type Engine } from '../src/reco/engine';
import { calibrateShare, lambdaOf, shareProfile } from '../src/reco/calibrate';
import { signal } from '../src/reco/foldIn';
import type { MatchedEntry } from '../src/matching/history';
import { whyFilm } from '../src/reco/whyFilm';
import { WEB_ROOT, exportInput } from './local';

async function localFetch(url: string): Promise<Response> {
  if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
  return new Response(readFileSync(join(WEB_ROOT, 'public', 'data', url.slice('/data/'.length))));
}

function arg(name: string): string | undefined {
  const k = process.argv.indexOf(name);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

const fr = new Intl.NumberFormat('fr-FR');

/**
 * Quality term (offline measure, not on the site): at ∞, score' = score / s_max + γ q with
 * q = (n m + K C) / (n + K) − C (MovieLens mean and count of catalog.json, C = mean of all the
 * ratings; estimated films: q = 0), then the pool and the calibration as on the site.
 */
function qualityRanks(
  engine: Engine,
  matched: readonly MatchedEntry[],
  item: number,
  gammas: number[],
  shrink: number,
) {
  const { catalog, model } = engine;
  const rec = recommend(engine, matched, { n: 48 });
  const nT = catalog.n_trained ?? catalog.n;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < nT; i++) {
    const n = catalog.ml_count?.[i] ?? 0;
    sum += n * ((catalog.ml_mean?.[i] ?? 0) / 10);
    cnt += n;
  }
  const C = sum / cnt;
  const q = (i: number) => {
    const n = catalog.ml_count?.[i];
    const m = catalog.ml_mean?.[i];
    return n == null || m == null ? 0 : (n * (m / 10) + shrink * C) / (n + shrink) - C;
  };
  const ranked = Array.from(rec.ranked);
  const smax = rec.scores[ranked[0]!]! > 0 ? rec.scores[ranked[0]!]! : 1;
  const calib = model.meta.calibration!;
  const history = rec.history.filter((h) => rec.foldInItems.includes(h.item));
  const profile = shareProfile(
    catalog.genres,
    catalog.genre_names.length,
    history.map((h) => h.item),
    history.map((h) => signal(h.percentile, model.meta.beta)),
  );
  console.log(`
terme de qualité à ∞ (K = ${shrink}, C = ${C.toFixed(3)}, q du film = ${q(item).toFixed(3)})`);
  console.log('  γ      rang avant calibration   place affichée (48)');
  for (const g of gammas) {
    const adj = new Map(ranked.map((i) => [i, rec.scores[i]! / smax + g * q(i)]));
    const order = [...ranked].sort((a, b) => adj.get(b)! - adj.get(a)! || a - b);
    const pool = order.slice(0, calib.pool);
    const shown = calibrateShare(
      pool,
      pool.map((i) => adj.get(i)!),
      profile,
      catalog.genres,
      lambdaOf(calib, null),
      48,
      calib.alpha,
    );
    const before = order.indexOf(item);
    const after = shown.indexOf(item);
    console.log(
      `  ${String(g).padEnd(5)}  ${(before < 0 ? '—' : String(before + 1)).padEnd(23)}  ` +
        (after < 0 ? 'absent' : String(after + 1)),
    );
  }
}

async function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path))
    throw new Error('usage: why-film.ts <export> --title T [--year Y]');
  const engine = await loadEngine(localFetch);
  let item = arg('--item') === undefined ? undefined : Number(arg('--item'));
  if (item === undefined) {
    const title = arg('--title');
    if (!title) throw new Error('--title ou --item');
    const year = arg('--year') === undefined ? undefined : Number(arg('--year'));
    const m = engine.matcher.match(title, year);
    item = m.item ?? m.candidates[0]?.item;
    if (item === undefined) throw new Error(`« ${title} » introuvable dans le catalogue`);
    if (m.item === undefined) {
      console.log(
        `correspondance ${m.status} : premier candidat pris ; autres : ` +
          m.candidates
            .slice(1)
            .map(
              (c) => `${engine.catalog.title[c.item]} (${engine.catalog.year[c.item]}) #${c.item}`,
            )
            .join(', '),
      );
    }
  }
  const { matched } = importExport(engine, exportInput(path));
  const w = whyFilm(engine, matched, item);
  console.log(`\n« ${w.title} » (${w.year ?? '?'}), item ${w.item}`);
  console.log(
    `  ${w.estimated ? 'film estimé (TMDB)' : 'film du catalogue (MovieLens)'} · ` +
      `${w.recommendable ? 'recommandable' : 'non recommandable'} · popularité ${fr.format(w.popularity)}`,
  );
  if (w.seen) {
    console.log(
      `  vu dans l'export : note ${w.seen.rating ?? '—'}, percentile ${w.seen.percentile.toFixed(2)}, ` +
        `${w.seen.inFoldIn ? 'compte dans le profil' : 'hors du profil (mal noté)'}`,
    );
  } else console.log("  pas vu dans l'export");
  if (w.excluded) console.log(`  jamais recommandé : ${w.excluded}`);
  console.log(
    `  score ${w.score.toExponential(3)} ; rang parmi tous les candidats : ` +
      `${w.rankAll === null ? '—' : `${fr.format(w.rankAll)} / ${fr.format(w.nCandidates)}`}`,
  );
  console.log('  cran       visible  rang avant calibration  dans le vivier  place affichée');
  for (const n of w.notches) {
    const cap = (n.cap === null ? '∞' : fr.format(n.cap)).padEnd(9);
    const before = n.rankBefore === null ? '—' : fr.format(n.rankBefore);
    const after =
      n.rankAfter === null ? `absent (${n.shown} montrés)` : `${n.rankAfter} / ${n.shown}`;
    console.log(
      `  ${cap}  ${(n.visible ? 'oui' : 'non').padEnd(7)}  ${before.padEnd(22)}  ` +
        `${(n.visible ? (n.inPool ? 'oui' : 'non') : '—').padEnd(14)}  ${n.visible ? after : '—'}`,
    );
  }
  const gammas = arg('--gammas');
  if (gammas) {
    qualityRanks(
      engine,
      matched,
      item,
      gammas.split(',').map(Number),
      Number(arg('--shrink') ?? 50),
    );
  }
  console.log("  films de l'historique les plus proches :");
  for (const f of w.nearest) {
    console.log(
      `    ${f.title} : cosinus ${f.cosine.toFixed(3)}, note ${f.rating ?? '—'}, ` +
        `percentile ${f.percentile.toFixed(2)}`,
    );
  }
}

await main();
