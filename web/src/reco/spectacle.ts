/**
 * Stand-up special heuristic (step 5, D6), to be judged by Thibault in G6 before any « spectacle »
 * mention is shown: title « Firstname Lastname: … » (two or three capitalised words, then « : »)
 * and the single MovieLens genre « Comedy ». Not used by the interface yet.
 */
const STAND_UP_TITLE = /^\p{Lu}[\p{L}'’.-]*(?: \p{Lu}[\p{L}'’.-]*){1,2}: \S/u;

export function isStandUpTitle(title: string): boolean {
  return STAND_UP_TITLE.test(title);
}

export function looksLikeStandUp(title: string, genres: readonly string[]): boolean {
  return isStandUpTitle(title) && genres.length === 1 && genres[0] === 'Comedy';
}
