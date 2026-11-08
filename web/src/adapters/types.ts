/** Common internal format produced by every import adapter (CLAUDE.md, docs/etape-3, D4). */

export type SourceName = 'letterboxd' | 'imdb';

export interface HistoryEntry {
  title: string;
  /** Original title when the source gives one and it differs from `title` (IMDb). */
  originalTitle?: string;
  year?: number;
  /** Source title type, normalized (IMDb: "movie", "tvseries"…, see adapters/imdb.ts). */
  titleType?: string;
  imdbId?: string;
  tmdbId?: number;
  /** Rating on the source scale (Letterboxd 0.5-5, IMDb 1-10); undefined = watched without a rating. */
  rating?: number;
  scaleMax: number;
  /** Percentile of the rating in the user's history (normalizeRatings.ts); 0.5 if unrated. */
  ratingNormalized?: number;
  /** Most recent watch date, YYYY-MM-DD. */
  date?: string;
  source: SourceName;
  /** Stable id inside the source (Letterboxd film link, IMDb id, or "title:<name>|<year>"). */
  sourceKey: string;
}

export interface AdapterResult {
  entries: HistoryEntry[];
  /** Source files actually read. */
  filesRead: string[];
  warnings: string[];
}
