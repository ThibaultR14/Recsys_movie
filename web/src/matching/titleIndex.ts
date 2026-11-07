/**
 * Title index built by the pipeline (export.py catalog -> /data/title-index.json, D3), with the
 * years of catalog.json and the popularity used to break ties.
 */
import { NORMALIZATION_VERSION } from './normalize';

export interface TitleIndexFile {
  v: number;
  norm: string;
  keys: string[];
  /** post[i] = 4 * item_idx + source for keys[i] (source 0 tmdb_title … 3 MovieLens alternate). */
  post: number[][];
  /** MovieLens year where it differs from catalog.json `year`. */
  ml_year: Record<string, number>;
}

export interface Posting {
  item: number;
  source: number;
}

export class TitleIndex {
  private readonly byKey = new Map<string, Posting[]>();
  readonly entries: { key: string; item: number; source: number }[] = [];

  constructor(
    file: TitleIndexFile,
    readonly years: readonly (number | null)[],
    readonly popularity: ArrayLike<number>,
  ) {
    if (file.norm !== NORMALIZATION_VERSION) {
      throw new Error(`title-index.json: normalisation ${file.norm} != ${NORMALIZATION_VERSION}`);
    }
    this.mlYears = new Map(Object.entries(file.ml_year).map(([k, y]) => [Number(k), y]));
    file.keys.forEach((key, i) => {
      const postings = (file.post[i] ?? []).map((code) => ({ item: code >> 2, source: code & 3 }));
      this.byKey.set(key, postings);
      for (const p of postings) this.entries.push({ key, ...p });
    });
  }

  private readonly mlYears: Map<number, number>;

  lookup(key: string): readonly Posting[] {
    return this.byKey.get(key) ?? [];
  }

  /** Every known year of a film (TMDB, then MovieLens if different). */
  yearsOf(item: number): number[] {
    const out: number[] = [];
    const y = this.years[item];
    if (y !== null && y !== undefined) out.push(y);
    const ml = this.mlYears.get(item);
    if (ml !== undefined && ml !== y) out.push(ml);
    return out;
  }
}

/** Fetch the three static files. Only /data/ URLs: user data never leaves the browser (D6). */
export async function loadTitleIndex(
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
  base = '/data/',
): Promise<TitleIndex> {
  const [index, catalog, popularity] = await Promise.all([
    fetchFn(`${base}title-index.json`).then((r) => r.json() as Promise<TitleIndexFile>),
    fetchFn(`${base}catalog.json`).then((r) => r.json() as Promise<{ year: (number | null)[] }>),
    fetchFn(`${base}popularity.bin`).then((r) => r.arrayBuffer()),
  ]);
  return new TitleIndex(index, catalog.year, new Uint32Array(popularity));
}
