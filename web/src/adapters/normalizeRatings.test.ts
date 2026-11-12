import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dedupeLatest, percentiles } from './normalizeRatings';

describe('percentiles', () => {
  it('by hand: average rank on ties, (rank - 1) / (n - 1)', () => {
    // ratings 1, 3, 3, 5 -> ranks 1, 2.5, 2.5, 4 -> p = 0, 0.5, 0.5, 1
    expect(percentiles([3, 1, 5, 3])).toEqual([0.5, 0, 1, 0.5]);
    expect(percentiles([2, 4, 3])).toEqual([0, 1, 0.5]);
  });
  it('0.5 for a single rating, all ties, and unrated films', () => {
    expect(percentiles([4])).toEqual([0.5]);
    expect(percentiles([3, 3, 3])).toEqual([0.5, 0.5, 0.5]);
    expect(percentiles([undefined, 1, undefined, 5])).toEqual([0.5, 0, 0.5, 1]);
    expect(percentiles([])).toEqual([]);
  });
  it('rounds to float32 like the training signal', () => {
    expect(percentiles([1, 2, 3, 4])[1]).toBe(Math.fround(1 / 3));
  });
});

describe('dedupeLatest', () => {
  it('keeps the most recent entry per key', () => {
    const items = [
      { k: 1, date: '2024-01-01', r: 2 },
      { k: 1, date: '2024-05-01', r: 4 },
      { k: 2, r: 3 },
      { k: 2, date: '2020-01-01', r: 1 },
    ];
    expect(dedupeLatest(items, (x) => x.k).map((x) => x.r)).toEqual([4, 1]);
  });
});

// Fold-in reference cases written by pipeline/export.py (not versioned).
const FIXTURE = fileURLToPath(new URL('../../test-data/foldin_cases.json', import.meta.url));

describe.skipIf(!existsSync(FIXTURE))('percentiles vs Python fold-in cases', () => {
  it('reproduces the Python percentiles exactly', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as {
      cases: { name: string; rating: number[]; percentile: number[] }[];
    };
    expect(fixture.cases.length).toBe(27); // 22 + 3 cases of step 6c + 2 of step 8
    for (const c of fixture.cases) {
      expect(percentiles(c.rating), c.name).toEqual(c.percentile);
    }
  });
});
