/**
 * Adapter entries -> matched catalogue films -> user history for the fold-in (step 4).
 * Statuses used for recommendations: exact and probable_variant (D5). probable_fuzzy is NOT used:
 * 0/2 correct on Thibault's export (TV series matched to look-alike films), above the 2 % error
 * limit (E6); it only feeds the "films non reconnus" screen (step 5).
 * Step 5 (D4): `confirmed` = a candidate chosen by the user on the analysis screen, used too.
 */
import { dedupeLatest, percentiles } from '../adapters/normalizeRatings';
import type { HistoryEntry } from '../adapters/types';
import { isFilmType } from '../adapters/imdb';
import type { ImdbIdIndex } from './imdbIds';
import type { Matcher, MatchResult, MatchStatus } from './match';

export interface MatchedEntry {
  entry: HistoryEntry;
  result: MatchResult;
}

export interface UserFilm {
  item: number;
  rating?: number;
  /** Percentile within the user's matched history (0.5 if unrated). */
  percentile: number;
  date?: string;
  status: MatchStatus;
}

export const RECOMMENDATION_STATUSES: readonly MatchStatus[] = [
  'exact',
  'probable_variant',
  'confirmed',
];

export function matchHistory(
  matcher: Matcher,
  entries: readonly HistoryEntry[],
  ids?: ImdbIdIndex,
): MatchedEntry[] {
  return entries.map((entry) => ({ entry, result: matchEntry(matcher, entry, ids) }));
}

const TITLE_RANK: Record<MatchStatus, number> = {
  exact: 0,
  probable_variant: 1,
  ambiguous: 2,
  probable_fuzzy: 3,
  not_found: 4,
  confirmed: 5,
};

/**
 * One entry -> one match (docs/etape-6-imdb.md, D2-D4). Letterboxd: title + year, exactly as in
 * step 3. IMDb: the id first (main ids, then aliases); otherwise, for film types only, the title
 * fallback (Title, then Original Title), always sent to review: a title found this way is mostly a
 * namesake, since every catalogue film has its own imdb_id (D3).
 */
export function matchEntry(matcher: Matcher, entry: HistoryEntry, ids?: ImdbIdIndex): MatchResult {
  if (entry.source !== 'imdb') return matcher.match(entry.title, entry.year);

  const byId = ids?.lookup(entry.imdbId);
  if (byId) return { status: 'exact', item: byId.item, candidates: [], matchedBy: byId.by };
  if (!isFilmType(entry.titleType))
    return { status: 'not_found', candidates: [], reason: 'non_film' };

  let r = matcher.match(entry.title, entry.year);
  if (entry.originalTitle && r.status !== 'exact' && r.status !== 'probable_variant') {
    const o = matcher.match(entry.originalTitle, entry.year);
    if (TITLE_RANK[o.status] < TITLE_RANK[r.status]) r = o;
  }
  if (r.status === 'exact' || r.status === 'probable_variant' || r.status === 'ambiguous') {
    // no `item`: an ambiguous entry never enters the fold-in until the user picks a candidate
    const review: MatchResult = { ...r, status: 'ambiguous', titleStatus: r.status };
    delete review.item;
    return { ...review, matchedBy: 'title' };
  }
  if (r.status === 'probable_fuzzy') return { ...r, titleStatus: r.status, matchedBy: 'title' };
  return r;
}

/** One film per catalogue item (most recent entry kept), percentiles over the kept ratings. */
export function toUserHistory(
  matched: readonly MatchedEntry[],
  statuses: readonly MatchStatus[] = RECOMMENDATION_STATUSES,
): UserFilm[] {
  const usable = matched.filter(
    (m) => m.result.item !== undefined && statuses.includes(m.result.status),
  );
  const kept = dedupeLatest(
    usable,
    (m) => m.result.item!,
    (m) => m.entry.date,
  );
  const p = percentiles(kept.map((m) => m.entry.rating));
  return kept.map((m, i) => ({
    item: m.result.item!,
    rating: m.entry.rating,
    percentile: p[i]!,
    date: m.entry.date,
    status: m.result.status,
  }));
}
