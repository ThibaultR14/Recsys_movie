/**
 * « (parce que t'as aimé X et Y) » (docs/etape-6b-retouches.md, D6): for each recommended film, the
 * history films closest to it (cosine of the item vectors). Computed once after `recommend`, for
 * every distinct film of the 8 positions; moving the slider recomputes nothing.
 *
 * Pool: the rated films with a percentile ≥ LIKED_PERCENTILE (« aimé »). A history without any
 * rating (all at 0.5, e.g. watched.csv alone) falls back to every seen film (« vu »). A history
 * with ratings but none above the threshold gets no explanation.
 */
import type { UserFilm } from '../matching/history';

export const LIKED_PERCENTILE = 0.7;
/** A history film is cited only if its cosine with the recommended film is above this. */
export const MIN_COSINE = 0;
export const MAX_CITED = 2;
/** Candidates kept per film for the diversity rule of the grid (R6, option A). */
export const CANDIDATES = 5;

export interface Explanation {
  kind: 'liked' | 'seen';
  /** History item indices, closest first (up to `maxCited`). */
  items: number[];
}

export interface ExplainOptions {
  likedPercentile?: number;
  minCosine?: number;
  maxCited?: number;
}

/** History films that may be cited, and how (« aimé » or « vu »). */
export function explanationPool(
  history: readonly UserFilm[],
  likedPercentile = LIKED_PERCENTILE,
): { kind: Explanation['kind']; items: number[] } {
  const rated = history.filter((h) => h.rating !== undefined);
  if (rated.length === 0) return { kind: 'seen', items: history.map((h) => h.item) };
  return {
    kind: 'liked',
    items: rated.filter((h) => h.percentile >= likedPercentile).map((h) => h.item),
  };
}

/**
 * @param vectors item vectors, row-major (item * dims + d), dequantised (the per-item int8 scale
 *   would cancel out in the cosine anyway)
 */
export function explain(
  vectors: Float32Array,
  dims: number,
  history: readonly UserFilm[],
  targets: readonly number[],
  options: ExplainOptions = {},
): Map<number, Explanation> {
  const minCosine = options.minCosine ?? MIN_COSINE;
  const maxCited = options.maxCited ?? MAX_CITED;
  const pool = explanationPool(history, options.likedPercentile);
  const out = new Map<number, Explanation>();
  if (pool.items.length === 0) return out;

  // unit vectors of the pool, once
  const unit = new Float64Array(pool.items.length * dims);
  pool.items.forEach((item, k) => {
    let n = 0;
    for (let d = 0; d < dims; d++) n += vectors[item * dims + d]! ** 2;
    const inv = n > 0 ? 1 / Math.sqrt(n) : 0;
    for (let d = 0; d < dims; d++) unit[k * dims + d] = vectors[item * dims + d]! * inv;
  });

  for (const target of targets) {
    if (out.has(target)) continue;
    let norm = 0;
    for (let d = 0; d < dims; d++) norm += vectors[target * dims + d]! ** 2;
    if (norm === 0) continue;
    const inv = 1 / Math.sqrt(norm);
    const best: { item: number; cos: number }[] = [];
    for (let k = 0; k < pool.items.length; k++) {
      const item = pool.items[k]!;
      if (item === target) continue;
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += unit[k * dims + d]! * vectors[target * dims + d]!;
      const cos = dot * inv;
      if (cos <= minCosine) continue;
      if (best.length < maxCited || cos > best[best.length - 1]!.cos) {
        best.push({ item, cos });
        best.sort((a, b) => b.cos - a.cos || a.item - b.item);
        if (best.length > maxCited) best.pop();
      }
    }
    if (best.length > 0) out.set(target, { kind: pool.kind, items: best.map((b) => b.item) });
  }
  return out;
}
