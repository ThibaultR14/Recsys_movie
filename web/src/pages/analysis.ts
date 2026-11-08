// Grouping of the import result for the analysis screen (step 5, D4).
import type { Unrecognized } from '../reco/workerCore';

/** Films released after the catalogue (MovieLens 32M stops in 2023). */
export const FIRST_TOO_RECENT_YEAR = 2024;

export interface AnalysisGroups {
  /** ambiguous and probable_fuzzy entries: the user picks a candidate, or none. */
  toVerify: Unrecognized[];
  /** not_found released in 2024 or later. */
  tooRecent: Unrecognized[];
  /** IMDb series, episodes, games… not found by id (step 6, D4). */
  nonFilm: Unrecognized[];
  /** other not_found (series, films with too few ratings, unknown titles). */
  notInCatalog: Unrecognized[];
}

export function groupUnrecognized(unrecognized: readonly Unrecognized[]): AnalysisGroups {
  const toVerify: Unrecognized[] = [];
  const tooRecent: Unrecognized[] = [];
  const nonFilm: Unrecognized[] = [];
  const notInCatalog: Unrecognized[] = [];
  for (const u of unrecognized) {
    if (u.reason === 'non_film') nonFilm.push(u);
    else if (u.status === 'ambiguous' || u.status === 'probable_fuzzy') {
      if (u.candidates.length > 0) toVerify.push(u);
      else notInCatalog.push(u);
    } else if (u.year !== null && u.year >= FIRST_TOO_RECENT_YEAR) tooRecent.push(u);
    else notInCatalog.push(u);
  }
  return { toVerify, tooRecent, nonFilm, notInCatalog };
}

/** « 1 film » / « 3 films ». */
export function films(n: number): string {
  return `${n} film${n > 1 ? 's' : ''}`;
}

export function tooRecentSentence(n: number): string {
  return n > 1
    ? `${n} films sont sortis après 2023 : trop récents pour nous, désolé.`
    : '1 film est sorti après 2023 : trop récent pour nous, désolé.';
}

export function nonFilmSentence(n: number): string {
  return n > 1
    ? `${n} séries, épisodes ou jeux : on fait que les films.`
    : '1 série, épisode ou jeu : on fait que les films.';
}

export function notInCatalogSentence(n: number): string {
  return `${films(n)} qu'on connaît pas (séries, films très peu vus…)`;
}
