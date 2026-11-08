// Reading a dropped file into an export input for the worker (step 5, D3). Runs in the page; the
// file never leaves the browser.
import type { ExportInput } from '../reco/engine';

export const MESSAGES = {
  notExport: 'hmm, ça ressemble pas à un export letterboxd.',
  imdbSoon: 'les exports imdb arrivent bientôt.',
  watchlist:
    "ça, c'est ta watchlist : les films que t'as pas encore vus. il nous faut l'export complet (le .zip).",
  noneRecognized:
    "on n'a reconnu aucun de tes films… essaie avec l'export complet de letterboxd (le .zip).",
  engineDown: "oups, nos fiches n'ont pas pu se charger. recharge la page pour réessayer.",
} as const;

export type UploadResult = { ok: true; input: ExportInput } | { ok: false; message: string };

/** IMDb ratings export: « Const », « Your Rating », « Title Type »… columns. */
export function looksLikeImdb(header: string): boolean {
  const cols = header.split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
  return cols.includes('const') && (cols.includes('your rating') || cols.includes('title type'));
}

export async function readUpload(file: File): Promise<UploadResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) {
    return { ok: true, input: { kind: 'zip', bytes: new Uint8Array(await file.arrayBuffer()) } };
  }
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const header =
      (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? '';
    if (looksLikeImdb(header)) return { ok: false, message: MESSAGES.imdbSoon };
    if (name.includes('watchlist')) return { ok: false, message: MESSAGES.watchlist };
    return { ok: true, input: { kind: 'csv', name: file.name, text } };
  }
  return { ok: false, message: MESSAGES.notExport };
}
