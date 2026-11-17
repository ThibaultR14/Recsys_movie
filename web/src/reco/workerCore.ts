/**
 * Message protocol of the recommendation Web Worker (docs/etape-4-navigateur.md, D5), and its
 * handler. Pure apart from the injected `fetch` (only /data/ files): testable in Node.
 * The user's export is read here and never leaves the worker except as the results below.
 */
import { RECOMMENDATION_STATUSES, type MatchedEntry, type UserFilm } from '../matching/history';
import type { MatchStatus } from '../matching/match';
import { profileDirectors, seriesOf } from './annotations';
import { CANDIDATES, explain, type Explanation } from './explain';
import { compileFilters, refineOptions, type Filters, type RefineOptions } from './filters';
import {
  applyChoices,
  importExport,
  loadEngine,
  personFilms,
  recommendFrom,
  summarize,
  userProfile,
  type Choices,
  type Engine,
  type ExportInput,
  type ImportSummary,
  type Tuning,
  type UserProfile,
} from './engine';
import type { FetchFn } from './modelFiles';
import { buildPeopleIndex, searchPeople, type PeopleIndex, type PersonSuggestion } from './people';

export type RecoRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'import'; input: ExportInput }
  | { id: number; type: 'confirm'; choices: Choices }
  | {
      id: number;
      type: 'recommend';
      n?: number;
      caps?: (number | null)[];
      tuning?: Tuning;
      /** Step 8b (D2): « affiner »; the fold-in is kept, only the lists are recomputed. */
      filters?: Filters;
      /** Step 8b (D2): caps whose films get « parce que t'as aimé » (those shown); all if absent. */
      explainCaps?: (number | null)[];
    }
  /** Step 8b (D4): suggestions of « des films de… » (no history needed). */
  | { id: number; type: 'people'; query: string }
  /** Step 8b (D4): the not-seen films of a person (index into catalog.json `people`). */
  | {
      id: number;
      type: 'person';
      person: number;
      n?: number;
      tuning?: Tuning;
      filters?: Filters;
    };

export type RecoResponse =
  | {
      id: number;
      ok: true;
      result:
        | InitResult
        | ImportResult
        | ConfirmResult
        | RecommendResult
        | PersonSuggestion[]
        | PersonResult;
    }
  | { id: number; ok: false; error: string };

export interface InitResult {
  nItems: number;
  positions: (number | null)[];
  timings: Engine['timings'];
  /** Step 8b (D3): genres and languages « affiner » can offer. */
  refine: RefineOptions;
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

/** « des films de <nom> que t'as pas vus » (step 8b, D4). */
export interface PersonResult {
  person: number;
  name: string;
  films: RecommendedFilm[];
}

export interface WorkerState {
  engine?: Engine;
  /** Entries as matched at import (choices are always applied to these). */
  imported?: MatchedEntry[];
  /** Entries used for the recommendations (imported + the user's choices). */
  matched?: MatchedEntry[];
  summary?: ImportSummary;
  /** Step 8b (D2): the fold-in of `matched` (cleared by import and confirm), and the
   * explanations already computed for it (they depend on the history only; null = none). */
  user?: UserProfile;
  /** JSON of the tuning the fold-in was made with. */
  userTuning?: string;
  explained?: Map<number, Explanation | null>;
  /** Step 8b (D4): built on the first search. */
  people?: PeopleIndex;
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
    return {
      nItems: e.model.nItems,
      positions: e.model.meta.slider.positions,
      timings: e.timings,
      refine: refineOptions(e.catalog, e.model.recommendable),
    };
  }
  const engine = state.engine;
  if (!engine) throw new Error('modèle pas encore chargé');
  if (req.type === 'import') {
    const { matched, summary } = importExport(engine, req.input);
    state.imported = matched;
    state.matched = matched;
    state.summary = summary;
    clearUser(state);
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
  if (req.type === 'people') {
    state.people ??= buildPeopleIndex(engine.catalog);
    return searchPeople(state.people, req.query);
  }
  if (!state.matched || !state.imported || !state.summary) {
    throw new Error('aucun historique importé');
  }
  if (req.type === 'confirm') {
    state.matched = applyChoices(state.imported, req.choices);
    clearUser(state);
    const s = summarize(
      { entries: [], warnings: state.summary.warnings, filesRead: state.summary.filesRead },
      state.matched,
    );
    return { counts: s.counts, nHistoryFilms: s.nHistoryFilms } satisfies ConfirmResult;
  }
  // step 8b (D2): the fold-in is kept between requests (same history, same tuning)
  // (by value: postMessage hands the worker a fresh copy of `tuning` each time)
  const tuningKey = JSON.stringify(req.tuning ?? null);
  if (!state.user || state.userTuning !== tuningKey) {
    state.user = userProfile(engine, state.matched, req.tuning);
    state.userTuning = tuningKey;
    state.explained = new Map();
  }
  const filter = req.filters ? compileFilters(req.filters, engine.catalog) : undefined;
  if (req.type === 'person') {
    state.people ??= buildPeopleIndex(engine.catalog);
    const { items, scores } = personFilms(
      engine,
      state.user,
      state.people.films[req.person] ?? [],
      {
        n: req.n,
        tuning: req.tuning,
        filter,
      },
    );
    const series = seriesOf(items, state.user.history, engine.catalog);
    const why = explainCached(state, engine, state.user.history, items, series, req.tuning);
    return {
      person: req.person,
      name: state.people.names[req.person] ?? '',
      films: items.map((item, k) => card(engine, item, scores[k]!, undefined, series, why)),
    } satisfies PersonResult;
  }
  const res = recommendFrom(engine, state.user, {
    n: req.n,
    caps: req.caps,
    tuning: req.tuning,
    filter,
  });
  const distinct = [...new Set(res.positions.flatMap((p) => p.items))];
  const series = seriesOf(distinct, res.history, engine.catalog);
  const t0 = performance.now();
  // step 8b (D2): explanations for the films of the caps shown only
  const shown = req.explainCaps
    ? [
        ...new Set(
          res.positions.filter((p) => req.explainCaps!.includes(p.cap)).flatMap((p) => p.items),
        ),
      ]
    : distinct;
  const why = explainCached(state, engine, res.history, shown, series, req.tuning);
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
      films: p.items.map((item, k) =>
        card(engine, item, p.scores[k]!, p.relativeScores[k]!, series, why),
      ),
    })),
  } satisfies RecommendResult;
}

function card(
  engine: Engine,
  item: number,
  score: number,
  relativeScore: number | undefined,
  series: ReadonlyMap<number, string>,
  why: ReadonlyMap<number, Explanation>,
): RecommendedFilm {
  const film: RecommendedFilm = { ...filmCard(engine, item), score };
  if (relativeScore !== undefined) film.relativeScore = relativeScore;
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
}

function clearUser(state: WorkerState) {
  state.user = undefined;
  state.userTuning = undefined;
  state.explained = undefined;
}

/** « parce que t'as aimé » of `items`, computed once per film for the current history. */
function explainCached(
  state: WorkerState,
  engine: Engine,
  history: readonly UserFilm[],
  items: readonly number[],
  series: ReadonlyMap<number, string>,
  tuning: Tuning | undefined,
): Map<number, Explanation> {
  const cache = (state.explained ??= new Map());
  // step 8: an estimated film is never cited (its vector, close to the mean direction, is
  // « close » to everything); it stays in the profile; step 8 (R6e): no « parce que t'as aimé »
  // on an estimated film's card (generic citations)
  const targets = items.filter(
    (item) => !series.has(item) && (tuning?.estimatedExplain || !isEstimated(engine.catalog, item)),
  );
  const todo = targets.filter((i) => !cache.has(i));
  if (todo.length) {
    const got = explain(
      engine.model.vectors,
      engine.model.dims,
      history.filter((h) => !isEstimated(engine.catalog, h.item)),
      todo,
      { maxCited: CANDIDATES },
    );
    for (const i of todo) cache.set(i, got.get(i) ?? null);
  }
  const out = new Map<number, Explanation>();
  for (const i of targets) {
    const w = cache.get(i);
    if (w) out.set(i, w);
  }
  return out;
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
