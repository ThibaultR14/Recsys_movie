import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import shared from '../../../shared/fixtures/title_normalization.json';
import { NORMALIZATION_VERSION, normalizeTitle } from './normalize';

describe('normalizeTitle: cases shared with pytest', () => {
  it('uses the same normalisation version as Python', () => {
    expect(shared.norm).toBe(NORMALIZATION_VERSION);
  });
  it.each(shared.cases.map((c) => [c.group, c.input, c.expected] as const))(
    '%s: %j',
    (_group, input, expected) => {
      expect(normalizeTitle(input)).toBe(expected);
    },
  );
  it('handles missing titles', () => {
    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
  });
});

// Every title string of the catalogue, normalised by Python (pipeline/title_fixtures.py
// catalog-keys). Not versioned: skipped when the file is missing.
const EXHAUSTIVE = fileURLToPath(
  new URL('../../test-data/catalog_title_keys.json', import.meta.url),
);

describe.skipIf(!existsSync(EXHAUSTIVE))('normalizeTitle: every catalogue title', () => {
  it('matches Python on 100 % of the strings', () => {
    const data = JSON.parse(readFileSync(EXHAUSTIVE, 'utf-8')) as {
      norm: string;
      cases: [string, string][];
    };
    expect(data.norm).toBe(NORMALIZATION_VERSION);
    const mismatches = data.cases.filter(([input, expected]) => normalizeTitle(input) !== expected);
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(data.cases.length).toBeGreaterThan(30000);
  });
});
