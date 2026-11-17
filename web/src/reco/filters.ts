/**
 * Filters of « affiner » (docs/etape-8b-ux-resultats.md, D2-D3): a pure predicate on item_idx.
 * Within a section the choices add up (OR); from one section to the next they combine (AND).
 * A film with no year / runtime / language passes no filter of that section.
 */
import type { CatalogFile } from './engine';

export interface Filters {
  /** MovieLens genre names (catalog `genre_names`), never « Documentary » nor « IMAX ». */
  genres: string[];
  /** Keys of DECADES. */
  decades: string[];
  /** Keys of DURATIONS. */
  durations: string[];
  /** ISO 639-1 codes as TMDB gives them (catalog `languages`). */
  languages: string[];
  /** « on montre aussi : les documentaires », ticked by default. */
  docs: boolean;
}

export const NO_FILTERS: Filters = {
  genres: [],
  decades: [],
  durations: [],
  languages: [],
  docs: true,
};

export const DOCUMENTARY = 'Documentary';
/** A projection format, not a genre (Q3): kept in the data and the calibration, not filterable. */
export const NOT_FILTERABLE = [DOCUMENTARY, 'IMAX'];
/** A language is offered when it has at least this many recommendable films (D3). */
export const MIN_LANGUAGE_FILMS = 30;

/** What « affiner » can offer for this catalogue (computed once, by the worker). */
export interface RefineOptions {
  /** MovieLens genre names, without NOT_FILTERABLE. */
  genres: string[];
  /** Languages with >= MIN_LANGUAGE_FILMS recommendable films, most films first. */
  languages: { code: string; films: number }[];
}

export function refineOptions(
  c: Pick<CatalogFile, 'genre_names'> & Partial<Pick<CatalogFile, 'language' | 'languages'>>,
  recommendable: Uint8Array,
): RefineOptions {
  const counts = new Map<number, number>();
  c.language?.forEach((l, i) => {
    if (l != null && recommendable[i]) counts.set(l, (counts.get(l) ?? 0) + 1);
  });
  const languages = [...counts]
    .filter(([l, k]) => k >= MIN_LANGUAGE_FILMS && c.languages?.[l] && c.languages[l] !== 'xx')
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([l, k]) => ({ code: c.languages![l]!, films: k }));
  return { genres: c.genre_names.filter((g) => !NOT_FILTERABLE.includes(g)), languages };
}

/** « époque »: the year of catalog.json; « années 2020 » = 2020 and after. */
export const DECADES: readonly { key: string; label: string; from: number; to: number }[] = [
  { key: 'avant-1960', label: 'avant 1960', from: -Infinity, to: 1959 },
  { key: '1960', label: 'années 60', from: 1960, to: 1969 },
  { key: '1970', label: 'années 70', from: 1970, to: 1979 },
  { key: '1980', label: 'années 80', from: 1980, to: 1989 },
  { key: '1990', label: 'années 90', from: 1990, to: 1999 },
  { key: '2000', label: 'années 2000', from: 2000, to: 2009 },
  { key: '2010', label: 'années 2010', from: 2010, to: 2019 },
  { key: '2020', label: 'années 2020', from: 2020, to: Infinity },
];

/** « durée », in minutes (TMDB runtime). */
export const DURATIONS: readonly { key: string; label: string; min: number; max: number }[] = [
  { key: 'court', label: "moins d'1h40", min: 1, max: 99 },
  { key: 'moyen', label: '1h40 à 2h15', min: 100, max: 135 },
  { key: 'long', label: 'plus de 2h15', min: 136, max: Infinity },
];

/** Number of active filters (« affiner (2) »); the documentaries count when they are hidden. */
export function activeCount(f: Filters): number {
  return (
    f.genres.length + f.decades.length + f.durations.length + f.languages.length + (f.docs ? 0 : 1)
  );
}

export function sameFilters(a: Filters, b: Filters): boolean {
  const eq = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && [...x].sort().join('\0') === [...y].sort().join('\0');
  return (
    a.docs === b.docs &&
    eq(a.genres, b.genres) &&
    eq(a.decades, b.decades) &&
    eq(a.durations, b.durations) &&
    eq(a.languages, b.languages)
  );
}

export interface CompiledFilter {
  passes: (item: number) => boolean;
  /** Genre indices chosen (the calibration target follows them, D2); empty = whole history. */
  genres: number[];
}

type FilterCatalog = Pick<CatalogFile, 'genres' | 'genre_names' | 'year'> &
  Partial<Pick<CatalogFile, 'runtime' | 'language' | 'languages'>>;

/** The predicate of `f`, or undefined when no filter is active (the unfiltered lists). */
export function compileFilters(f: Filters, c: FilterCatalog): CompiledFilter | undefined {
  if (activeCount(f) === 0) return undefined;
  const genres = f.genres.map((g) => c.genre_names.indexOf(g)).filter((g) => g >= 0);
  const doc = c.genre_names.indexOf(DOCUMENTARY);
  const decades = DECADES.filter((d) => f.decades.includes(d.key));
  const durations = DURATIONS.filter((d) => f.durations.includes(d.key));
  const langIdx = new Set(
    f.languages.map((l) => c.languages?.indexOf(l) ?? -1).filter((k) => k >= 0),
  );
  const passes = (i: number): boolean => {
    const gs = c.genres[i] ?? [];
    if (f.genres.length && !genres.some((g) => gs.includes(g))) return false;
    if (!f.docs && gs.includes(doc)) return false;
    if (decades.length) {
      const y = c.year[i];
      if (y == null || !decades.some((d) => y >= d.from && y <= d.to)) return false;
    }
    if (durations.length) {
      const r = c.runtime?.[i];
      if (r == null || !durations.some((d) => r >= d.min && r <= d.max)) return false;
    }
    if (f.languages.length) {
      const l = c.language?.[i];
      if (l == null || !langIdx.has(l)) return false;
    }
    return true;
  };
  return { passes, genres };
}
