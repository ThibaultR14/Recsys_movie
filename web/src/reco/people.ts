/**
 * « des films de… » (docs/etape-8b-ux-resultats.md, D4): the people of catalog.json v4 (directors
 * and kept actors, one entry per TMDB person) and the suggestions of the search field. Matching:
 * no accents, no case, start of a word (« kuro » -> Akira Kurosawa); never fuzzy.
 */
import type { CatalogFile } from './engine';

export interface PeopleIndex {
  names: string[];
  /** Words of each name, normalised. */
  words: string[][];
  /** Catalogue films of each person (directed or acted), item order. */
  films: number[][];
  directs: Uint8Array;
  acts: Uint8Array;
  /** First and last year of the person's films (null when none is dated). */
  years: ([number, number] | null)[];
  /** Number of people sharing each display name (namesakes: their suggestion shows the years). */
  sameName: number[];
}

export function normalizeName(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function buildPeopleIndex(
  c: Pick<CatalogFile, 'n' | 'year' | 'people' | 'director_ids' | 'cast'>,
): PeopleIndex {
  const names = c.people ?? [];
  const n = names.length;
  const films: number[][] = Array.from({ length: n }, () => []);
  const directs = new Uint8Array(n);
  const acts = new Uint8Array(n);
  for (let i = 0; i < c.n; i++) {
    const seen = new Set<number>();
    for (const p of c.director_ids?.[i] ?? []) {
      directs[p] = 1;
      seen.add(p);
    }
    for (const p of c.cast?.[i] ?? []) {
      acts[p] = 1;
      seen.add(p);
    }
    for (const p of seen) films[p]!.push(i);
  }
  const years = films.map((fs) => {
    const ys = fs.map((i) => c.year[i]).filter((y): y is number => y != null);
    return ys.length ? ([Math.min(...ys), Math.max(...ys)] as [number, number]) : null;
  });
  const count = new Map<string, number>();
  for (const nm of names) count.set(nm, (count.get(nm) ?? 0) + 1);
  return {
    names,
    words: names.map(normalizeName),
    films,
    directs,
    acts,
    years,
    sameName: names.map((nm) => count.get(nm)!),
  };
}

export interface PersonSuggestion {
  person: number;
  name: string;
  directs: boolean;
  acts: boolean;
  films: number;
  /** « 1950-1965 », only for namesakes (D4). */
  years?: string;
}

export const MAX_SUGGESTIONS = 8;
export const MIN_QUERY = 2;

/** Every word of the query starts a word of the name; most films first, then the name. */
export function searchPeople(
  index: PeopleIndex,
  query: string,
  limit = MAX_SUGGESTIONS,
): PersonSuggestion[] {
  const q = normalizeName(query);
  if (q.join('').length < MIN_QUERY) return [];
  const hits: number[] = [];
  index.words.forEach((w, p) => {
    if (index.films[p]!.length && q.every((t) => w.some((x) => x.startsWith(t)))) hits.push(p);
  });
  hits.sort(
    (a, b) =>
      index.films[b]!.length - index.films[a]!.length ||
      index.names[a]!.localeCompare(index.names[b]!, 'fr') ||
      a - b,
  );
  return hits.slice(0, limit).map((p) => {
    const y = index.years[p];
    return {
      person: p,
      name: index.names[p]!,
      directs: index.directs[p] === 1,
      acts: index.acts[p] === 1,
      films: index.films[p]!.length,
      ...(index.sameName[p]! > 1 && y
        ? { years: y[0] === y[1] ? `${y[0]}` : `${y[0]}-${y[1]}` }
        : {}),
    };
  });
}
