// Display rules of a film card (step 5, D6), kept out of the components for tests and reuse.

/** Popularity at or below which a film gets the « ✱ pépite » stamp. */
export const PEPITE_MAX_POPULARITY = 1000;
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const MAX_TILT = 1.8;

/** Stamp only when it still distinguishes something: popularity <= 1 000 and the slider cap above
 * 1 000 (∞ = null counts as above). At caps 1 000, 500 and 200 every card would be stamped. */
export function showPepiteStamp(popularity: number, cap: number | null): boolean {
  return popularity <= PEPITE_MAX_POPULARITY && (cap === null || cap > PEPITE_MAX_POPULARITY);
}

/** Deterministic hash of an integer to [0, 1) (multiplicative hash + xorshift). */
function unit(n: number, salt: number): number {
  let h = Math.imul(n ^ salt, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Card tilt in degrees, in [-1.8, 1.8], one decimal, derived from item_idx only. */
export function cardRotation(item: number): number {
  return Math.round((unit(item, 0x51ed) * 2 - 1) * MAX_TILT * 10) / 10;
}

/** Tape tilt in degrees, in [-4, 4]. */
export function tapeRotation(item: number): number {
  return Math.round((unit(item, 0x7a9e) * 2 - 1) * 40) / 10;
}

export function letterboxdUrl(tmdbId: number): string {
  return `https://letterboxd.com/tmdb/${tmdbId}/`;
}

export function isDocumentary(genres: readonly string[]): boolean {
  return genres.includes('Documentary');
}

/** « réalisateur, année »: up to two directors joined with « et ». */
export function byline(directors: readonly string[], year: number | null): string {
  const who = directors.slice(0, 2).join(' et ');
  return [who, year === null ? '' : String(year)].filter((x) => x !== '').join(', ');
}
