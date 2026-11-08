/**
 * Annotations of the results screen (step 5, D5 and D6), computed in the worker from the catalogue
 * and the fold-in history. Pure; no effect on the scores.
 */
import type { UserFilm } from '../matching/history';
import { normalizeTitle } from '../matching/normalize';
import type { CatalogFile } from './engine';

/** History films rated above the user's median count for the profile (percentile > 0.5). */
export const PROFILE_MIN_PERCENTILE = 0.5;
export const PROFILE_SIZE = 3;
/** A director needs this many liked films to be named (« t'aimes bien X » from one film is weak). */
export const PROFILE_MIN_FILMS = 2;

/**
 * The (at most) 3 directors most frequent among the liked history films; ties broken by the sum
 * of percentiles, then by name. Fewer than 2 -> [] (the annotation is hidden).
 */
export function profileDirectors(
  history: readonly UserFilm[],
  catalog: Pick<CatalogFile, 'directors'>,
): string[] {
  const stats = new Map<string, { n: number; sum: number }>();
  for (const h of history) {
    if (h.rating === undefined || h.percentile <= PROFILE_MIN_PERCENTILE) continue;
    for (const d of new Set(catalog.directors[h.item] ?? [])) {
      const s = stats.get(d) ?? { n: 0, sum: 0 };
      s.n += 1;
      s.sum += h.percentile;
      stats.set(d, s);
    }
  }
  const top = [...stats.entries()]
    .filter(([, s]) => s.n >= PROFILE_MIN_FILMS)
    .sort(([a, x], [b, y]) => y.n - x.n || y.sum - x.sum || a.localeCompare(b))
    .slice(0, PROFILE_SIZE)
    .map(([d]) => d);
  return top.length >= 2 ? top : [];
}

/** Main title key: the part before « : » or « - » (« Kill Bill: Vol. 2 » -> « kill bill »). */
export function mainTitleKey(title: string): string {
  return normalizeTitle(title.split(/\s*:\s+|\s+[-–—]\s+/)[0] ?? title);
}

/**
 * For each recommended item, the title of a history film of the same series: same main title and
 * at least one director in common (D6). Sequels are not hidden, only annotated.
 */
export function seriesOf(
  items: readonly number[],
  history: readonly UserFilm[],
  catalog: Pick<CatalogFile, 'title' | 'directors'>,
): Map<number, string> {
  const byKey = new Map<string, number[]>();
  for (const h of history) {
    const key = mainTitleKey(catalog.title[h.item] ?? '');
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(h.item);
    byKey.set(key, list);
  }
  const out = new Map<number, string>();
  for (const item of items) {
    const seen = byKey.get(mainTitleKey(catalog.title[item] ?? ''));
    if (!seen) continue;
    const dirs = new Set(catalog.directors[item] ?? []);
    const match = seen.find(
      (s) => s !== item && (catalog.directors[s] ?? []).some((d) => dirs.has(d)),
    );
    if (match !== undefined) out.set(item, catalog.title[match] ?? '');
  }
  return out;
}
