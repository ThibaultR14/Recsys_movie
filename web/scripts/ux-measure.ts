/**
 * Step 8b, U0 (docs/etape-8b-ux-resultats.md): measures before the results-page work. Counts,
 * scores and timings only; no title, no name.
 *
 *   npx tsx scripts/ux-measure.ts classics <export A> <export B> <example>   # D7
 *   npx tsx scripts/ux-measure.ts filters [--export <export>]               # coverage + prototype
 *
 * `filters` reads test-data/ux_extra.json (language and runtime per item), written by
 * `pipeline/ux_diagnostics.py measure`. The filtered recomputation is a PROTOTYPE built from the
 * engine's own steps (fold-in kept, then exclusions + filter, pools, quality, calibration with the
 * filtered target, cap of the estimated films, explanations); the engine itself is not changed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAR_FROM_TASTE } from '../src/pages/resultsText';
import { seriesOf } from '../src/reco/annotations';
import { shareProfile } from '../src/reco/calibrate';
import {
  calibratePositions,
  capEstimated,
  classicsBonus,
  importExport,
  itemQuality,
  loadEngine,
  qualityPools,
  recommend,
  tunedLambda,
  type Engine,
  type ExportInput,
} from '../src/reco/engine';
import { CANDIDATES, explain } from '../src/reco/explain';
import { signal } from '../src/reco/foldIn';
import { rankCandidates, topByPosition } from '../src/reco/recommend';
import { parseDevTuning } from '../src/dev/devTuning';
import { exportInput, WEB_ROOT } from './local';

const N = 48;
const RUNS = 21;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function localFetch(url: string): Promise<Response> {
  if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
  return new Response(readFileSync(join(WEB_ROOT, 'public', 'data', url.slice('/data/'.length))));
}

function syntheticExport(engine: Engine, size: number): ExportInput {
  const c = engine.catalog;
  const rows = ['Date,Name,Year,Letterboxd URI,Rating'];
  for (let k = 0; k < size; k++) {
    const i = (k * 7919 + 13) % c.n;
    const title = c.title[i]!.replace(/"/g, '""');
    const rating = 0.5 * (1 + ((k * 37) % 10));
    rows.push(`2024-01-01,"${title}",${c.year[i] ?? ''},https://boxd.it/s${k},${rating}`);
  }
  return { kind: 'files', files: { 'ratings.csv': rows.join('\n') } };
}

// ---------------------------------------------------------------- D7: classics bonus

async function classics(paths: string[]) {
  const engine = await loadEngine(localFetch);
  const noBonus = parseDevTuning('?classiques=0')!;
  const caps = [null, 2000, 500];
  const top10: Record<string, Record<string, number[]>> = {};
  const out: Record<string, unknown> = {};
  const names = ['A', 'B', 'exemple'];
  paths.forEach((p, k) => {
    if (!existsSync(p)) throw new Error(`export absent : ${p}`);
    const { matched } = importExport(engine, exportInput(p));
    const rows: Record<string, unknown> = {};
    for (const [label, tuning] of [
      ['avec', undefined],
      ['sans', noBonus],
    ] as const) {
      const r = recommend(engine, matched, { n: N, tuning });
      for (const cap of caps) {
        const pos = r.positions.find((x) => x.cap === cap)!;
        const first = pos.relativeScores.slice(0, 8);
        rows[`${cap ?? '∞'} ${label}`] = {
          median8: r3(median(first)),
          under004: first.filter((x) => x < FAR_FROM_TASTE).length,
          commonWithOther48: 0,
        };
      }
      (top10[label] ??= {})[names[k]!] = r.positions
        .find((x) => x.cap === null)!
        .items.slice(0, 10);
      // films in common between with / without, per cap (out of 48)
      if (label === 'sans') {
        const withR = recommend(engine, matched, { n: N });
        for (const cap of caps) {
          const a = new Set(withR.positions.find((x) => x.cap === cap)!.items);
          const b = r.positions.find((x) => x.cap === cap)!.items;
          (rows[`${cap ?? '∞'} sans`] as { commonWithOther48: number }).commonWithOther48 =
            b.filter((i) => a.has(i)).length;
        }
      }
    }
    out[names[k]!] = rows;
  });
  const overlap = (label: string) => {
    const t = top10[label]!;
    const pair = (x: string, y: string) => {
      const s = new Set(t[x]);
      return t[y]!.filter((i) => s.has(i)).length;
    };
    return {
      'A-B': pair('A', 'B'),
      'A-exemple': pair('A', 'exemple'),
      'B-exemple': pair('B', 'exemple'),
    };
  };
  out.overlapTop10AtInfinity = { avec: overlap('avec'), sans: overlap('sans') };
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------- filters

type Filter = {
  name: string;
  genres?: string[];
  decade?: [number, number];
  lang?: string;
  noDocs?: boolean;
};

async function filters(exportPath: string | undefined) {
  const engine = await loadEngine(localFetch);
  const { catalog: c, model } = engine;
  const extraPath = join(WEB_ROOT, 'test-data', 'ux_extra.json');
  if (!existsSync(extraPath)) throw new Error('lancer d’abord pipeline/ux_diagnostics.py measure');
  const extra = JSON.parse(readFileSync(extraPath, 'utf-8')) as {
    language: (string | null)[];
    runtime: (number | null)[];
  };
  const nTrained = c.n_trained ?? c.n;
  const rec = (i: number) => model.recommendable[i] === 1;

  // coverage among recommendable films
  const recItems = [...Array(c.n).keys()].filter(rec);
  const known = (arr: (unknown | null)[], items: number[]) =>
    items.filter((i) => arr[i] != null).length;
  const recTrained = recItems.filter((i) => i < nTrained);
  const recEst = recItems.filter((i) => i >= nTrained);
  const durations = { '<100': 0, '100-135': 0, '>135': 0, inconnue: 0 };
  for (const i of recItems) {
    const r = extra.runtime[i];
    if (r == null) durations.inconnue++;
    else if (r < 100) durations['<100']++;
    else if (r <= 135) durations['100-135']++;
    else durations['>135']++;
  }
  const decades: Record<string, number> = {};
  for (const i of recItems) {
    const y = c.year[i];
    const k =
      y == null
        ? 'sans année'
        : y < 1960
          ? 'avant 1960'
          : `${Math.min(2020, Math.floor(y / 10) * 10)}`;
    decades[k] = (decades[k] ?? 0) + 1;
  }
  const langCount = new Map<string, number>();
  for (const i of recItems) {
    const l = extra.language[i];
    if (l) langCount.set(l, (langCount.get(l) ?? 0) + 1);
  }
  const dn = new Intl.DisplayNames('fr', { type: 'language', fallback: 'none' });
  const langs30 = [...langCount].filter(([, k]) => k >= 30).sort((a, b) => b[1] - a[1]);
  const genreCount = c.genre_names.map((g, gi) => [
    g,
    recItems.filter((i) => (c.genres[i] ?? []).includes(gi)).length,
  ]);
  console.log(
    JSON.stringify(
      {
        recommendable: { trained: recTrained.length, estimated: recEst.length },
        runtimeKnown: {
          trained: known(extra.runtime, recTrained),
          estimated: known(extra.runtime, recEst),
        },
        languageKnown: {
          trained: known(extra.language, recTrained),
          estimated: known(extra.language, recEst),
        },
        durations,
        decades,
        genres: Object.fromEntries(genreCount),
        languagesAtLeast30: langs30.length,
        languages: langs30.map(([l, k]) => ({
          code: l,
          films: k,
          fr: dn.of(l)?.toLocaleLowerCase('fr') ?? null,
        })),
      },
      null,
      1,
    ),
  );

  // prototype of the filtered recomputation
  const histories: [string, ExportInput][] = [];
  if (exportPath && existsSync(exportPath)) histories.push(['export', exportInput(exportPath)]);
  histories.push(['synthétique 3 000', syntheticExport(engine, 3000)]);
  const FILTERS: Filter[] = [
    { name: 'sans filtre (prototype)' },
    { name: 'horreur', genres: ['Horror'] },
    { name: 'années 70', decade: [1970, 1979] },
    { name: 'drame + français', genres: ['Drama'], lang: 'fr' },
    { name: 'sans documentaires', noDocs: true },
  ];
  for (const [label, input] of histories) {
    const { matched } = importExport(engine, input);
    const full: number[] = [];
    let base = recommend(engine, matched, { n: N });
    EXPLAINED.clear();
    for (const p of base.positions)
      if (p.cap === null || p.cap === 2000 || p.cap === 500)
        for (const i of p.items) EXPLAINED.add(i);
    for (let k = 0; k < RUNS; k++) {
      const t0 = performance.now();
      base = recommend(engine, matched, { n: N });
      explainFor(
        engine,
        base.positions.flatMap((p) => p.items),
        base,
      );
      full.push(performance.now() - t0);
    }
    console.log(
      `${label} : recommend + explications aujourd'hui (fold-in compris) ${median(full).toFixed(1)} ms`,
    );
    for (const f of FILTERS) {
      const times: number[] = [];
      const ex: number[] = [];
      let res: ReturnType<typeof refine> | undefined;
      for (let k = 0; k < RUNS; k++) {
        const t0 = performance.now();
        res = refine(engine, base, f, extra);
        times.push(performance.now() - t0);
        ex.push(res.explainMs);
      }
      const r = res!;
      console.log(
        `  ${f.name.padEnd(24)} médiane ${median(times).toFixed(1)} ms (max ${Math.max(...times).toFixed(1)}), dont explications ${median(ex).toFixed(1)} ms · ` +
          `films par cran ${r.counts.join('/')} · λ0 ${r.lambdaZero} · fold-in du genre ${r.genreFoldIn ?? '-'}` +
          (f.name.startsWith('sans filtre') ? ` · identique à recommend : ${r.same}` : ''),
      );
    }
  }
}

/** Items already explained by the first (unfiltered) recommend: a worker-side cache (variant). */
const EXPLAINED = new Set<number>();

function explainFor(engine: Engine, items: number[], r: ReturnType<typeof recommend>) {
  const distinct = [...new Set(items)];
  const nT = engine.catalog.n_trained ?? engine.catalog.n;
  const series = seriesOf(distinct, r.history, engine.catalog);
  return explain(
    engine.model.vectors,
    engine.model.dims,
    r.history.filter((h) => h.item < nT),
    distinct.filter((i) => !series.has(i) && i < nT),
    { maxCited: CANDIDATES },
  );
}

function refine(
  engine: Engine,
  base: ReturnType<typeof recommend>,
  f: Filter,
  extra: { language: (string | null)[]; runtime: (number | null)[] },
) {
  const { model, catalog: c } = engine;
  const gIdx = (f.genres ?? []).map((g) => c.genre_names.indexOf(g));
  const doc = c.genre_names.indexOf('Documentary');
  const passes = (i: number) => {
    const gs = c.genres[i] ?? [];
    if (gIdx.length && !gIdx.some((g) => gs.includes(g))) return false;
    if (f.noDocs && gs.includes(doc)) return false;
    if (f.decade) {
      const y = c.year[i];
      if (y == null || y < f.decade[0] || y > f.decade[1]) return false;
    }
    if (f.lang && extra.language[i] !== f.lang) return false;
    return true;
  };
  const excluded = new Set(base.excluded);
  for (let i = 0; i < model.nItems; i++) if (!passes(i)) excluded.add(i);
  const ranked = rankCandidates(base.scores, model.recommendable, excluded);
  const caps = model.meta.slider.positions;
  const calibration = model.meta.calibration!;
  const perRow = model.meta.estimated?.per_row;
  const nList = perRow ? N * perRow.list_factor : N;
  const depth0 = Math.max(nList, calibration.pool);
  const raw = topByPosition(ranked, base.scores, model.popularity, caps, depth0);
  // relative scores on the unfiltered base (spec D2)
  const unfilteredBase = base.positions[0]!.base;
  const pools = qualityPools(
    raw,
    ranked,
    base.scores,
    model,
    itemQuality(engine),
    depth0,
    undefined,
    classicsBonus(engine),
  );
  const fold = base.foldInItems;
  const pctOf = new Map(base.history.map((h) => [h.item, h.percentile]));
  let targetItems = fold;
  let lambdaZero = false;
  let genreFoldIn: number | undefined;
  if (gIdx.length) {
    targetItems = fold.filter((i) => gIdx.some((g) => (c.genres[i] ?? []).includes(g)));
    genreFoldIn = targetItems.length;
    lambdaZero = targetItems.length < 10;
  }
  const profile = shareProfile(
    c.genres,
    c.genre_names.length,
    targetItems,
    targetItems.map((i) => signal(pctOf.get(i)!, model.meta.beta)),
  );
  const lambdaFor = lambdaZero ? () => 0 : tunedLambda(calibration, undefined);
  const calibrated = calibratePositions(
    pools,
    base.scores,
    profile,
    c.genres,
    calibration,
    nList,
    lambdaFor,
  );
  const positions = calibrated.map((p) => {
    const items = perRow
      ? capEstimated(p.items, perRow.first_item_idx, perRow.max_per_row, perRow.row, N)
      : p.items;
    return {
      cap: p.cap,
      items,
      relativeScores: items.map((i) => base.scores[i]! / unfilteredBase),
    };
  });
  const tx = performance.now();
  if (process.env.UX_EXPLAIN === 'cats') {
    const shown = positions.filter((p) => p.cap === null || p.cap === 2000 || p.cap === 500);
    const todo = shown.flatMap((p) => p.items).filter((i) => !EXPLAINED.has(i));
    explainFor(engine, todo, base);
  } else
    explainFor(
      engine,
      positions.flatMap((p) => p.items),
      base,
    );
  const explainMs = performance.now() - tx;
  const same = positions.every((p, k) => p.items.join() === base.positions[k]!.items.join());
  return { counts: positions.map((p) => p.items.length), lambdaZero, genreFoldIn, same, explainMs };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'classics') await classics(rest);
  else if (cmd === 'filters') {
    const at = rest.indexOf('--export');
    await filters(at >= 0 ? rest[at + 1] : undefined);
  } else
    throw new Error(
      'usage: ux-measure.ts classics <A> <B> <exemple> | filters [--export <export>]',
    );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
