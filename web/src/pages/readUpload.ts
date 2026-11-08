// Reading a dropped file into an export input for the worker (step 5, D3; step 6, D5-D6). Runs in
// the page; the file never leaves the browser.
import { detectCsv } from '../adapters/detect';
import { decodeCsvBytes } from '../adapters/imdb';
import type { ExportInput } from '../reco/engine';

export const MESSAGES = {
  notExport: 'hmm, ça ressemble pas à un export letterboxd ou imdb.',
  imdbList:
    "ça, c'est une liste imdb (ou ta watchlist) : il nous faut tes notes. sur imdb, c'est l'export de « your ratings ».",
  watchlist:
    "ça, c'est ta watchlist : les films que t'as pas encore vus. il nous faut l'export complet (le .zip).",
  noneRecognized:
    "on n'a reconnu aucun de tes films… essaie avec l'export complet de letterboxd (le .zip) ou tes notes imdb.",
  engineDown: "oups, nos fiches n'ont pas pu se charger. recharge la page pour réessayer.",
} as const;

export type UploadResult = { ok: true; input: ExportInput } | { ok: false; message: string };

/**
 * ZIP -> Letterboxd. CSV -> decided by its header, never by its name (IMDb and Letterboxd both
 * call it ratings.csv); only the Letterboxd « watchlist » name rule is kept.
 */
export async function readUpload(file: File): Promise<UploadResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) {
    return { ok: true, input: { kind: 'zip', bytes: new Uint8Array(await file.arrayBuffer()) } };
  }
  if (name.endsWith('.csv')) {
    const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    const source = detectCsv(text);
    if (source === 'imdb-ratings') {
      return { ok: true, input: { kind: 'imdb', name: file.name, text } };
    }
    if (source === 'imdb-list') return { ok: false, message: MESSAGES.imdbList };
    if (name.includes('watchlist')) return { ok: false, message: MESSAGES.watchlist };
    return { ok: true, input: { kind: 'csv', name: file.name, text } };
  }
  return { ok: false, message: MESSAGES.notExport };
}
