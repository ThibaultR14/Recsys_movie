/**
 * Scores and popularity-cap slider (docs/etape-4-navigateur.md, D3), reproduction of Python
 * `export.top_under_cap`: candidates = recommendable, not excluded, popularity <= cap; ranked by
 * score (desc), then item_idx (asc).
 */
import type { ModelFiles } from './modelFiles';

export interface PositionResult {
  /** Popularity cap; null = ∞ (natural order of the model). */
  cap: number | null;
  items: number[];
  scores: number[];
  /** Mean score of the first RELATIVE_TOP films / the same at ∞ (drift from the user's taste). */
  relativeScore: number;
  /** score of each shown film / the same base (step 6b: rows « loin de tes goûts »). */
  relativeScores: number[];
  /** Mean score of the first RELATIVE_TOP films at ∞ (the base of the relative scores). */
  base: number;
}

export const RELATIVE_TOP = 20;

/** score_i = y_i · x in float64 for every film. */
export function scoreAll(model: ModelFiles, x: Float64Array): Float64Array {
  const { nItems, dims, vectors } = model;
  const scores = new Float64Array(nItems);
  for (let i = 0; i < nItems; i++) {
    let s = 0;
    const row = i * dims;
    for (let d = 0; d < dims; d++) s += vectors[row + d]! * x[d]!;
    scores[i] = s;
  }
  return scores;
}

/** Candidate items sorted by score desc, then item_idx asc. */
export function rankCandidates(
  scores: Float64Array,
  recommendable: Uint8Array,
  excluded: ReadonlySet<number>,
): Int32Array {
  const items: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (recommendable[i] && !excluded.has(i)) items.push(i);
  }
  items.sort((a, b) => scores[b]! - scores[a]! || a - b);
  return Int32Array.from(items);
}

/** First `n` ranked films under each cap, and the relative score of each position. */
export function topByPosition(
  ranked: Int32Array,
  scores: Float64Array,
  popularity: Uint32Array,
  caps: readonly (number | null)[],
  n: number,
): PositionResult[] {
  const firstUnder = (cap: number | null, count: number): number[] => {
    const items: number[] = [];
    for (let k = 0; k < ranked.length && items.length < count; k++) {
      const i = ranked[k]!;
      if (cap === null || popularity[i]! <= cap) items.push(i);
    }
    return items;
  };
  // relative score: always on the first RELATIVE_TOP films of each position, whatever `n`
  const meanTop = (items: number[]) => {
    const top = items.slice(0, RELATIVE_TOP);
    return top.length ? top.reduce((a, i) => a + scores[i]!, 0) / top.length : 0;
  };
  const base = meanTop(firstUnder(null, RELATIVE_TOP));
  return caps.map((cap) => {
    const items = firstUnder(cap, Math.max(n, RELATIVE_TOP));
    const shown = items.slice(0, n);
    return {
      cap,
      items: shown,
      scores: shown.map((i) => scores[i]!),
      relativeScore: base > 0 ? meanTop(items) / base : 0,
      relativeScores: shown.map((i) => (base > 0 ? scores[i]! / base : 0)),
      base,
    };
  });
}
