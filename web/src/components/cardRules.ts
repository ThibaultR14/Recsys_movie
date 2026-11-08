// Display rules of a film card (step 5, D6), kept out of the components for tests and reuse.

/** The « ✱ pépite » stamp is decided per block of 8 cards (one « encore des films » page). */
export const STAMP_BLOCK = 8;
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const MAX_TILT = 1.8;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Indexes of the stamped cards, relative to the grid: at most one per block of 8 consecutive cards,
 * on the least known film of the block (lowest popularity; first in list order on a tie), and only if
 * its popularity is at most half the block median. A shorter last block follows the same rule.
 */
export function pepiteStamps(popularities: readonly number[]): Set<number> {
  const out = new Set<number>();
  for (let start = 0; start < popularities.length; start += STAMP_BLOCK) {
    const block = popularities.slice(start, start + STAMP_BLOCK);
    let low = 0;
    for (let i = 1; i < block.length; i++) if (block[i]! < block[low]!) low = i;
    if (block[low]! * 2 <= median(block)) out.add(start + low);
  }
  return out;
}

/** At most this many cards of a block of 8 cite the same history film (step 6b, R6, option A). */
export const MAX_CITATIONS_PER_BLOCK = 2;
const CITED_PER_CARD = 2;

/**
 * Diversity of « (parce que t'as aimé X et Y) » (step 6b, R6, option A): blocks of 8 cards in the
 * displayed order (like the pépite stamps). Each card takes its closest candidates (cosine > 0,
 * closest first, computed by the worker) that are not already cited on 2 cards of the block; 2 at
 * most, 1 or none if the candidates run out. Returns, per card, the indices of the kept candidates.
 */
export function citationPicks(candidates: readonly (readonly number[] | undefined)[]): number[][] {
  const out: number[][] = [];
  let uses = new Map<number, number>();
  candidates.forEach((cands, i) => {
    if (i % STAMP_BLOCK === 0) uses = new Map();
    const picked: number[] = [];
    for (let k = 0; k < (cands?.length ?? 0) && picked.length < CITED_PER_CARD; k++) {
      const item = cands![k]!;
      if ((uses.get(item) ?? 0) >= MAX_CITATIONS_PER_BLOCK) continue;
      picked.push(k);
      uses.set(item, (uses.get(item) ?? 0) + 1);
    }
    out.push(picked);
  });
  return out;
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

const FR_NUMBER = new Intl.NumberFormat('fr-FR');

/** « ★ 3,9 · 1 240 notes » (step 6b, D5): MovieLens mean out of 5, one decimal, and the count. */
export function ratingLine(mean10: number, count: number): { visible: string; spoken: string } {
  const mean = `${Math.floor(mean10 / 10)},${mean10 % 10}`;
  const n = FR_NUMBER.format(count);
  return {
    visible: `${mean} · ${n} notes`,
    spoken: `note moyenne ${mean} sur 5, ${n} notes`,
  };
}

/** « réalisateur, année »: up to two directors joined with « et ». */
export function byline(directors: readonly string[], year: number | null): string {
  const who = directors.slice(0, 2).join(' et ');
  return [who, year === null ? '' : String(year)].filter((x) => x !== '').join(', ');
}
