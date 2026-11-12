/**
 * Step 8 (docs/etape-8-films-recents.md): estimated films in an export and in its lists. Counts
 * only (no title), terminal only.
 *
 *   npx tsx scripts/recent-report.ts <export.zip | folder | imdb.csv>
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { detectCsv } from '../src/adapters/detect';
import { decodeCsvBytes } from '../src/adapters/imdb';
import { importExport, loadEngine, recommend } from '../src/reco/engine';
import type { ExportInput } from '../src/reco/engine';
import { WEB_ROOT } from './local';

async function localFetch(url: string): Promise<Response> {
  if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
  return new Response(readFileSync(join(WEB_ROOT, 'public', 'data', url.slice('/data/'.length))));
}

function input(path: string): ExportInput {
  if (statSync(path).isDirectory()) {
    const files: Record<string, string> = {};
    for (const f of readdirSync(path)) {
      if (f.endsWith('.csv')) files[f] = readFileSync(join(path, f), 'utf-8');
    }
    return { kind: 'files', files };
  }
  if (path.toLowerCase().endsWith('.csv')) {
    const text = decodeCsvBytes(new Uint8Array(readFileSync(path)));
    return detectCsv(text) === 'imdb-ratings'
      ? { kind: 'imdb', name: basename(path), text }
      : { kind: 'files', files: { [basename(path)]: text } };
  }
  return { kind: 'zip', bytes: new Uint8Array(readFileSync(path)) };
}

async function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path)) throw new Error('usage: recent-report.ts <export>');
  const engine = await loadEngine(localFetch);
  const n = engine.catalog.n_trained ?? engine.catalog.n;
  const { matched, summary } = importExport(engine, input(path));
  const history = matched.filter((m) => m.result.status === 'exact' && m.result.item !== undefined);
  const estimatedSeen = history.filter((m) => m.result.item! >= n).length;
  const t0 = performance.now();
  const res = recommend(engine, matched, { n: 48 });
  const ms = performance.now() - t0;
  const rows = res.positions.map((p) => {
    const est8 = p.items.slice(0, 8).filter((i) => i >= n).length;
    const est48 = p.items.filter((i) => i >= n).length;
    return { cap: p.cap ?? '∞', first8: est8, of48: est48 };
  });
  console.log(
    JSON.stringify(
      {
        entries: summary.nEntries,
        historyFilms: summary.nHistoryFilms,
        estimatedInHistory: estimatedSeen,
        recommendMs: Math.round(ms),
        estimatedPerNotch: rows,
      },
      null,
      1,
    ),
  );
}

await main();
