/**
 * Message protocol of the recommendation Web Worker (docs/etape-4-navigateur.md, D5), and its
 * handler. Pure apart from the injected `fetch` (only /data/ files): testable in Node.
 * The user's export is read here and never leaves the worker except as the results below.
 */
import { RECOMMENDATION_STATUSES, type MatchedEntry } from '../matching/history';
import type { MatchStatus } from '../matching/match';
import { profileDirectors, seriesOf } from './annotations';
import { CANDIDATES, explain } from './explain';
import {
  applyChoices,
  importExport,
  loadEngine,
  recommend,
  summarize,
  type Choices,
  type Engine,
  type ExportInput,
  type ImportSummary,
} from './engine';
import type { FetchFn } from './modelFiles';

export type RecoRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'import'; input: ExportInput }
  | { id: number; type: 'confirm'; choices: Choices }
  | { id: number; type: 'recommend'; n?: number; caps?: (number | null)[] };

export type RecoResponse =
  | { id: number; ok: true; result: InitResult | ImportResult | ConfirmResult | RecommendResult }
  | { id: number; ok: false; error: string };

export interface InitResult {
  nItems: number;
  positions: (number | null)[];
  timings: Engine['timings'];
}

export interface FilmCard {
  item: number;
  title: string;
  year: number | null;
  directors: string[];
  posterPath: string | null;
  /** Slider popularity (MovieLens ratings, raised with TMDB votes for recent films). */
  popularity: number;
  /** TMDB id (card link), null when unknown. */
  tmdbId: number | null;
  /** MovieLens genre names (e.g. "Documentary"). */
  genres: string[];
  /** Public rating (step 6b, D5): MovieLens mean x 10 (39 = 3,9 / 5) and number of ratings. */
  publicRating?: { mean10: number; count: number };
  /** « ça divise » tag candidate (step 6c, Q6); absent when false. */
  divisive?: true;
  /** Estimated film (step 8): vector estimated from TMDB, not learned from MovieLens. */
  estimated?: true;
  /** TMDB rating of an estimated film (out of 5 x 10), « ★ 3,4 · TMDB »; null when unknown. */
  tmdbRating?: { mean10: number | null };
}

export interface Unrecognized {
  /** Index of the entry in the import, the key of `confirm` choices. */
  index: number;
  title: string;
  year: number | null;
  status: MatchStatus;
  candidates: FilmCard[];
  /** Series, episode, game… not found by id (docs/etape-6-imdb.md, D4). */
  reason?: 'non_film';
  /** Candidates found by the title only (IMDb, D3): to verify, never ticked by default. */
  byTitle?: boolean;
}

export interface ImportResult {
  summary: ImportSummary;
  /** Entries not used for the recommendations (step 5: "films non reconnus" screen). */
  unrecognized: Unrecognized[];
}

/** Counts after the user's choices (`confirmed` included). */
export interface ConfirmResult {
  counts: ImportSummary['counts'];
  nHistoryFilms: number;
}

export interface RecommendedFilm extends FilmCard {
  score: number;
  /** score / mean score of the first 20 films at ∞ (step 6b: rows far from the user's taste). */
  relativeScore?: number;
  /** Title of a seen film of the same series (same main title, a director in common). */
  seriesOf?: string;
  /**
   * « (parce que t'as aimé X et Y) » (step 6b, D6); never with `seriesOf` (Q3). Up to 5 candidate
   * history films, closest first; the grid picks at most 2 per card (diversity rule, R6).
   */
  because?: { kind: 'liked' | 'seen'; items: number[]; titles: string[] };
}

export interface RecommendResult {
  nHistory: number;
  nExcluded: number;
  /** Up to 3 directors for « (t'aimes bien X, Y et Z, non ?) »; empty = annotation hidden. */
  profileDirectors: string[];
  /** Time spent on the explanations (step 6b, D6), for reco-bench. */
  explainMs?: number;
  /** Time spent on the genre calibration (step 6c, D1), for reco-bench. */
  calibrationMs?: number;
  positions: {
    cap: number | null;
    relativeScore: number;
    films: RecommendedFilm[];
  }[];
}

export interface WorkerState {
  engine?: Engine;
  /** Entries as matched at import (choices are always applied to these). */
  imported?: MatchedEntry[];
  /** Entries used for the recommendations (imported + the user's choices). */
  matched?: MatchedEntry[];
  summary?: ImportSummary;
}

export function filmCard(engine: Engine, item: number): FilmCard {
  const c = engine.catalog;
  return {
    item,
    title: c.title[item] ?? '',
    year: c.year[item] ?? null,
    directors: c.directors[item] ?? [],
    posterPath: c.poster_path[item] ?? null,
    popularity: engine.model.popularity[item] ?? 0,
    tmdbId: c.tmdb_id[item] ?? null,
    genres: (c.genres[item] ?? []).map((g) => c.genre_names[g] ?? ''),
    ...publicRating(c, item),
    ...(engine.divisive.has(item) ? { divisive: true as const } : {}),
    ...estimatedFields(c, item),
  };
}

/** Step 8: estimated films come after the trained ones (catalog.json v3). */
export function isEstimated(c: Engine['catalog'], item: number): boolean {
  return c.n_trained !== undefined && item >= c.n_trained;
}

function estimatedFields(
  c: Engine['catalog'],
  item: number,
): Pick<FilmCard, 'estimated' | 'tmdbRating'> {
  if (!isEstimated(c, item)) return {};
  const mean10 = c.tmdb_mean?.[item - (c.n_trained ?? 0)] ?? null;
  return { estimated: true, tmdbRating: { mean10 } };
}

function publicRating(c: Engine['catalog'], item: number): Pick<FilmCard, 'publicRating'> {
  const mean10 = c.ml_mean?.[item];
  const count = c.ml_count?.[item];
  return mean10 != null && count != null ? { publicRating: { mean10, count } } : {};
}

async function run(state: WorkerState, req: RecoRequest, fetchFn: FetchFn) {
  if (req.type === 'init') {
    state.engine ??= await loadEngine(fetchFn);
    const e = state.engine;
    return { nItems: e.model.nItems, positions: e.model.meta.slider.positions, timings: e.timings };
  }
  const engine = state.engine;
  if (!engine) throw new Error('modèle pas encore chargé');
  if (req.type === 'import') {
    const { matched, summary } = importExport(engine, req.input);
    state.imported = matched;
    state.matched = matched;
    state.summary = summary;
    const unrecognized = matched
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => !RECOMMENDATION_STATUSES.includes(m.result.status))
      .map(({ m, index }) => ({
        index,
        title: m.entry.title,
        year: m.entry.year ?? null,
        status: m.result.status,
        candidates: m.result.candidates.map((c) => filmCard(engine, c.item)),
        ...(m.result.reason && { reason: m.result.reason }),
        ...(m.result.matchedBy === 'title' && { byTitle: true }),
      }));
    return { summary, unrecognized } satisfies ImportResult;
  }
  if (!state.matched || !state.imported || !state.summary) {
    throw new Error('aucun historique importé');
  }
  if (req.type === 'confirm') {
    state.matched = applyChoices(state.imported, req.choices);
    const s = summarize(
      { entries: [], warnings: state.summary.warnings, filesRead: state.summary.filesRead },
      state.matched,
    );
    return { counts: s.counts, nHistoryFilms: s.nHistoryFilms } satisfies ConfirmResult;
  }
  const res = recommend(engine, state.matched, { n: req.n, caps: req.caps });
  const distinct = [...new Set(res.positions.flatMap((p) => p.items))];
  const series = seriesOf(distinct, res.history, engine.catalog);
  const t0 = performance.now();
  const why = explain(
    engine.model.vectors,
    engine.model.dims,
    res.history,
    distinct.filter((item) => !series.has(item)),
    { maxCited: CANDIDATES },
  );
  const explainMs = performance.now() - t0;
  return {
    nHistory: res.history.length,
    nExcluded: res.nExcluded,
    profileDirectors: profileDirectors(res.history, engine.catalog),
    explainMs,
    calibrationMs: res.calibrationMs,
    positions: res.positions.map((p) => ({
      cap: p.cap,
      relativeScore: p.relativeScore,
      films: p.items.map((item, k) => {
        const film: RecommendedFilm = {
          ...filmCard(engine, item),
          score: p.scores[k]!,
          relativeScore: p.relativeScores[k]!,
        };
        const s = series.get(item);
        if (s) film.seriesOf = s;
        const w = why.get(item);
        if (w && !s) {
          film.because = {
            kind: w.kind,
            items: w.items,
            titles: w.items.map((i) => engine.catalog.title[i] ?? ''),
          };
        }
        return film;
      }),
    })),
  } satisfies RecommendResult;
}

/** One request -> one response; errors become `{ ok: false, error }` (in French, for the UI). */
export function createHandler(fetchFn: FetchFn) {
  const state: WorkerState = {};
  return async (req: RecoRequest): Promise<RecoResponse> => {
    try {
      return { id: req.id, ok: true, result: await run(state, req, fetchFn) };
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
