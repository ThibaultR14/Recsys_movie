/**
 * The three categories of the results screen (docs/etape-8b-ux-resultats.md, D1): one popularity
 * cap of the engine each (the cap stays cumulative). The only place where these caps are written;
 * a category whose cap is missing from model-meta.json is hidden.
 */
export interface Category {
  /** Name shown on the button and spoken by the live region. */
  label: string;
  /** Under the name: « tout », « moins de 2 000 notes ». */
  sub: string;
  /** Popularity cap of the engine (null = ∞). */
  cap: number | null;
  /** Part of the CSV file name (D6): pepite-<file>-AAAA-MM-JJ.csv */
  file: string;
}

export const CATEGORIES: readonly Category[] = [
  { label: 'les valeurs sûres', sub: 'tout', cap: null, file: 'valeurs-sures' },
  { label: 'les moins connus', sub: 'moins de 2 000 notes', cap: 2000, file: 'moins-connus' },
  { label: 'les pépites', sub: 'moins de 500 notes', cap: 500, file: 'pepites' },
];

/** Starting category: « les moins connus ». */
export const START_CATEGORY_CAP = 2000;

/** The categories whose cap is a position of the engine, with that position's index. */
export function availableCategories(
  caps: readonly (number | null)[],
): (Category & { index: number })[] {
  return CATEGORIES.flatMap((c) => {
    const index = caps.indexOf(c.cap);
    return index < 0 ? [] : [{ ...c, index }];
  });
}

/** The category shown at a position index, if any. */
export function categoryAt(
  caps: readonly (number | null)[],
  index: number,
): (Category & { index: number }) | undefined {
  return availableCategories(caps).find((c) => c.index === index);
}
