/**
 * Timings of the recommendation engine (docs/etape-4-navigateur.md, F5), same code as the Worker.
 * Prints to the terminal only.
 *
 *   npx tsx scripts/reco-bench.ts [--export <export.zip | folder>]
 *
 * Histories: the given export (if any) and synthetic ones of 225, 1 000 and 3 000 films built
 * from catalogue titles (exact matches, deterministic ratings).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogFile } from '../src/reco/engine';
import type { ImportResult, InitResult, RecommendResult } from '../src/reco/workerCore';
import { exportInput, localHandler, WEB_ROOT } from './local';

const RUNS = 7;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function syntheticExport(catalog: CatalogFile, size: number) {
  const rows = ['Date,Name,Year,Letterboxd URI,Rating'];
  for (let k = 0; k < size; k++) {
    const i = (k * 7919 + 13) % catalog.n;
    const title = catalog.title[i]!.replace(/"/g, '""');
    const rating = 0.5 * (1 + ((k * 37) % 10));
    rows.push(`2024-01-01,"${title}",${catalog.year[i] ?? ''},https://boxd.it/s${k},${rating}`);
  }
  return { kind: 'files' as const, files: { 'ratings.csv': rows.join('\n') } };
}

async function main() {
  const exportAt = process.argv.indexOf('--export');
  const exportPath = exportAt >= 0 ? process.argv[exportAt + 1] : undefined;

  const call = localHandler();
  const t0 = performance.now();
  const init = await call<InitResult>({ id: 1, type: 'init' });
  const loadMs = performance.now() - t0;
  const t = init.timings;
  console.log(
    `chargement (Node, disque) : ${loadMs.toFixed(0)} ms au total — lecture des fichiers ` +
      `${t.fetchMs.toFixed(0)} ms, modèle ${t.modelMs.toFixed(0)} ms, index ${t.indexMs.toFixed(0)} ms, ` +
      `Matcher ${t.matcherMs.toFixed(0)} ms`,
  );

  const catalog = JSON.parse(
    readFileSync(join(WEB_ROOT, 'public', 'data', 'catalog.json'), 'utf-8'),
  ) as CatalogFile;
  const histories: [string, ReturnType<typeof syntheticExport> | ReturnType<typeof exportInput>][] =
    [];
  if (exportPath && existsSync(exportPath))
    histories.push(['export réel', exportInput(exportPath)]);
  for (const size of [225, 1000, 3000])
    histories.push([`synthétique ${size}`, syntheticExport(catalog, size)]);

  let id = 10;
  for (const [label, input] of histories) {
    const importMs: number[] = [];
    const recoMs: number[] = [];
    const explainMs: number[] = [];
    const calibrationMs: number[] = [];
    let used = 0;
    for (let run = 0; run < RUNS; run++) {
      const a = performance.now();
      const imported = await call<ImportResult>({ id: id++, type: 'import', input });
      const b = performance.now();
      const reco = await call<RecommendResult>({ id: id++, type: 'recommend', n: 48 });
      const c = performance.now();
      importMs.push(b - a);
      recoMs.push(c - b);
      explainMs.push(reco.explainMs ?? 0);
      calibrationMs.push(reco.calibrationMs ?? 0);
      used = imported.summary.nHistoryFilms;
    }
    console.log(
      `${label.padEnd(18)} ${String(used).padStart(5)} films utilisés · lecture + correspondance ` +
        `${median(importMs).toFixed(1)} ms · recommend (8 positions × 48) ` +
        `${median(recoMs).toFixed(1)} ms, dont calibration ${median(calibrationMs).toFixed(1)} ms ` +
        `et explications ${median(explainMs).toFixed(1)} ms ` +
        `(médiane de ${RUNS})`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
