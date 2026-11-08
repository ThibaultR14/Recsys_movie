// Same cases as pipeline/tests/test_calibration.py (step 6c, D1).
import { describe, expect, it } from 'vitest';
import { calibrate, genreProfile, genreRows } from './calibrate';

// 3 genres; items 0-3 genre 0 (best scores), items 4-5 genre 1, item 6 without genre
const GENRES = [[0], [0], [0], [0], [1], [1], []];
const ROWS = genreRows(GENRES);
const POOL = [0, 1, 2, 3, 4, 5, 6];
const SCORES = [1.0, 0.99, 0.98, 0.97, 0.9, 0.89, 0.95];
const p = (...xs: number[]) => Float64Array.from(xs);

describe('calibrate (Steck, mass)', () => {
  it('λ = 0 keeps the model order', () => {
    expect(calibrate(POOL, SCORES, p(0.5, 0.5, 0), ROWS, 0, 7)).toEqual([0, 1, 2, 3, 6, 4, 5]);
  });

  it('a strong λ follows the profile; then a film without genre keeps it matched', () => {
    expect(
      calibrate(POOL.slice(0, 6), SCORES.slice(0, 6), p(0.5, 0.5, 0), ROWS, 0.99, 4).sort(),
    ).toEqual([0, 1, 4, 5]);
    expect(calibrate(POOL, SCORES, p(0.5, 0.5, 0), ROWS, 0.99, 3)).toEqual([0, 4, 6]);
  });

  it('films without genre count in neither distribution', () => {
    expect([...genreProfile(ROWS, 3, [0, 6], [1, 1])]).toEqual([1, 0, 0]);
    expect(calibrate(POOL, SCORES, p(1, 0, 0), ROWS, 0.99, 5)).not.toContain(4);
  });

  it('a pool shorter than the list', () => {
    expect(calibrate([0, 4], [1, 0.5], p(0.5, 0.5, 0), ROWS, 0.5, 3)).toEqual([0, 4]);
  });
});

describe('calibrate (share of films)', () => {
  it('targets the share of films of each genre', () => {
    // films 0-3: Animation + 3 other genres; 4-7: Drama only; profile: 25 % animation films
    const genres = [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [4], [4], [4], [4]];
    const rows = genreRows(genres, 'share');
    const prof = genreProfile(rows, 5, [0, 4, 5, 6], [1, 1, 1, 1], 'share');
    expect(prof[0]).toBe(0.25);
    expect(prof[4]).toBe(0.75);
    const out = calibrate(
      [0, 1, 2, 3, 4, 5, 6, 7],
      [1.0, 0.99, 0.98, 0.97, 0.8, 0.79, 0.78, 0.77],
      prof,
      rows,
      0.99,
      4,
      'share',
    );
    expect(out.filter((i) => i < 4)).toHaveLength(1);
  });
});
