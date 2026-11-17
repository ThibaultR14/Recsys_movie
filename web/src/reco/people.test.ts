// Step 8b (D4): the people index and the suggestions of « des films de… ».
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PEOPLE } from '../content/people';
import { importExport, loadEngine, personFilms, userProfile } from './engine';
import { compileFilters, NO_FILTERS } from './filters';
import { buildPeopleIndex, normalizeName, searchPeople } from './people';

// synthetic catalogue: two namesakes, a director who also acts, an actor only
const catalog = {
  n: 5,
  year: [1950, 1965, 2001, 2010, null],
  people: ['Akira Kurosawa', 'Jean Dupont', 'Jean Dupont', 'Élodie Bouchez'],
  director_ids: [[0], [0], [1], [2], []],
  cast: [[3], [], [0, 3], [3], [3]],
};
const index = buildPeopleIndex(catalog);

describe('people index and suggestions', () => {
  it('films, roles and years per person', () => {
    expect(index.films).toEqual([[0, 1, 2], [2], [3], [0, 2, 3, 4]]);
    expect([...index.directs]).toEqual([1, 1, 1, 0]);
    expect([...index.acts]).toEqual([1, 0, 0, 1]);
    expect(index.years[0]).toEqual([1950, 2001]);
  });

  it('no accents, no case, start of a word; every word of the query', () => {
    expect(normalizeName('Élodie  Bouchez')).toEqual(['elodie', 'bouchez']);
    expect(searchPeople(index, 'kuro').map((s) => s.name)).toEqual(['Akira Kurosawa']);
    expect(searchPeople(index, 'ELO').map((s) => s.name)).toEqual(['Élodie Bouchez']);
    expect(searchPeople(index, 'rosawa')).toEqual([]); // not the middle of a word
    expect(searchPeople(index, 'a kur').map((s) => s.name)).toEqual(['Akira Kurosawa']);
    expect(searchPeople(index, 'k')).toEqual([]); // 2 letters at least
  });

  it('most films first; namesakes get the years of their films', () => {
    const jean = searchPeople(index, 'jean');
    expect(jean.map((s) => [s.person, s.years])).toEqual([
      [1, '2001'],
      [2, '2010'],
    ]);
    expect(searchPeople(index, 'akira')[0]).toEqual({
      person: 0,
      name: 'Akira Kurosawa',
      directs: true,
      acts: true,
      films: 3,
    });
    expect(PEOPLE.detail(searchPeople(index, 'akira')[0]!)).toBe('réalise et joue · 3 films');
    expect(PEOPLE.detail(jean[0]!)).toBe('réalise · 2001 · 1 film');
    expect(PEOPLE.detail(searchPeople(index, 'bouchez')[0]!)).toBe('joue · 4 films');
  });

  it('at most 8 suggestions', () => {
    const many = buildPeopleIndex({
      n: 10,
      year: Array(10).fill(2000),
      people: Array.from({ length: 10 }, (_, k) => `Anna ${k}`),
      director_ids: Array.from({ length: 10 }, (_, k) => [k]),
      cast: Array(10).fill([]),
    });
    expect(searchPeople(many, 'anna')).toHaveLength(8);
  });
});

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../public/exemple/letterboxd-exemple.zip', import.meta.url),
);
const FILES = ['embeddings.bin', 'yty.bin', 'popularity.bin', 'model-meta.json', 'catalog.json'];
const ready = existsSync(EXAMPLE) && FILES.every((f) => existsSync(DATA + f));

describe.skipIf(!ready)('« des films de… » on the real files', () => {
  it("a director: not seen, at most 48, sorted by score'; filters apply", async () => {
    const engine = await loadEngine(
      async (url) => new Response(readFileSync(DATA + url.replace('/data/', ''))),
    );
    const { matched } = importExport(engine, {
      kind: 'zip',
      bytes: new Uint8Array(readFileSync(EXAMPLE)),
    });
    const user = userProfile(engine, matched);
    const people = buildPeopleIndex(engine.catalog);
    const [kubrick] = searchPeople(people, 'kubrick');
    expect(kubrick!.name).toBe('Stanley Kubrick');
    expect(kubrick!.directs).toBe(true);
    const films = people.films[kubrick!.person]!;
    const r = personFilms(engine, user, films);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.length).toBeLessThanOrEqual(48);
    const seen = new Set(user.history.map((h) => h.item));
    for (const i of r.items) {
      expect(seen.has(i)).toBe(false);
      expect(engine.catalog.directors[i]).toContain('Stanley Kubrick');
    }
    // a filter: only the 1960s
    const sixties = personFilms(engine, user, films, {
      filter: compileFilters({ ...NO_FILTERS, decades: ['1960'] }, engine.catalog),
    });
    for (const i of sixties.items) expect(Math.floor(engine.catalog.year[i]! / 10)).toBe(196);
    expect(sixties.items.length).toBeLessThan(r.items.length);
    // actors are searchable too
    expect(searchPeople(people, 'tom hanks')[0]?.acts).toBe(true);
  });
});
