/** Common internal format produced by every import adapter (CLAUDE.md, docs/etape-3, D4). */

export type SourceName = 'letterboxd' | 'imdb';

export interface HistoryEntry {
  title: string;
  year?: number;
  imdbId?: string;
  tmdbId?: number;
  /** Rating on the source scale (Letterboxd: 0.5 to 5); undefined = watched without a rating. */
  rating?: number;
  scaleMax: number;
  /** Percentile of the rating in the user's history (normalizeRatings.ts); 0.5 if unrated. */
  ratingNormalized?: number;
  /** Most recent watch date, YYYY-MM-DD. */
  date?: string;
  source: SourceName;
  /** Stable id inside the source (Letterboxd film link, or "title:<name>|<year>" for the diary). */
  sourceKey: string;
}

export interface AdapterResult {
  entries: HistoryEntry[];
  /** Source files actually read. */
  filesRead: string[];
  warnings: string[];
}
