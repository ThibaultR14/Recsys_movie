/** Helpers for the terminal scripts: same handler as the Web Worker, files read from disk. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExportInput } from '../src/reco/engine';
import { createHandler, type RecoRequest } from '../src/reco/workerCore';

export const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(WEB_ROOT, 'public', 'data');

/** The Worker's handler, with `fetch` reading web/public/data/ (only /data/ URLs). */
export function localHandler() {
  const handle = createHandler(async (url) => {
    if (!url.startsWith('/data/')) throw new Error(`URL interdite : ${url}`);
    return new Response(readFileSync(join(DATA, url.slice('/data/'.length))));
  });
  return async <T>(request: RecoRequest): Promise<T> => {
    const response = await handle(request);
    if (!response.ok) throw new Error(response.error);
    return response.result as T;
  };
}

/** A Letterboxd export given as a ZIP or as an unzipped folder. */
export function exportInput(path: string): ExportInput {
  if (statSync(path).isDirectory()) {
    const files: Record<string, string> = {};
    for (const f of readdirSync(path)) {
      if (f.endsWith('.csv')) files[f] = readFileSync(join(path, f), 'utf-8');
    }
    return { kind: 'files', files };
  }
  return { kind: 'zip', bytes: new Uint8Array(readFileSync(path)) };
}
