/**
 * ALS fold-in (docs/etape-4-navigateur.md, D2), reproduction of Python `models.als.fold_in`:
 *
 *   (YᵀY + reg·I + Σᵢ (cᵢ − 1) yᵢ yᵢᵀ) x = Σᵢ cᵢ yᵢ,   cᵢ = alpha · rᵢ,   rᵢ = 1 + β · pᵢ (float32)
 *
 * float64 everywhere except the float32 inputs (dequantised vectors, YᵀY, signal), as in Python.
 */
import type { ModelFiles } from './modelFiles';

/** r = 1 + β·p computed in float32, like `signal_values` (numpy float32 arithmetic). */
export function signal(percentile: number, beta: number): number {
  return Math.fround(1 + Math.fround(beta * Math.fround(percentile)));
}

export class FoldInError extends Error {}

/**
 * Films kept in the fold-in (step 6c, D2), reproduction of Python `models.als.kept_for_foldin`:
 * every film except the rated ones with a percentile < dropBelow (strict; equal ratings share their
 * percentile, so a tie group goes as a whole); unrated films are never dropped; if fewer than
 * minKept films would remain, every film is kept.
 */
export function keptForFoldIn(
  percentiles: readonly number[],
  rated: readonly boolean[],
  dropBelow: number | undefined,
  minKept: number,
): boolean[] {
  if (dropBelow === undefined) return percentiles.map(() => true);
  const keep = percentiles.map((p, i) => !(rated[i] && p < dropBelow));
  return keep.filter(Boolean).length < minKept ? percentiles.map(() => true) : keep;
}

/** User vector from catalogue items and their percentiles (same order). */
export function foldIn(
  model: ModelFiles,
  items: readonly number[],
  percentiles: readonly number[],
): Float64Array {
  if (items.length === 0) throw new FoldInError('aucun film reconnu');
  const { dims, vectors, yty } = model;
  const { regularization, alpha, beta } = model.meta;
  const A = Float64Array.from(yty);
  for (let d = 0; d < dims; d++) A[d * dims + d]! += regularization;
  const b = new Float64Array(dims);
  for (let n = 0; n < items.length; n++) {
    const c = alpha * signal(percentiles[n]!, beta);
    const w = c - 1;
    const row = items[n]! * dims;
    for (let j = 0; j < dims; j++) {
      const yj = vectors[row + j]!;
      b[j]! += c * yj;
      const wyj = w * yj;
      for (let k = j; k < dims; k++) A[j * dims + k]! += wyj * vectors[row + k]!;
    }
  }
  for (let j = 0; j < dims; j++) {
    for (let k = j + 1; k < dims; k++) A[k * dims + j] = A[j * dims + k]!;
  }
  return choleskySolve(A, b, dims);
}

/** Solve A x = b for a symmetric positive-definite A (row-major, overwritten). */
export function choleskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  // A = L Lᵀ, L stored in the lower triangle of A
  for (let j = 0; j < n; j++) {
    let diag = A[j * n + j]!;
    for (let k = 0; k < j; k++) diag -= A[j * n + k]! * A[j * n + k]!;
    if (!(diag > 0)) throw new FoldInError('système non défini positif');
    const ljj = Math.sqrt(diag);
    A[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j]!;
      for (let k = 0; k < j; k++) s -= A[i * n + k]! * A[j * n + k]!;
      A[i * n + j] = s / ljj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= A[i * n + k]! * y[k]!;
    y[i] = s / A[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= A[k * n + i]! * x[k]!;
    x[i] = s / A[i * n + i]!;
  }
  return x;
}
