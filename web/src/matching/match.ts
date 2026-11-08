/**
 * Title + year matching against the catalogue (docs/etape-3-letterboxd.md, D5). Pure and local:
 * no network access.
 *
 *  1. exact            normalised title in the index, year within ±1 (TMDB or MovieLens year)
 *  2. no year          the key alone, only if it designates a single film
 *  3. probable_variant & <-> and; leading article ignored on both sides; "(YYYY)" removed; main
 *                      title before ":" or " - " (single film only)
 *  4. probable_fuzzy   Fuse.js on the films of year ±1 sharing trigrams with the title
 *  5. not_found
 * Two best candidates tied on (year gap, title source) -> ambiguous.
 */
import Fuse from 'fuse.js';
import { normalizeTitle } from './normalize';
import type { Posting, TitleIndex } from './titleIndex';

/** `confirmed` is never produced by the matcher: the user picked the film among the candidates
 * of an ambiguous or probable_fuzzy entry (step 5, D4). */
export type MatchStatus =
  'exact' | 'probable_variant' | 'probable_fuzzy' | 'ambiguous' | 'not_found' | 'confirmed';

export interface Candidate {
  item: number;
  /** Title source of the match (0 tmdb_title … 3 MovieLens alternate); -1 for fuzzy. */
  source: number;
  /** Smallest gap to the input year; null when the input or the film has no year. */
  yearGap: number | null;
  /** Fuse.js score (0 = identical), fuzzy candidates only. */
  fuzzyScore?: number;
}

export interface MatchResult {
  status: MatchStatus;
  item?: number;
  /** Best candidates (at most 3), for the "films non reconnus" screen (step 5). */
  candidates: Candidate[];
  /** Key (variant or fuzzy) that matched, when not the title itself. */
  via?: string;
  /** How an IMDb entry was matched (docs/etape-6-imdb.md, D2-D3); absent for Letterboxd. */
  matchedBy?: 'imdb_id' | 'imdb_alias' | 'title';
  /** Title fallback (D3): the matcher's own status, before it is sent to review as ambiguous. */
  titleStatus?: MatchStatus;
  /** Not a film (series, episode, game…) and not found by id: no title fallback (D4). */
  reason?: 'non_film';
}

export const YEAR_TOLERANCE = 1;
export const FUZZY_THRESHOLD = 0.3;
const FUZZY_POOL = 40; // trigram-ranked films handed to Fuse.js
const MIN_TRIGRAM_SHARE = 0.3;
const ARTICLES = new Set([
  'the',
  'a',
  'an',
  'le',
  'la',
  'les',
  'l',
  'il',
  'el',
  'der',
  'die',
  'das',
]);

/** Key without a leading article ("the matrix" -> "matrix"); unchanged otherwise. */
export function stripArticle(key: string): string {
  const space = key.indexOf(' ');
  return space > 0 && ARTICLES.has(key.slice(0, space)) ? key.slice(space + 1) : key;
}

function trigrams(key: string): Set<string> {
  const padded = `  ${key} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Variant titles (D5, fallback 1) as raw strings; `unique` = accepted only for a single film. */
export function variantTitles(title: string): { title: string; unique: boolean }[] {
  const out = [
    { title: title.replace(/&/g, ' and '), unique: false },
    { title: title.replace(/\band\b/gi, ' & '), unique: false },
    { title: title.replace(/\s*\((?:18|19|20)\d{2}\)\s*$/, ''), unique: false },
  ];
  const main = title.split(/\s*:\s+|\s+[-–—]\s+/)[0];
  if (main && main.trim() !== title.trim()) out.push({ title: main, unique: true });
  return out.filter((v) => v.title !== title);
}

export class Matcher {
  private readonly byStrippedKey = new Map<string, Posting[]>();
  private readonly byYearTrigram = new Map<number, Map<string, number[]>>(); // year -> trigram -> entries
  private readonly entryTrigramCount: number[] = [];

  constructor(private readonly index: TitleIndex) {
    index.entries.forEach((e, i) => {
      const stripped = stripArticle(e.key);
      let list = this.byStrippedKey.get(stripped);
      if (!list) this.byStrippedKey.set(stripped, (list = []));
      list.push({ item: e.item, source: e.source });
      const grams = trigrams(e.key);
      this.entryTrigramCount.push(grams.size);
      // trigram postings split by year, so a fuzzy search only scans the films of year ±1
      for (const y of index.yearsOf(e.item)) {
        let byGram = this.byYearTrigram.get(y);
        if (!byGram) this.byYearTrigram.set(y, (byGram = new Map()));
        for (const g of grams) {
          let posting = byGram.get(g);
          if (!posting) byGram.set(g, (posting = []));
          posting.push(i);
        }
      }
    });
    this.sharedCount = new Uint16Array(index.entries.length);
    this.lastGram = new Int32Array(index.entries.length).fill(-1);
  }

  private readonly sharedCount: Uint16Array;
  private readonly lastGram: Int32Array;

  match(title: string, year?: number): MatchResult {
    const key = normalizeTitle(title);
    if (!key) return { status: 'not_found', candidates: [] };

    const exact = this.rank(this.index.lookup(key), year);
    const decision = decide(exact, year);
    if (decision) return result(decision, exact);

    for (const v of this.variantKeys(title, key)) {
      const cands = this.rank(v.postings, year);
      if (decide(cands, year) !== 'exact' || (v.unique && cands.length !== 1)) continue;
      return { ...result('probable_variant', cands), via: v.key };
    }

    if (year !== undefined) {
      const fuzzy = this.fuzzy(key, year);
      if (fuzzy.length > 0) {
        return { status: 'probable_fuzzy', item: fuzzy[0]!.item, candidates: fuzzy };
      }
    }
    return { status: 'not_found', candidates: [] };
  }

  private variantKeys(title: string, key: string) {
    const out: { key: string; postings: readonly Posting[]; unique: boolean }[] = [];
    const seen = new Set([key]);
    for (const v of variantTitles(title)) {
      const k = normalizeTitle(v.title);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, postings: this.index.lookup(k), unique: v.unique });
    }
    // article ignored on both sides: "Misérables" <-> "Les Misérables", "The Matrix" <-> "Matrix"
    const stripped = stripArticle(key);
    out.push({ key: stripped, postings: this.byStrippedKey.get(stripped) ?? [], unique: false });
    return out;
  }

  private yearGap(item: number, year: number | undefined): number | null {
    if (year === undefined) return null;
    const years = this.index.yearsOf(item);
    return years.length === 0 ? null : Math.min(...years.map((y) => Math.abs(y - year)));
  }

  /** Year filter (±1), one candidate per film (best source), ranked. */
  private rank(postings: readonly Posting[], year: number | undefined): Candidate[] {
    const best = new Map<number, Candidate>();
    for (const p of postings) {
      const gap = this.yearGap(p.item, year);
      if (gap !== null && gap > YEAR_TOLERANCE) continue;
      const prev = best.get(p.item);
      if (!prev || p.source < prev.source) {
        best.set(p.item, { item: p.item, source: p.source, yearGap: gap });
      }
    }
    const pop = this.index.popularity;
    const gapRank = (c: Candidate) => c.yearGap ?? YEAR_TOLERANCE + 0.5;
    return [...best.values()].sort(
      (a, b) =>
        gapRank(a) - gapRank(b) ||
        a.source - b.source ||
        (pop[b.item] ?? 0) - (pop[a.item] ?? 0) ||
        a.item - b.item,
    );
  }

  /** Films of year ±1 sharing the most trigrams with the key, then scored by Fuse.js. */
  private fuzzy(key: string, year: number): Candidate[] {
    const grams = [...trigrams(key)];
    const buckets: Map<string, number[]>[] = [];
    for (let y = year - YEAR_TOLERANCE; y <= year + YEAR_TOLERANCE; y++) {
      const b = this.byYearTrigram.get(y);
      if (b) buckets.push(b);
    }
    // count shared trigrams per entry (an entry may sit in two year buckets: count each gram once)
    const touched: number[] = [];
    grams.forEach((g, gi) => {
      for (const bucket of buckets) {
        for (const i of bucket.get(g) ?? []) {
          if (this.lastGram[i] === gi) continue;
          if (this.lastGram[i] === -1) touched.push(i);
          this.lastGram[i] = gi;
          this.sharedCount[i]!++;
        }
      }
    });
    const pool: { i: number; score: number }[] = [];
    for (const i of touched) {
      const dice = (2 * this.sharedCount[i]!) / (grams.length + this.entryTrigramCount[i]!);
      if (dice >= MIN_TRIGRAM_SHARE) pool.push({ i, score: dice });
      this.sharedCount[i] = 0;
      this.lastGram[i] = -1;
    }
    if (pool.length === 0) return [];
    pool.sort((a, b) => b.score - a.score || a.i - b.i);
    const docs = pool.slice(0, FUZZY_POOL).map(({ i }) => this.index.entries[i]!);
    const fuse = new Fuse(docs, {
      keys: ['key'],
      includeScore: true,
      threshold: FUZZY_THRESHOLD,
      ignoreLocation: true,
    });
    const seen = new Set<number>();
    const out: Candidate[] = [];
    for (const r of fuse.search(key)) {
      const score = r.score ?? 1;
      if (score > FUZZY_THRESHOLD || seen.has(r.item.item)) continue;
      seen.add(r.item.item);
      out.push({
        item: r.item.item,
        source: -1,
        yearGap: this.yearGap(r.item.item, year),
        fuzzyScore: score,
      });
      if (out.length === 3) break;
    }
    return out;
  }
}

/** exact / ambiguous / null (no candidate) for a ranked list. */
function decide(cands: Candidate[], year: number | undefined): 'exact' | 'ambiguous' | null {
  if (cands.length === 0) return null;
  if (cands.length === 1) return 'exact';
  if (year === undefined) return 'ambiguous';
  const [a, b] = cands as [Candidate, Candidate];
  return a.yearGap === b.yearGap && a.source === b.source ? 'ambiguous' : 'exact';
}

function result(status: 'exact' | 'ambiguous' | 'probable_variant', cands: Candidate[]) {
  return {
    status,
    item: status === 'ambiguous' ? undefined : cands[0]!.item,
    candidates: cands.slice(0, 3),
  } satisfies MatchResult;
}
