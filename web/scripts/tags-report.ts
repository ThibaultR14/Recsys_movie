/**
 * Card tags, step 6c Q6 (docs/etape-6c-qualite.md, section 8): measures before any threshold.
 * Terminal only, counts only (no title, no director name).
 *
 *   npx tsx scripts/tags-report.ts <export.zip | export folder | imdb.csv>
 *
 * Needs `test-data/tag_stats.json` (pipeline: `uv run python tag_diagnostics.py stats`).
 * Tags (one per card at most, hierarchy: pépite > réalisateur > ça divise > vieux trésor):
 * - pépite: the « ✱ pépite » stamp of the grid (`pepiteStamps`, blocks of 8);
 * - réalisateur: a director of the film is one of the profile phrase's (`profileDirectors`);
 * - ça divise: std of the MovieLens ratings above a quantile of the catalogue (raw or shrunk);
 * - vieux trésor: released before a year and popularity at most a cap.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pepiteStamps, STAMP_BLOCK } from '../src/components/cardRules';
import { profileDirectors } from '../src/reco/annotations';
import { importExport, loadEngine, recommend, type ExportInput } from '../src/reco/engine';
import { exportInput, WEB_ROOT } from './local';

const DATA = join(WEB_ROOT, 'public', 'data');
const STATS = join(WEB_ROOT, 'test-data', 'tag_stats.json');
const N = 48;
const ROWS = N / STAMP_BLOCK;

type Tag = 'pepite' | 'realisateur' | 'divise' | 'vieux';
const ORDER: Tag[] = ['pepite', 'realisateur', 'divise', 'vieux'];

function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** One tag per card, by the hierarchy; then at most `cap` tags per row of 8 (hierarchy, then list
 * order: a pépite is never dropped while a lower tag stays). */
export function assignTags(cands: readonly Set<Tag>[], cap = Infinity): (Tag | null)[] {
  const one = cands.map((c) => ORDER.find((t) => c.has(t)) ?? null);
  const out = one.slice();
  for (let start = 0; start < out.length; start += STAMP_BLOCK) {
    const idx = [...Array(Math.min(STAMP_BLOCK, out.length - start)).keys()]
      .map((k) => start + k)
      .filter((i) => out[i] !== null)
      .sort((a, b) => ORDER.indexOf(out[a]!) - ORDER.indexOf(out[b]!) || a - b);
    for (const i of idx.slice(cap)) out[i] = null;
  }
  return out;
}

async function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path)) throw new Error('usage : tags-report <export>');
  if (!existsSync(STATS)) throw new Error(`${STATS} absent : tag_diagnostics.py stats`);
  const stats = JSON.parse(readFileSync(STATS, 'utf-8')) as {
    ml_std_x100: number[];
    ml_std_shrunk_x100: number[];
    year: (number | null)[];
  };
  const engine = await loadEngine(async (url) => {
    if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
    return new Response(readFileSync(join(DATA, url.slice('/data/'.length))));
  });
  const input: ExportInput = path.endsWith('.csv')
    ? { kind: 'imdb', name: 'ratings.csv', text: readFileSync(path, 'utf-8') }
    : exportInput(path);
  const { matched } = importExport(engine, input);
  const reco = recommend(engine, matched, { n: N });
  const { catalog, model } = engine;
  const directors = new Set(profileDirectors(reco.history, catalog));
  console.log(
    `\nhistorique : ${reco.history.length} films ; réalisateurs de la phrase de profil : ${directors.size}`,
  );

  const raw = stats.ml_std_x100;
  const shrunk = stats.ml_std_shrunk_x100;
  const th = {
    raw10: quantile(raw, 0.9),
    s5: quantile(shrunk, 0.95),
    s10: quantile(shrunk, 0.9),
    s15: quantile(shrunk, 0.85),
  };
  const divise = {
    'brut 10 %': (i: number) => raw[i]! >= th.raw10,
    'rétréci 5 %': (i: number) => shrunk[i]! >= th.s5,
    'rétréci 10 %': (i: number) => shrunk[i]! >= th.s10,
    'rétréci 15 %': (i: number) => shrunk[i]! >= th.s15,
  };
  const year = (i: number) => stats.year[i] ?? 9999;
  const pop = (i: number) => model.popularity[i]!;
  const vieux = {
    '< 1960, ≤ 1 000': (i: number) => year(i) < 1960 && pop(i) <= 1000,
    '< 1970, ≤ 1 000': (i: number) => year(i) < 1970 && pop(i) <= 1000,
    '< 1970, ≤ 2 000': (i: number) => year(i) < 1970 && pop(i) <= 2000,
    '< 1970, ≤ 5 000': (i: number) => year(i) < 1970 && pop(i) <= 5000,
    '< 1980, ≤ 1 000': (i: number) => year(i) < 1980 && pop(i) <= 1000,
  };
  console.log(
    `seuils d'écart-type : brut 10 % ${th.raw10 / 100} ; rétréci 5 / 10 / 15 % ${th.s5 / 100} / ${th.s10 / 100} / ${th.s15 / 100}`,
  );

  const caps = reco.positions.map((p) => String(p.cap ?? '∞').padStart(6));
  const head = `${''.padEnd(22)} ${caps.join(' ')}`;
  const isDirector = (i: number) => (catalog.directors[i] ?? []).some((d) => directors.has(d));

  // ---- 1. raw frequencies (before the hierarchy): cards out of 48, and out of the first 16
  console.log(`\n── fréquence brute (avant hiérarchie) : cartes /48 (16 premières) ──\n${head}`);
  const row = (label: string, f: (items: readonly number[], k: number) => boolean) => {
    const cells = reco.positions.map((p) => {
      const items = p.items.slice(0, N);
      const all = items.filter((_, k) => f(items, k)).length;
      const first = items.slice(0, 16).filter((_, k) => f(items, k)).length;
      return `${all} (${first})`.padStart(6);
    });
    console.log(`${label.padEnd(22)} ${cells.join(' ')}`);
  };
  const stampsOf = (items: readonly number[]) => pepiteStamps(items.map(pop));
  row('pépite', (items, k) => stampsOf(items).has(k));
  row('réalisateur', (items, k) => isDirector(items[k]!));
  for (const [name, f] of Object.entries(divise))
    row(`ça divise ${name}`, (items, k) => f(items[k]!));
  for (const [name, f] of Object.entries(vieux)) row(`vieux ${name}`, (items, k) => f(items[k]!));

  // ---- 2. after the hierarchy (default variant), and tags per row of 8
  const variants: [string, keyof typeof divise, keyof typeof vieux][] = [
    ['A', 'rétréci 10 %', '< 1970, ≤ 1 000'],
    ['B', 'rétréci 10 %', '< 1960, ≤ 1 000'],
  ];
  for (const [name, dv, vv] of variants) {
    console.log(
      `\n── variante ${name} (ça divise ${dv} ; vieux trésor ${vv}) : après hiérarchie, cartes /48 par tag · tags par rangée de 8 (moyenne, max) ──\n${head}`,
    );
    const per = reco.positions.map((p) => {
      const items = p.items.slice(0, N);
      const stamps = stampsOf(items);
      const cands = items.map((i, k) => {
        const s = new Set<Tag>();
        if (stamps.has(k)) s.add('pepite');
        if (isDirector(i)) s.add('realisateur');
        if (divise[dv](i)) s.add('divise');
        if (vieux[vv](i)) s.add('vieux');
        return s;
      });
      return cands;
    });
    for (const t of ORDER) {
      const cells = per.map((c) => String(assignTags(c).filter((x) => x === t).length).padStart(6));
      console.log(`${t.padEnd(22)} ${cells.join(' ')}`);
    }
    for (const cap of [Infinity, 3, 2]) {
      const cells = per.map((c) => {
        const tags = assignTags(c, cap);
        const counts = [...Array(ROWS).keys()].map(
          (r) => tags.slice(r * STAMP_BLOCK, (r + 1) * STAMP_BLOCK).filter(Boolean).length,
        );
        const mean = counts.reduce((a, b) => a + b, 0) / ROWS;
        return `${mean.toFixed(1)}·${Math.max(...counts)}`.padStart(6);
      });
      console.log(
        `${`par rangée, plafond ${cap === Infinity ? '—' : cap}`.padEnd(22)} ${cells.join(' ')}`,
      );
    }
    // cards without any tag in the first row (what the user sees first)
    const cells = per.map((c) =>
      String(assignTags(c, 2).slice(0, 8).filter(Boolean).length).padStart(6),
    );
    console.log(`${'1re rangée, plafond 2'.padEnd(22)} ${cells.join(' ')}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
