/**
 * Message protocol of the recommendation Web Worker (docs/etape-4-navigateur.md, D5), and its
 * handler. Pure apart from the injected `fetch` (only /data/ files): testable in Node.
 * The user's export is read here and never leaves the worker except as the results below.
 */
import { RECOMMENDATION_STATUSES, type MatchedEntry } from '../matching/history';
import type { MatchStatus } from '../matching/match';
import {
  importExport,
  loadEngine,
  recommend,
  type Engine,
  type ExportInput,
  type ImportSummary,
} from './engine';
import type { FetchFn } from './modelFiles';

export type RecoRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'import'; input: ExportInput }
  | { id: number; type: 'recommend'; n?: number; caps?: (number | null)[] };

export type RecoResponse =
  | { id: number; ok: true; result: InitResult | ImportResult | RecommendResult }
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
}

export interface Unrecognized {
  title: string;
  year: number | null;
  status: MatchStatus;
  candidates: FilmCard[];
}

export interface ImportResult {
  summary: ImportSummary;
  /** Entries not used for the recommendations (step 5: "films non reconnus" screen). */
  unrecognized: Unrecognized[];
}

export interface RecommendResult {
  nHistory: number;
  nExcluded: number;
  positions: {
    cap: number | null;
    relativeScore: number;
    films: (FilmCard & { score: number })[];
  }[];
}

export interface WorkerState {
  engine?: Engine;
  matched?: MatchedEntry[];
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
  };
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
    state.matched = matched;
    const unrecognized = matched
      .filter((m) => !RECOMMENDATION_STATUSES.includes(m.result.status))
      .map((m) => ({
        title: m.entry.title,
        year: m.entry.year ?? null,
        status: m.result.status,
        candidates: m.result.candidates.map((c) => filmCard(engine, c.item)),
      }));
    return { summary, unrecognized } satisfies ImportResult;
  }
  if (!state.matched) throw new Error('aucun historique importé');
  const res = recommend(engine, state.matched, { n: req.n, caps: req.caps });
  return {
    nHistory: res.history.length,
    nExcluded: res.nExcluded,
    positions: res.positions.map((p) => ({
      cap: p.cap,
      relativeScore: p.relativeScore,
      films: p.items.map((item, k) => ({ ...filmCard(engine, item), score: p.scores[k]! })),
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
