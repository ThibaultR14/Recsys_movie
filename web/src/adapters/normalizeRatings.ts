/**
 * Ratings -> percentiles within the user's history (docs/etape-3-letterboxd.md, D4). Identical to
 * Python `percentile_values` (pipeline/models/als.py), rounded to float32 like the training signal.
 *
 * p = (average rank - 1) / (n - 1) among rated films (ties share their average rank); 0.5 when a
 * single film is rated; 0.5 for a film watched without a rating.
 */

export function percentiles(ratings: readonly (number | undefined)[]): number[] {
  const rated = ratings
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: number; i: number } => x.r !== undefined);
  const out = ratings.map(() => Math.fround(0.5));
  const n = rated.length;
  if (n <= 1) return out;
  rated.sort((a, b) => a.r - b.r);
  let start = 0;
  while (start < n) {
    let end = start;
    while (end + 1 < n && rated[end + 1]!.r === rated[start]!.r) end++;
    const averageRank = (start + 1 + (end + 1)) / 2;
    const p = Math.fround((averageRank - 1) / (n - 1));
    for (let k = start; k <= end; k++) out[rated[k]!.i] = p;
    start = end + 1;
  }
  return out;
}

/** One item per key: the most recent (undated entries lose; later rows win ties). */
export function dedupeLatest<T>(
  items: readonly T[],
  keyOf: (item: T) => number | string,
  dateOf: (item: T) => string | undefined = (item) => (item as { date?: string }).date,
): T[] {
  const best = new Map<number | string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const current = best.get(key);
    if (!current || (dateOf(item) ?? '') >= (dateOf(current) ?? '')) best.set(key, item);
  }
  return [...best.values()];
}
