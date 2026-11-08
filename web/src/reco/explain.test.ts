import { describe, expect, it } from 'vitest';
import type { UserFilm } from '../matching/history';
import { explain, explanationPool } from './explain';

// 2-D item vectors: angle in degrees -> unit vector times a norm (cosine ignores the norm).
function vectors(spec: [number, number][]): Float32Array {
  const out = new Float32Array(spec.length * 2);
  spec.forEach(([deg, norm], i) => {
    out[2 * i] = norm * Math.cos((deg * Math.PI) / 180);
    out[2 * i + 1] = norm * Math.sin((deg * Math.PI) / 180);
  });
  return out;
}

const film = (item: number, percentile: number, rating: number | undefined = 5): UserFilm => ({
  item,
  rating,
  percentile,
  status: 'exact',
});

// items 0-5: history; 6-8: recommended targets
const V = vectors([
  [0, 1], // 0 liked
  [20, 3], // 1 liked
  [90, 1], // 2 liked
  [5, 1], // 3 not liked (0.5)
  [180, 1], // 4 liked, opposite
  [10, 2], // 5 liked
  [8, 1], // 6 target near 0, 5, 1
  [130, 0.2], // 7 target between 90 (40° away) and 180 (50° away)
  [180, 1], // 8 target opposite to item 0
]);
const HISTORY = [film(0, 0.9), film(1, 0.7), film(2, 0.95), film(3, 0.5), film(4, 0.8), film(5, 1)];

describe('explain (step 6b, D6)', () => {
  it('the two closest liked films, closest first; the norm does not matter', () => {
    const out = explain(V, 2, HISTORY, [6]);
    expect(out.get(6)).toEqual({ kind: 'liked', items: [5, 0] });
  });

  it('films under the percentile threshold are never cited', () => {
    const out = explain(V, 2, HISTORY, [6], { maxCited: 6 });
    expect(out.get(6)!.items).not.toContain(3);
    expect(out.get(6)!.items).toEqual([5, 0, 1, 2]); // cosine > 0 only: 4 (172°) is out
  });

  it('cosine ≤ 0 is never cited; one film above the threshold -> one title; none -> nothing', () => {
    expect(explain(V, 2, HISTORY, [7]).get(7)).toEqual({ kind: 'liked', items: [2, 4] });
    expect(explain(V, 2, [film(0, 0.9)], [8]).has(8)).toBe(false); // cosine -1
    const one = explain(V, 2, [film(0, 0.9), film(4, 0.3)], [6]);
    expect(one.get(6)).toEqual({ kind: 'liked', items: [0] });
  });

  it('ratings but none liked: no explanation, no fallback', () => {
    const low = HISTORY.map((h) => ({ ...h, percentile: 0.2 }));
    expect(explain(V, 2, low, [6, 7]).size).toBe(0);
    expect(explanationPool(low)).toEqual({ kind: 'liked', items: [] });
  });

  it('no rating at all (watched.csv alone): every seen film, « vu »', () => {
    const unrated = HISTORY.map((h) => ({ ...h, rating: undefined, percentile: 0.5 }));
    expect(explanationPool(unrated).kind).toBe('seen');
    expect(explain(V, 2, unrated, [6]).get(6)).toEqual({ kind: 'seen', items: [5, 3] });
  });

  it('a target is never explained by itself; duplicates computed once; empty history', () => {
    const out = explain(V, 2, [...HISTORY, film(6, 1)], [6, 6]);
    expect(out.get(6)!.items).not.toContain(6);
    expect(explain(V, 2, [], [6]).size).toBe(0);
  });
});
