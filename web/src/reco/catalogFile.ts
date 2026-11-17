/**
 * catalog.json as the site reads it (step 8b, D5). Since v4 the file no longer holds `directors`
 * (each director's name would be written twice): it is rebuilt here from `people` + `director_ids`,
 * so that every reader of `catalog.directors` (profile, « encore un… » tag, cards) is unchanged.
 */
import type { CatalogFile } from './engine';

export const CATALOG_VERSION = 4;

/** v4 on disk: `people` / `director_ids` / `cast` instead of `directors`. */
export type CatalogFileV4 = Omit<CatalogFile, 'directors'> & {
  people: string[];
  director_ids: number[][];
  cast: number[][];
};

export function rebuildDirectors(
  people: readonly string[],
  directorIds: readonly (readonly number[])[],
): string[][] {
  return directorIds.map((row) => row.map((k) => people[k] ?? ''));
}

/** The parsed file -> CatalogFile; an older file is refused (data to regenerate). */
export function parseCatalog(raw: unknown): CatalogFile {
  const c = raw as Partial<CatalogFileV4> & { v?: number };
  if (c.v !== CATALOG_VERSION || !c.people || !c.director_ids) {
    throw new Error(
      `catalog.json v${c.v ?? '?'} : il faut la v${CATALOG_VERSION} (relancer export.py catalog)`,
    );
  }
  return { ...(c as CatalogFileV4), directors: rebuildDirectors(c.people, c.director_ids) };
}
