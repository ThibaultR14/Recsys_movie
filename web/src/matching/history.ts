/**
 * Adapter entries -> matched catalogue films -> user history for the fold-in (step 4).
 * Statuses used for recommendations: exact and probable_variant (D5). probable_fuzzy is NOT used:
 * 0/2 correct on Thibault's export (TV series matched to look-alike films), above the 2 % error
 * limit (E6); it only feeds the "films non reconnus" screen (step 5).
 * Step 5 (D4): `confirmed` = a candidate chosen by the user on the analysis screen, used too.
 */
import { dedupeLatest, percentiles } from '../adapters/normalizeRatings';
import type { HistoryEntry } from '../adapters/types';
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

export function matchHistory(matcher: Matcher, entries: readonly HistoryEntry[]): MatchedEntry[] {
  return entries.map((entry) => ({ entry, result: matcher.match(entry.title, entry.year) }));
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
