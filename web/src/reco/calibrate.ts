/**
 * Calibration by genres (Steck, RecSys 2018), step 6c D1: reproduction of Python
 * `pipeline/calibration.py` (`profile`, `calibrate_batch`). At a slider position, the list is built
 * one film at a time from a pool (best model scores first), maximising
 *
 *   (1 − λ) · Σ s_i / s_max − λ · KL(p ‖ (1 − α) q + α p)
 *
 * p = genre distribution of the fold-in films (1/k per genre of a film with k genres, weighted by
 * its signal), q = the same for the list (uniform weights). Films without genre count in neither.
 * Ties: the first film of the pool.
 */
export const POOL = 150;
export const ALPHA = 0.01;

/**
 * Two ways of measuring the genres (step 6c, Q3):
 * - 'mass' (Steck): a film with k genres gives 1/k to each; p and q are distributions; KL(p ‖ q̃);
 * - 'share': each genre is a yes/no per film; p_g and q_g are the (weighted) shares of films that
 *   have genre g; the divergence is the sum over genres of the Bernoulli KL of p_g against q̃_g.
 *   It targets « the share of animation films » directly.
 */
export type CalibrationMode = 'mass' | 'share';

/** Genre vectors: item -> sparse list of [genre, 1/k]; empty for a film without genre. */
export type GenreRows = readonly (readonly (readonly [number, number])[])[];

export function genreRows(
  genres: readonly (readonly number[])[],
  mode: CalibrationMode = 'mass',
): GenreRows {
  return genres.map((gs) => gs.map((g) => [g, mode === 'mass' ? 1 / gs.length : 1] as const));
}

/**
 * p(g) of the films (films without genre left out): 'mass' -> distribution (sums to 1);
 * 'share' -> weighted share of the films that have genre g.
 */
export function genreProfile(
  rows: GenreRows,
  nGenres: number,
  items: readonly number[],
  weights: readonly number[],
  mode: CalibrationMode = 'mass',
): Float64Array {
  const v = new Float64Array(nGenres);
  let films = 0;
  items.forEach((item, k) => {
    const gs = rows[item] ?? [];
    if (gs.length) films += weights[k]!;
    for (const [g, x] of gs) v[g]! += x * weights[k]!;
  });
  let total = 0;
  for (const x of v) total += x;
  const norm = mode === 'mass' ? total : films;
  if (norm > 0) for (let g = 0; g < nGenres; g++) v[g]! /= norm;
  return v;
}

/** Σ_g Bernoulli KL(p_g ‖ q̃_g), q̃ = (1 − α) q + α p ('share' mode). */
export function bernoulliDivergence(p: Float64Array, q: Float64Array): number {
  let s = 0;
  for (let g = 0; g < p.length; g++) {
    const pg = p[g]!;
    const qg = (1 - ALPHA) * q[g]! + ALPHA * pg;
    if (pg > 0) s += pg * Math.log(pg / qg);
    if (pg < 1) s += (1 - pg) * Math.log((1 - pg) / (1 - qg));
  }
  return s;
}

/** KL(p ‖ (1 − α) q + α p); 0·log 0 = 0. */
export function klDivergence(p: Float64Array, q: Float64Array): number {
  let s = 0;
  for (let g = 0; g < p.length; g++) {
    const pg = p[g]!;
    if (pg > 0) s += pg * Math.log(pg / ((1 - ALPHA) * q[g]! + ALPHA * pg));
  }
  return s;
}

/**
 * Greedy calibrated list of `n` films from `pool` (best first) and its `scores`.
 * λ = 0 gives the score order.
 */
export function calibrate(
  pool: readonly number[],
  scores: readonly number[],
  p: Float64Array,
  rows: GenreRows,
  lambda: number,
  n: number,
  mode: CalibrationMode = 'mass',
): number[] {
  const divergence = mode === 'mass' ? klDivergence : bernoulliDivergence;
  const smax = Math.max(...scores);
  const s = scores.map((x) => x / (smax > 0 ? smax : 1));
  const nG = p.length;
  const sumQ = new Float64Array(nG);
  const q = new Float64Array(nG);
  let nQ = 0;
  let sumS = 0;
  const taken = new Uint8Array(pool.length);
  const out: number[] = [];
  for (let step = 0; step < n && step < pool.length; step++) {
    let best = -1;
    let bestObj = -Infinity;
    for (let k = 0; k < pool.length; k++) {
      if (taken[k]) continue;
      const genres = rows[pool[k]!] ?? [];
      const cnt = nQ + (genres.length > 0 ? 1 : 0);
      q.set(sumQ);
      for (const [g, x] of genres) q[g]! += x;
      if (cnt > 0) for (let g = 0; g < nG; g++) q[g]! /= cnt;
      // λ = 0: the score only (same path as Python: best remaining score, first on ties)
      const obj = lambda === 0 ? s[k]! : (1 - lambda) * (sumS + s[k]!) - lambda * divergence(p, q);
      if (obj > bestObj) {
        bestObj = obj;
        best = k;
      }
    }
    if (best < 0) break;
    taken[best] = 1;
    out.push(pool[best]!);
    sumS += s[best]!;
    const genres = rows[pool[best]!] ?? [];
    for (const [g, x] of genres) sumQ[g]! += x;
    if (genres.length > 0) nQ++;
  }
  return out;
}
