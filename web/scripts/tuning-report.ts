/**
 * Step 8, visual stop (docs/etape-8-analyse-reglages.md): the variants of the settings on a real
 * export and its watchlist. Counts and shares only; the ranks of three reference films of the
 * catalogue (12 Angry Men, The Godfather Part II, Spirited Away); no title of the export. Writes
 * test-data/reports/tuning_<name>.json (ignored).
 *
 *   npx tsx scripts/tuning-report.ts <export.zip | folder> --name A
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { parseLetterboxdCsv } from '../src/adapters/letterboxd';
import { citationPicks, pepiteStamps } from '../src/components/cardRules';
import { parseDevTuning } from '../src/dev/devTuning';
import { matchHistory, RECOMMENDATION_STATUSES } from '../src/matching/history';
import { FAR_FROM_TASTE } from '../src/pages/resultsText';
import { shareProfile } from '../src/reco/calibrate';
import {
  importExport,
  loadEngine,
  qualityPercentile,
  recommend,
  type Engine,
  type Tuning,
} from '../src/reco/engine';
import { CANDIDATES, explain } from '../src/reco/explain';
import { signal } from '../src/reco/foldIn';
import { exportInput, WEB_ROOT } from './local';

const N = 48;
const ROW = 8;
const JUMP = 24; // a film of the first 8 cards coming from below this pool rank = a « jump »

async function localFetch(url: string): Promise<Response> {
  if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
  return new Response(readFileSync(join(WEB_ROOT, 'public', 'data', url.slice('/data/'.length))));
}

function watchlistText(path: string): string | null {
  if (statSync(path).isDirectory()) {
    const f = readdirSync(path).find((x) => x === 'watchlist.csv');
    return f ? readFileSync(join(path, f), 'utf-8') : null;
  }
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const key = Object.keys(files).find(
    (k) => k.endsWith('watchlist.csv') && !k.includes('__MACOSX') && !k.includes('/deleted/'),
  );
  return key ? strFromU8(files[key]!) : null;
}

const SOFT_A = [0.1, 0.1, 0.1, 0.3, 0.5, 0.7, 0.9, 0.9];
const SOFT_B = [0.1, 0.1, 0.1, 0.3, 0.3, 0.5, 0.7, 0.9];
const SOFT_C = [0.1, 0.1, 0.1, 0.3, 0.5, 0.5, 0.7, 0.9];

const VARIANTS: { name: string; tuning: Tuning }[] = [
  { name: 'actuel', tuning: {} },
  { name: 'sans calibration', tuning: { calibration: false } },
  { name: 'λ 0,3 (≤ 5 000)', tuning: { lambda: 0.3 } },
  { name: 'λ 0,5 (≤ 5 000)', tuning: { lambda: 0.5 } },
  { name: 'λ 0,7 (≤ 5 000)', tuning: { lambda: 0.7 } },
  { name: 'table douce A', tuning: { lambda: SOFT_A } },
  { name: 'table douce B', tuning: { lambda: SOFT_B } },
  { name: 'table douce C', tuning: { lambda: SOFT_C } },
  { name: 'vivier 72 (≤ 5 000)', tuning: { pool: 72 } },
  { name: 'vivier 96 (≤ 5 000)', tuning: { pool: 96 } },
  { name: 'λ 0,7 + vivier 96 (≤ 5 000)', tuning: { lambda: 0.7, pool: 96 } },
  { name: 'sans qualité', tuning: { quality: false } },
  { name: 'sans récents (non recommandés)', tuning: { recent: 'not-recommended' } },
  { name: 'sans récents (ni profil)', tuning: { recent: 'off' } },
  { name: 'γ 0,2', tuning: { gamma: 0.2 } },
  { name: 'γ 0,3', tuning: { gamma: 0.3 } },
  ...[95, 98, 99].flatMap((p) =>
    [0.2, 0.5, 1].map((g) => ({
      name: `classiques c${p} γc ${String(g).replace('.', ',')}`,
      tuning: { classics: { gamma: g, percentile: p } } as Tuning,
    })),
  ),
  {
    name: 'classiques c98 γc 0,5, estimés compris',
    tuning: { classics: { gamma: 0.5, percentile: 98, estimated: true } },
  },
  {
    name: 'table douce A + classiques c98 γc 0,5',
    tuning: { lambda: SOFT_A, classics: { gamma: 0.5, percentile: 98 } },
  },
  {
    name: 'table douce A + classiques c99 γc 1',
    tuning: { lambda: SOFT_A, classics: { gamma: 1, percentile: 99 } },
  },
];

/** `--r6e` (step 8, R6e): production against each setting of R6d put back, and all of them. */
const R6E_VARIANTS: { name: string; tuning: Tuning }[] = [
  { name: 'production (R6e)', tuning: {} },
  { name: 'avant (R6d), tout', tuning: parseDevTuning('?avant=1')! },
  { name: 'λ 0,9 à 5 000', tuning: { lambda: 0.9 } },
  { name: 'sans plafond des estimés', tuning: { estimatedPerRow: false } },
  { name: 'q des estimés : droite du catalogue', tuning: { estimatedQuality: 'catalog' } },
  { name: 'sans bonus des classiques', tuning: { classics: { gamma: 0, percentile: 99 } } },
  { name: 'tampon permis sur les estimés', tuning: { estimatedStamp: true } },
];
const R6E = process.argv.includes('--r6e');

const REFERENCES: { title: string; year: number }[] = [
  { title: '12 Angry Men', year: 1957 },
  { title: 'The Godfather Part II', year: 1974 },
  { title: 'Spirited Away', year: 2001 },
];

function findItem(engine: Engine, title: string, year: number): number {
  const c = engine.catalog;
  const i = c.title.findIndex((t, k) => t === title && c.year[k] === year);
  if (i < 0) throw new Error(`film de référence absent : ${title}`);
  return i;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** At most `max` estimated films per row of 8 (the others pushed to the next rows). */
function capEstimated(list: number[], isEst: (i: number) => boolean, max: number, n: number) {
  const out: number[] = [];
  const pending: number[] = [];
  let k = 0;
  while (out.length < n && (k < list.length || pending.length)) {
    const rowStart = out.length - (out.length % ROW);
    const inRow = out.slice(rowStart).filter(isEst).length;
    if (pending.length && inRow < max) {
      out.push(pending.shift()!);
      continue;
    }
    if (k >= list.length) break;
    const i = list[k++]!;
    if (isEst(i) && inRow >= max) pending.push(i);
    else out.push(i);
  }
  return out;
}

async function main() {
  const path = process.argv[2];
  const name = process.argv[process.argv.indexOf('--name') + 1] ?? 'X';
  if (!path || !existsSync(path)) throw new Error('usage: tuning-report.ts <export> --name A');
  const engine = await loadEngine(localFetch);
  const c = engine.catalog;
  const nTrained = c.n_trained ?? c.n;
  const isEst = (i: number) => i >= nTrained;
  const { matched } = importExport(engine, exportInput(path));
  const caps = engine.model.meta.slider.positions;
  const pop = engine.model.popularity;
  const anim = c.genre_names.indexOf('Animation');

  // watchlist: same matching as the history, exact matches only, not seen
  const wl = watchlistText(path);
  const wlMatched = wl
    ? matchHistory(engine.matcher, parseLetterboxdCsv('watched.csv', wl).entries, engine.ids)
    : [];
  const base = recommend(engine, matched, { n: N });
  const seen = new Set(base.history.map((h) => h.item));
  const watch = new Set<number>();
  for (const m of wlMatched) {
    const r = m.result;
    if (RECOMMENDATION_STATUSES.includes(r.status) && r.item !== undefined && !seen.has(r.item))
      watch.add(r.item);
  }
  const watchRec = [...watch].filter((i) => engine.model.recommendable[i] && !base.excluded.has(i));
  const watchInfo = {
    lines: wlMatched.length,
    matched: watch.size,
    recommendable: watchRec.length,
    estimated: watchRec.filter(isEst).length,
    candidatesPerNotch: caps.map(
      (cap) => watchRec.filter((i) => cap === null || pop[i]! <= cap).length,
    ),
  };

  // profile shares (what the calibration targets): animation and the 3 main genres
  const prof = shareProfile(
    c.genres,
    c.genre_names.length,
    base.foldInItems,
    base.foldInItems.map((i) => {
      const h = base.history.find((x) => x.item === i)!;
      return signal(h.percentile, engine.model.meta.beta);
    }),
  );
  const top3 = [...prof.keys()].sort((a, b) => prof[b]! - prof[a]!).slice(0, 3);
  const shareOf = (items: number[], g: number) =>
    items.length ? items.filter((i) => (c.genres[i] ?? []).includes(g)).length / items.length : 0;
  const refs = REFERENCES.map((r) => ({ ...r, item: findItem(engine, r.title, r.year) }));
  const qScale = engine.model.meta.quality?.scale ?? 1000;
  const thresholds = Object.fromEntries(
    [95, 98, 99].map((p) => [p, r3(qualityPercentile(engine, p))]),
  );
  const above = Object.fromEntries(
    [95, 98, 99].map((p) => {
      const t = qualityPercentile(engine, p);
      let trained = 0;
      let est = 0;
      for (let i = 0; i < engine.model.nItems; i++) {
        if (!engine.model.recommendable[i] || (c.quality?.[i] ?? 0) / qScale <= t) continue;
        if (isEst(i)) est++;
        else trained++;
      }
      return [p, { trained, estimated: est }];
    }),
  );

  const current = base.positions.map((p) => new Set(p.items));
  const variants = (R6E ? R6E_VARIANTS : VARIANTS).map(({ name: vname, tuning }) => {
    const r = recommend(engine, matched, { n: N, tuning });
    const notches = r.positions.map((p, k) => {
      const items = p.items;
      const first8 = items.slice(0, ROW);
      const poolRank = new Map(r.pools[k]!.items.map((i, j) => [i, j + 1]));
      const wlRanks = items.flatMap((i, j) => (watch.has(i) ? [j + 1] : []));
      // step 8 (R6e): never on an estimated film, unless the variant allows it again
      const stamps = pepiteStamps(
        items.map((i) => pop[i]!),
        tuning.estimatedStamp ? undefined : items.map((i) => !isEst(i)),
      );
      return {
        cap: p.cap,
        overlap: items.filter((i) => current[k]!.has(i)).length,
        animation: r3(shareOf(items, anim)),
        top3: top3.map((g) => r3(shareOf(items, g))),
        estimated48: items.filter(isEst).length,
        estimated8: first8.filter(isEst).length,
        far48: items.filter((_, j) => p.relativeScores[j]! < FAR_FROM_TASTE).length,
        farPosition: p.relativeScore < FAR_FROM_TASTE,
        medianRelative8: r3(median(p.relativeScores.slice(0, ROW)) ?? 0),
        watch48: wlRanks.length,
        watch8: wlRanks.filter((x) => x <= ROW).length,
        watchMedianRank: median(wlRanks),
        animation8: r3(shareOf(first8, anim)),
        animation16: r3(shareOf(items.slice(0, 2 * ROW), anim)),
        // the same 48 films shown in score' order (calibration = choice of the set only)
        ...(() => {
          const order = [...items.keys()].sort(
            (x, y) => (poolRank.get(items[x]!) ?? 999) - (poolRank.get(items[y]!) ?? 999),
          );
          const top = order.slice(0, ROW);
          return {
            sortedAnimation8: r3(
              shareOf(
                top.map((j) => items[j]!),
                anim,
              ),
            ),
            sortedMedianRelative8: r3(median(top.map((j) => p.relativeScores[j]!)) ?? 0),
            sortedWatch8: top.filter((j) => watch.has(items[j]!)).length,
          };
        })(),
        jumps8: first8.filter((i) => (poolRank.get(i) ?? 999) > JUMP).length,
        maxPoolRank8: Math.max(...first8.map((i) => poolRank.get(i) ?? 999)),
        stampsOnEstimated: [...stamps].filter((j) => isEst(items[j]!)).length,
        stamps: stamps.size,
        refs: refs.map((f) => {
          const shown = items.indexOf(f.item);
          return { shown: shown < 0 ? null : shown + 1, pool: poolRank.get(f.item) ?? null };
        }),
      };
    });
    return { name: vname, notches };
  });

  // explanations: current cosine vs centred cosine (mean trained vector subtracted)
  const { vectors, dims } = engine.model;
  const mean = new Float64Array(dims);
  for (let i = 0; i < nTrained; i++)
    for (let d = 0; d < dims; d++) mean[d]! += vectors[i * dims + d]!;
  for (let d = 0; d < dims; d++) mean[d]! /= nTrained;
  const centred = Float32Array.from(vectors, (v, k) => v - mean[k % dims]!);
  const histTrained = base.history.filter((h) => !isEst(h.item));
  const targets = [...new Set(base.positions.flatMap((p) => p.items))];
  const unit = (vs: Float32Array | Float64Array, i: number) => {
    let n = 0;
    for (let d = 0; d < dims; d++) n += vs[i * dims + d]! ** 2;
    return Math.sqrt(n);
  };
  const meanNorm = Math.sqrt(mean.reduce((a, x) => a + x * x, 0));
  const centrality = (i: number) => {
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += vectors[i * dims + d]! * mean[d]!;
    return dot / (unit(vectors, i) * meanNorm);
  };
  const cosine = (a: number, b: number) => {
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += vectors[a * dims + d]! * vectors[b * dims + d]!;
    return dot / (unit(vectors, a) * unit(vectors, b));
  };
  // cards of the 8 notches (48 each): the cited films, as the grid shows them
  const cards = (vs: Float32Array) => {
    const why = explain(vs, dims, histTrained, targets, { maxCited: CANDIDATES });
    const out: { notch: number; target: number; cited: number[] }[] = [];
    base.positions.forEach((p, n) => {
      const cands = p.items.map((i) => why.get(i)?.items);
      const picks = citationPicks(cands);
      p.items.forEach((i, k) =>
        out.push({ notch: n, target: i, cited: picks[k]!.map((j) => cands[k]![j]!) }),
      );
    });
    return out;
  };
  const cur = cards(vectors);
  const cen = cards(centred);
  const overall = new Map<number, number>();
  for (const c0 of cur) for (const i of c0.cited) overall.set(i, (overall.get(i) ?? 0) + 1);
  const top2 = new Set(
    [...overall.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map((e) => e[0]),
  );
  const stats = (list: typeof cur, est: boolean) => {
    const sel = list.filter((c0) => isEst(c0.target) === est);
    const pairs = sel.flatMap((c0) => c0.cited.map((i) => [c0.target, i] as const));
    const counts = new Map<number, number>();
    for (const [, i] of pairs) counts.set(i, (counts.get(i) ?? 0) + 1);
    return {
      cards: sel.length,
      citations: pairs.length,
      distinct: counts.size,
      shareOfTop2Overall: pairs.length
        ? r3(pairs.filter(([, i]) => top2.has(i)).length / pairs.length)
        : 0,
      meanCosine: pairs.length
        ? r3(pairs.reduce((a, [t, i]) => a + cosine(t, i), 0) / pairs.length)
        : 0,
      meanCentrality: pairs.length
        ? r3(pairs.reduce((a, [, i]) => a + centrality(i), 0) / pairs.length)
        : 0,
    };
  };
  const changed = (est: boolean) => {
    const idx = cur.flatMap((c0, k) => (isEst(c0.target) === est ? [k] : []));
    const diff = idx.filter((k) => cur[k]!.cited.join() !== cen[k]!.cited.join()).length;
    return idx.length ? r3(diff / idx.length) : 0;
  };
  const likedCentrality = histTrained.map((h) => centrality(h.item));
  const explanations = {
    current: { estimatedCards: stats(cur, true), trainedCards: stats(cur, false) },
    centred: { estimatedCards: stats(cen, true), trainedCards: stats(cen, false) },
    cardsChangedByCentring: { estimated: changed(true), trained: changed(false) },
    historyMeanCentrality: r3(likedCentrality.reduce((a, x) => a + x, 0) / likedCentrality.length),
  };

  // at most 1 estimated film per row of 8 (on the current lists, extended to 96 to refill)
  const long = recommend(engine, matched, { n: 2 * N });
  const capped = long.positions.map((p, k) => {
    const items = capEstimated(p.items, isEst, 1, N);
    const wl48 = items.filter((i) => watch.has(i)).length;
    return {
      cap: p.cap,
      estimatedBefore: base.positions[k]!.items.filter(isEst).length,
      estimatedAfter: items.filter(isEst).length,
      rowsWithTwoOrMore: [0, 1, 2, 3, 4, 5].filter(
        (r) => base.positions[k]!.items.slice(r * ROW, r * ROW + ROW).filter(isEst).length > 1,
      ).length,
      overlap: items.filter((i) => current[k]!.has(i)).length,
      watch48: wl48,
    };
  });

  // q of the estimated films under stronger shrinkages (pipeline `tuning_analysis.py tmdb-age`)
  const altPath = join(WEB_ROOT, 'test-data', 'estimated_q_alternatives.json');
  const qAlternatives: Record<string, unknown> = {};
  if (existsSync(altPath)) {
    const alts = JSON.parse(readFileSync(altPath, 'utf-8')) as Record<
      string,
      Record<string, number>
    >;
    for (const [altName, byTmdb] of Object.entries(alts)) {
      const quality = (c.quality ?? []).slice();
      for (let i = nTrained; i < engine.model.nItems; i++) {
        const v = byTmdb[String(c.tmdb_id[i])];
        if (v !== undefined) quality[i] = Math.round(qScale * v);
      }
      const alt: Engine = { ...engine, catalog: { ...c, quality } };
      const t98 = qualityPercentile(alt, 98);
      let est98 = 0;
      for (let i = nTrained; i < engine.model.nItems; i++)
        if (engine.model.recommendable[i] && quality[i]! / qScale > t98) est98++;
      const run = (tuning: Tuning) =>
        recommend(alt, matched, { n: N, tuning }).positions.map((p, k) => ({
          estimated48: p.items.filter(isEst).length,
          estimated8: p.items.slice(0, ROW).filter(isEst).length,
          watch48: p.items.filter((i) => watch.has(i)).length,
          overlap: p.items.filter((i) => current[k]!.has(i)).length,
        }));
      qAlternatives[altName] = {
        estimatedAboveC98: est98,
        current: run({}),
        classicsWithEstimated: run({ classics: { gamma: 0.5, percentile: 98, estimated: true } }),
      };
    }
  }

  const out = {
    name,
    historyFilms: base.history.length,
    estimatedInHistory: base.history.filter((h) => isEst(h.item)).length,
    foldInFilms: base.foldInItems.length,
    profile: {
      animation: r3(prof[anim]!),
      top3: top3.map((g) => [c.genre_names[g], r3(prof[g]!)]),
    },
    watchlist: watchInfo,
    classics: { thresholds, above },
    references: refs.map((f) => ({
      title: f.title,
      popularity: pop[f.item],
      q: (c.quality?.[f.item] ?? 0) / qScale,
      seen: seen.has(f.item),
    })),
    variants,
    explanations,
    capEstimatedPerRow: capped,
    qAlternatives,
  };
  const file = join(
    WEB_ROOT,
    'test-data',
    'reports',
    R6E ? `tuning_${name}_r6e.json` : `tuning_${name}.json`,
  );
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`-> ${file}`);
}

await main();
