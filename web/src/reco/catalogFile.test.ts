// Step 8b (D5): catalog.json v4 has no `directors`; the site rebuilds it from people + director_ids.
// The rebuilt names must be those of v3, film by film.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_VERSION, parseCatalog, rebuildDirectors } from './catalogFile';

// synthetic fixture: two namesakes (two entries), a director who also acts, a film without one
const V4 = {
  v: 4,
  n: 4,
  title: ['a', 'b', 'c', 'd'],
  people: ['Same Name', 'Same Name', 'Wong Kar-wai', 'Actor Only'],
  director_ids: [[0], [1], [2, 0], []],
  cast: [[3], [3, 2], [], [3]],
};
const V3_DIRECTORS = [['Same Name'], ['Same Name'], ['Wong Kar-wai', 'Same Name'], []];

describe('catalog.json v4', () => {
  it('rebuilds `directors` exactly (synthetic fixture)', () => {
    expect(rebuildDirectors(V4.people, V4.director_ids)).toEqual(V3_DIRECTORS);
    const c = parseCatalog(structuredClone(V4));
    expect(c.directors).toEqual(V3_DIRECTORS);
    expect(c.cast).toEqual(V4.cast);
  });

  it('refuses an older file', () => {
    expect(() => parseCatalog({ v: 3, directors: [['x']] })).toThrow(
      `catalog.json v3 : il faut la v${CATALOG_VERSION} (relancer export.py catalog)`,
    );
    expect(() => parseCatalog({})).toThrow(/il faut la v4/);
  });
});

const DATA = fileURLToPath(new URL('../../public/data/catalog.json', import.meta.url));
const V3 = fileURLToPath(new URL('../../test-data/catalog_v3.json', import.meta.url));

describe.skipIf(!existsSync(DATA) || !existsSync(V3))('real catalogue: v4 against v3', () => {
  it('the rebuilt directors are those of v3, film by film', () => {
    const v3 = JSON.parse(readFileSync(V3, 'utf-8')) as { directors: string[][]; n: number };
    const c = parseCatalog(JSON.parse(readFileSync(DATA, 'utf-8')));
    expect(c.n).toBe(v3.n);
    let differing = 0;
    for (let i = 0; i < c.n; i++) {
      if (JSON.stringify(c.directors[i]) !== JSON.stringify(v3.directors[i])) differing++;
    }
    expect(differing).toBe(0);
  });
});
