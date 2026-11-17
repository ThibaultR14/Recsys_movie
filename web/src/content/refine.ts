// « affiner » (step 8b, D3): labels of the panel, given by Thibault in the spec.

export const REFINE = {
  button: 'affiner',
  buttonWithCount: (n: number) => `affiner (${n})`,
  genres: 'genres',
  decades: 'époque',
  durations: 'durée',
  languages: 'langue',
  otherLanguages: 'autres langues',
  alsoShow: 'on montre aussi',
  docs: 'les documentaires',
  docsHidden: 'sans les documentaires',
  clearAll: 'tout effacer',
  remove: (label: string) => `retirer le filtre ${label}`,
};

/** MovieLens genres -> French, lower case; « Documentary » and « IMAX » are not in the filter. */
export const GENRE_LABELS: Record<string, string> = {
  Action: 'action',
  Adventure: 'aventure',
  Animation: 'animation',
  Children: 'jeunesse',
  Comedy: 'comédie',
  Crime: 'policier',
  Drama: 'drame',
  Fantasy: 'fantastique',
  'Film-Noir': 'film noir',
  Horror: 'horreur',
  Musical: 'comédie musicale',
  Mystery: 'mystère',
  Romance: 'romance',
  'Sci-Fi': 'science-fiction',
  Thriller: 'thriller',
  War: 'guerre',
  Western: 'western',
};

/** TMDB codes that Intl.DisplayNames('fr') does not name (measured in U0: `cn` only). */
const LANGUAGE_FALLBACK: Record<string, string> = { cn: 'cantonais' };

let names: Intl.DisplayNames | undefined;

/** « anglais », « japonais »…: Intl.DisplayNames('fr'), lower case; null when unknown. */
export function languageName(code: string): string | null {
  if (LANGUAGE_FALLBACK[code]) return LANGUAGE_FALLBACK[code];
  try {
    names ??= new Intl.DisplayNames('fr', { type: 'language', fallback: 'none' });
    return names.of(code)?.toLocaleLowerCase('fr') ?? null;
  } catch {
    return null;
  }
}
