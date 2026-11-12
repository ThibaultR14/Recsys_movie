// Display rules of a film card (step 5, D6), kept out of the components for tests and reuse.
import { TAG_TEXT } from '../content/cards';

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

// ---- card tags (step 6c, Q6): one tag per card, same place and style as the « ✱ pépite » stamp

/** « vieux trésor »: released before this year… */
export const OLD_BEFORE = 1960;
/** …and seen by at most this many (slider popularity). */
export const OLD_MAX_POPULARITY = 1000;
/** At most this many tags per block of 8 cards (hierarchy first, then list order). */
export const MAX_TAGS_PER_BLOCK = 2;
/** Longer « encore un … » labels are cut with « … » (the full text stays for screen readers). */
export const TAG_MAX_CHARS = 26;

export type CardTag =
  | { kind: 'pepite' }
  | { kind: 'realisateur'; director: string }
  | { kind: 'divise' }
  | { kind: 'vieux' };

/** Hierarchy: ✱ pépite > réalisateur > ça divise > vieux trésor. */
const TAG_ORDER: CardTag['kind'][] = ['pepite', 'realisateur', 'divise', 'vieux'];

export interface TaggedFilm {
  popularity: number;
  year: number | null;
  directors: readonly string[];
  divisive?: boolean;
}

/**
 * The tag of each card of the grid (null = none): the best candidate by the hierarchy, then at
 * most MAX_TAGS_PER_BLOCK per block of 8, kept by the hierarchy then the list order. The stamp
 * (at most one per block) is therefore never dropped. Director: the film's first director among
 * those of the profile phrase (`profileDirectors`).
 */
export function cardTags(
  films: readonly TaggedFilm[],
  profileDirectors: readonly string[],
): (CardTag | null)[] {
  const stamps = pepiteStamps(films.map((f) => f.popularity));
  const liked = new Set(profileDirectors);
  const best = films.map((f, i): CardTag | null => {
    if (stamps.has(i)) return { kind: 'pepite' };
    const director = f.directors.find((d) => liked.has(d));
    if (director !== undefined) return { kind: 'realisateur', director };
    if (f.divisive) return { kind: 'divise' };
    if (f.year !== null && f.year < OLD_BEFORE && f.popularity <= OLD_MAX_POPULARITY)
      return { kind: 'vieux' };
    return null;
  });
  const out = best.slice();
  for (let start = 0; start < out.length; start += STAMP_BLOCK) {
    const tagged: number[] = [];
    for (let i = start; i < Math.min(start + STAMP_BLOCK, out.length); i++)
      if (out[i]) tagged.push(i);
    tagged.sort(
      (a, b) => TAG_ORDER.indexOf(out[a]!.kind) - TAG_ORDER.indexOf(out[b]!.kind) || a - b,
    );
    for (const i of tagged.slice(MAX_TAGS_PER_BLOCK)) out[i] = null;
  }
  return out;
}

/** Visible label (cut at TAG_MAX_CHARS with « … ») and full label (screen readers). */
export function tagLabel(tag: CardTag): { visible: string; full: string } {
  const full = tag.kind === 'realisateur' ? TAG_TEXT.realisateur(tag.director) : TAG_TEXT[tag.kind];
  const chars = [...full];
  const visible =
    chars.length > TAG_MAX_CHARS
      ? `${chars
          .slice(0, TAG_MAX_CHARS - 1)
          .join('')
          .trimEnd()}…`
      : full;
  return { visible, full };
}

/**
 * « loin de tes goûts » by rows (step 6b, Q4 revised): true when, in at least one block of 8
 * displayed cards, at least half of the cards have a relative score below `threshold`.
 */
export function hasFarRow(relativeScores: readonly number[], threshold: number): boolean {
  for (let start = 0; start < relativeScores.length; start += STAMP_BLOCK) {
    const row = relativeScores.slice(start, start + STAMP_BLOCK);
    const far = row.filter((r) => r < threshold).length;
    if (far * 2 >= row.length) return true;
  }
  return false;
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

/** « ★ 3,4 · TMDB » (step 8): TMDB rating of an estimated film, out of 5, one decimal. */
export function tmdbRatingLine(mean10: number): { visible: string; spoken: string } {
  const mean = `${Math.floor(mean10 / 10)},${mean10 % 10}`;
  return { visible: `${mean} · TMDB`, spoken: `note TMDB ${mean} sur 5` };
}

/** « réalisateur, année »: up to two directors joined with « et ». */
export function byline(directors: readonly string[], year: number | null): string {
  const who = directors.slice(0, 2).join(' et ');
  return [who, year === null ? '' : String(year)].filter((x) => x !== '').join(', ');
}
