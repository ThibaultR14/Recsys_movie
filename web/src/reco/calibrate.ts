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

// --- production path (step 6c, Q4): share mode, incremental, mirror of Python `calibrate_one` ---

/** model-meta.json `calibration` (written by pipeline/export.py). */
export interface CalibrationMeta {
  mode: 'share';
  pool: number;
  n_list: number;
  alpha: number;
  /** One λ per slider position, same order as `positions`. */
  lambda_by_position: number[];
  positions: (number | null)[];
}

/** p_g: weighted share of the films that have genre g (films without genre left out), summed in
 * history order (Python `share_profile_one`). */
export function shareProfile(
  genres: readonly (readonly number[])[],
  nGenres: number,
  items: readonly number[],
  weights: readonly number[],
): number[] {
  const v = new Array<number>(nGenres).fill(0);
  let total = 0;
  items.forEach((item, k) => {
    const gs = genres[item] ?? [];
    if (!gs.length) return;
    const w = weights[k]!;
    total += w;
    for (const g of gs) v[g]! += w;
  });
  return total > 0 ? v.map((x) => x / total) : v;
}

function bernoulliTerm(p: number, q: number, alpha: number): number {
  const qt = (1 - alpha) * q + alpha * p;
  let t = 0;
  if (p > 0) t += p * Math.log(p / qt);
  if (p < 1) t += (1 - p) * Math.log((1 - p) / (1 - qt));
  return t;
}

/**
 * Greedy calibrated list (share mode), incremental: at each step, with c = films with genres in
 * the list + 1, base = Σ_g f(p_g, Q_g / c) and Δ_g = f(p_g, (Q_g + 1) / c) − f(p_g, Q_g / c); a
 * candidate with genres scores base + Σ_{g in its genres} Δ_g; a candidate without genre leaves q
 * as is. O(n × (pool × genres per film + 2 × genres)). Ties: the first film of the pool.
 */
export function calibrateShare(
  pool: readonly number[],
  scores: readonly number[],
  p: readonly number[],
  genres: readonly (readonly number[])[],
  lambda: number,
  n: number,
  alpha: number = ALPHA,
  /** Step 6c D1b: one value per pool film (already × μ), subtracted from the normalised score. */
  penalty?: readonly number[],
): number[] {
  if (!pool.length) return [];
  let smax = -Infinity;
  for (const x of scores) if (x > smax) smax = x;
  const div = smax > 0 ? smax : 1;
  const s = scores.map((x, k) => x / div - (penalty ? penalty[k]! : 0));
  const nG = p.length;
  const sumQ = new Array<number>(nG).fill(0);
  const delta = new Array<number>(nG).fill(0);
  let nQ = 0;
  let sumS = 0;
  const taken = new Uint8Array(pool.length);
  const out: number[] = [];
  const steps = Math.min(n, pool.length);
  for (let step = 0; step < steps; step++) {
    let base = 0;
    let none = 0;
    if (lambda !== 0) {
      const c = nQ + 1;
      for (let g = 0; g < nG; g++) {
        const f0 = bernoulliTerm(p[g]!, sumQ[g]! / c, alpha);
        base += f0;
        delta[g] = bernoulliTerm(p[g]!, (sumQ[g]! + 1) / c, alpha) - f0;
      }
      for (let g = 0; g < nG; g++) none += bernoulliTerm(p[g]!, nQ ? sumQ[g]! / nQ : 0, alpha);
    }
    let best = -1;
    let bestObj = -Infinity;
    for (let k = 0; k < pool.length; k++) {
      if (taken[k]) continue;
      let obj: number;
      if (lambda === 0) obj = s[k]!;
      else {
        const gs = genres[pool[k]!] ?? [];
        let d: number;
        if (gs.length) {
          d = base;
          for (const g of gs) d += delta[g]!;
        } else d = none;
        obj = (1 - lambda) * (sumS + s[k]!) - lambda * d;
      }
      if (obj > bestObj) {
        bestObj = obj;
        best = k;
      }
    }
    if (best < 0) break;
    taken[best] = 1;
    const item = pool[best]!;
    out.push(item);
    sumS += s[best]!;
    const gs = genres[item] ?? [];
    for (const g of gs) sumQ[g]! += 1;
    if (gs.length) nQ++;
  }
  return out;
}

/**
 * Step 6c D1b (Python `proximity`): max(0, max cosine) of each pool film with the disliked films
 * (those D2 takes out of the fold-in); 0 everywhere without disliked film.
 * @param vectors dequantised item vectors, row-major (item * dims + d)
 */
export function proximity(
  pool: readonly number[],
  disliked: readonly number[],
  vectors: Float32Array,
  dims: number,
): number[] {
  const out = new Array<number>(pool.length).fill(0);
  if (!disliked.length) return out;
  const unit = (item: number) => {
    let n = 0;
    for (let d = 0; d < dims; d++) n += vectors[item * dims + d]! ** 2;
    const inv = n > 0 ? 1 / Math.sqrt(n) : 0;
    const u = new Float64Array(dims);
    for (let d = 0; d < dims; d++) u[d] = vectors[item * dims + d]! * inv;
    return u;
  };
  const bad = disliked.map(unit);
  pool.forEach((item, k) => {
    const u = unit(item);
    let best = 0;
    for (const b of bad) {
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += u[d]! * b[d]!;
      if (dot > best) best = dot;
    }
    out[k] = best;
  });
  return out;
}

/** λ of a slider position (0 when the table does not list it: no calibration). */
export function lambdaOf(meta: CalibrationMeta | undefined, cap: number | null): number {
  if (!meta) return 0;
  const i = meta.positions.indexOf(cap);
  return i < 0 ? 0 : (meta.lambda_by_position[i] ?? 0);
}
