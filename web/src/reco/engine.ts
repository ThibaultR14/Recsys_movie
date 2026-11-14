/**
 * Recommendation engine shared by the Web Worker and the terminal scripts
 * (docs/etape-4-navigateur.md, D1-D5). Pure: the only I/O is the injected `fetch` for /data/.
 */
import {
  parseLetterboxdCsv,
  parseLetterboxdFiles,
  parseLetterboxdZip,
} from '../adapters/letterboxd';
import { parseImdbCsv } from '../adapters/imdb';
import type { AdapterResult } from '../adapters/types';
import { matchHistory, toUserHistory, type MatchedEntry, type UserFilm } from '../matching/history';
import { ImdbIdIndex } from '../matching/imdbIds';
import { Matcher, type MatchStatus } from '../matching/match';
import { TitleIndex, type TitleIndexFile } from '../matching/titleIndex';
import { calibrateShare, lambdaOf, shareProfile } from './calibrate';
import { foldIn, keptForFoldIn, signal } from './foldIn';
import { buildModelFiles, fetchModelFiles, type FetchFn, type ModelFiles } from './modelFiles';
import {
  qualityPool,
  rankCandidates,
  type ClassicsBonus,
  scoreAll,
  topByPosition,
  type PositionResult,
} from './recommend';

export interface CatalogFile {
  v: number;
  n: number;
  title: string[];
  original_title: Record<string, string>;
  year: (number | null)[];
  tmdb_id: (number | null)[];
  imdb_id: (string | null)[];
  imdb_id_aliases?: Record<string, string[]>;
  directors: string[][];
  poster_path: (string | null)[];
  genres: number[][];
  genre_names: string[];
  /** v2 (step 6b, D5): MovieLens mean rating x 10 and number of ratings. */
  ml_mean?: (number | null)[];
  ml_count?: (number | null)[];
  /** Step 6c (D3): [item, target] pairs of other cuts (`version_of` of manual_overrides.csv). */
  version_of?: [number, number][];
  /** Step 6c (Q6): sorted item_idx of the « ça divise » films (most dispersed MovieLens ratings). */
  divisive?: number[];
  /** v3 (step 8): items >= n_trained are estimated films (TMDB films missing from MovieLens). */
  n_trained?: number;
  /** Step 8 (R6b): round(scale * q) per item, the quality term (model-meta `quality`). */
  quality?: number[];
  /** v3 (step 8): TMDB rating out of 5 x 10 (34 = 3,4) and votes, one per estimated film. */
  tmdb_mean?: (number | null)[];
  tmdb_count?: number[];
}

export interface Engine {
  model: ModelFiles;
  catalog: CatalogFile;
  index: TitleIndex;
  matcher: Matcher;
  /** imdb_id (and aliases) -> item, for the IMDb adapter (docs/etape-6-imdb.md, D2). */
  ids: ImdbIdIndex;
  /** item -> its other cuts, both ways (step 6c, D3). */
  versions: Map<number, number[]>;
  /** « ça divise » films (step 6c, Q6). */
  divisive: ReadonlySet<number>;
  timings: { fetchMs: number; modelMs: number; indexMs: number; matcherMs: number };
}

export async function loadEngine(fetchFn: FetchFn, base = '/data/'): Promise<Engine> {
  const t0 = performance.now();
  const [files, catalog, indexFile] = await Promise.all([
    fetchModelFiles(fetchFn, base),
    fetchFn(`${base}catalog.json`).then((r) => r.json() as Promise<CatalogFile>),
    fetchFn(`${base}title-index.json`).then((r) => r.json() as Promise<TitleIndexFile>),
  ]);
  const t1 = performance.now();
  const model = buildModelFiles(
    files.meta,
    files.embeddings,
    files.yty,
    files.popularity,
    catalog.n,
  );
  const t2 = performance.now();
  const index = new TitleIndex(indexFile, catalog.year, model.popularity);
  const t3 = performance.now();
  const matcher = new Matcher(index);
  const ids = new ImdbIdIndex(catalog.imdb_id, catalog.imdb_id_aliases);
  const versions = versionPartners(catalog.version_of ?? []);
  const t4 = performance.now();
  return {
    model,
    catalog,
    index,
    matcher,
    ids,
    versions,
    divisive: new Set(catalog.divisive ?? []),
    timings: { fetchMs: t1 - t0, modelMs: t2 - t1, indexMs: t3 - t2, matcherMs: t4 - t3 },
  };
}

export type ExportInput =
  | { kind: 'zip'; bytes: Uint8Array }
  | { kind: 'files'; files: Record<string, string> }
  | { kind: 'csv'; name: string; text: string }
  /** IMDb ratings CSV, already decoded (docs/etape-6-imdb.md, D5). */
  | { kind: 'imdb'; name: string; text: string };

export function readExport(input: ExportInput): AdapterResult {
  if (input.kind === 'zip') return parseLetterboxdZip(input.bytes);
  if (input.kind === 'files') return parseLetterboxdFiles(input.files);
  if (input.kind === 'imdb') return parseImdbCsv(input.text);
  return parseLetterboxdCsv(input.name, input.text);
}

export interface ImportSummary {
  nEntries: number;
  counts: Record<MatchStatus, number>;
  nHistoryFilms: number;
  warnings: string[];
  filesRead: string[];
}

export function summarize(adapter: AdapterResult, matched: readonly MatchedEntry[]): ImportSummary {
  const counts: Record<MatchStatus, number> = {
    exact: 0,
    probable_variant: 0,
    probable_fuzzy: 0,
    ambiguous: 0,
    not_found: 0,
    confirmed: 0,
  };
  for (const m of matched) counts[m.result.status]++;
  return {
    nEntries: adapter.entries.length,
    counts,
    nHistoryFilms: toUserHistory(matched).length,
    warnings: adapter.warnings,
    filesRead: adapter.filesRead,
  };
}

export function importExport(engine: Engine, input: ExportInput) {
  const adapter = readExport(input);
  const matched = matchHistory(engine.matcher, adapter.entries, engine.ids);
  return { matched, summary: summarize(adapter, matched) };
}

/** Entry index -> chosen catalogue item, or null for « aucun de ceux-là » (step 5, D4). */
export type Choices = Record<number, number | null>;

/** Statuses the user can resolve on the analysis screen. */
export const CHOOSABLE_STATUSES: readonly MatchStatus[] = ['ambiguous', 'probable_fuzzy'];

/**
 * Applies the user's choices to the matched entries as imported (never to already confirmed ones):
 * a chosen candidate becomes `confirmed` (it enters the fold-in); null or no choice leaves the
 * entry as it is, with its exclusions. Throws on an index or item that is not a candidate.
 */
export function applyChoices(matched: readonly MatchedEntry[], choices: Choices): MatchedEntry[] {
  const out = matched.slice();
  for (const [key, item] of Object.entries(choices)) {
    const i = Number(key);
    const m = matched[i];
    if (!m || !CHOOSABLE_STATUSES.includes(m.result.status)) {
      throw new Error(`choix impossible pour l'entrée ${key}`);
    }
    if (item === null) continue;
    if (!m.result.candidates.some((c) => c.item === item)) {
      throw new Error(`le film ${item} n'est pas un candidat de l'entrée ${key}`);
    }
    out[i] = { entry: m.entry, result: { ...m.result, status: 'confirmed', item } };
  }
  return out;
}

/**
 * Films never recommended (D4): the history used for the fold-in, the tied candidates of
 * ambiguous entries and the main candidate of fuzzy ones (possibly seen, never used in the
 * fold-in).
 */
export function exclusions(matched: readonly MatchedEntry[], history: readonly UserFilm[]) {
  const out = new Set<number>(history.map((h) => h.item));
  for (const m of matched) {
    const r = m.result;
    if (r.status === 'ambiguous') {
      const [first] = r.candidates;
      for (const c of r.candidates) {
        if (first && c.yearGap === first.yearGap && c.source === first.source) out.add(c.item);
      }
    } else if (r.status === 'probable_fuzzy' && r.item !== undefined) {
      out.add(r.item);
    }
  }
  return out;
}

/** [item, target] pairs -> item -> other cuts, both ways (step 6c, D3). */
export function versionPartners(pairs: readonly (readonly [number, number])[]) {
  const out = new Map<number, number[]>();
  const add = (a: number, b: number) => out.set(a, [...(out.get(a) ?? []), b]);
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  return out;
}

/** Other cuts of the seen films: never recommended (step 6c, D3). */
export function versionExclusions(
  versions: ReadonlyMap<number, readonly number[]>,
  seen: Iterable<number>,
): Set<number> {
  const out = new Set<number>();
  for (const i of seen) for (const j of versions.get(i) ?? []) out.add(j);
  return out;
}

/** Calibrated positions (step 6c, D1): each pool reordered, cut to `n`; the relative score of the
 * position (model order) is kept. */
export function calibratePositions(
  pools: readonly PositionResult[],
  scores: Float64Array,
  profile: readonly number[],
  genres: readonly (readonly number[])[],
  calibration: NonNullable<ModelFiles['meta']['calibration']>,
  n: number,
  lambdaFor: (cap: number | null) => number = (cap) => lambdaOf(calibration, cap),
): PositionResult[] {
  return pools.map((pos) => {
    const lambda = lambdaFor(pos.cap);
    const items = calibrateShare(
      pos.items,
      pos.scores,
      profile,
      genres,
      lambda,
      n,
      calibration.alpha,
    );
    const s = items.map((i) => scores[i]!);
    return {
      ...pos,
      items,
      scores: s,
      relativeScores: s.map((x) => (pos.base > 0 ? x / pos.base : 0)),
    };
  });
}

/**
 * Step 8 (R6b): pools on score' = score / s_max + gamma q (`qualityPool`) when model-meta has a
 * `quality` term and catalog.json its values; otherwise the pools by score. The positions keep
 * their relative scores (« loin de tes goûts », model order).
 */
export function qualityPools(
  raw: readonly PositionResult[],
  ranked: Int32Array,
  scores: Float64Array,
  model: ModelFiles,
  q: readonly number[] | undefined,
  k: number,
  gamma?: number,
  classics?: ClassicsBonus,
): PositionResult[] {
  const quality = model.meta.quality;
  if (!quality || !q || q.length !== model.nItems) return [...raw];
  let qMax = -Infinity;
  for (const v of q) if (v > qMax) qMax = v;
  return raw.map((pos) => {
    const p = qualityPool(
      ranked,
      scores,
      model.popularity,
      pos.cap,
      q,
      gamma ?? quality.gamma,
      quality.scale,
      k,
      qMax / quality.scale,
      classics,
    );
    return { ...pos, items: p.items, scores: p.scores };
  });
}

/**
 * Variants of the settings, for the analysis of the visual stop (docs/etape-8-analyse-reglages.md)
 * and the dev-only switches of the site (`?calibration=0`…, never in production). Absent = the
 * production settings, computed exactly as before.
 */
export interface Tuning {
  /** false: no genre calibration (each pool cut to n, in score' order). */
  calibration?: boolean;
  /** One λ for the notches <= LOW_NOTCH_CAP (the others unchanged), or one λ per position. */
  lambda?: number | readonly number[];
  /** false: no quality term (gamma = 0). */
  quality?: boolean;
  /** Override of gamma (model-meta `quality.gamma`). */
  gamma?: number;
  /** 'not-recommended': estimated films never recommended (still in the profile);
   * 'off': neither recommended nor in the profile (still seen). */
  recent?: 'not-recommended' | 'off';
  /** Classics bonus score' += gamma × max(0, q − q_p), q_p = percentile `percentile` of q over the
   * trained recommendable films; estimated films get it only with `estimated: true`. */
  classics?: { gamma: number; percentile: number; estimated?: boolean };
  /** Calibration pool depth at the notches <= LOW_NOTCH_CAP (production: model-meta, 150). */
  pool?: number;
}

/** `?lambda=<value>` changes the notches at or below this cap (the left notches stay as they are). */
export const LOW_NOTCH_CAP = 5000;

/** λ of each cap under a tuning (production table when absent). */
export function tunedLambda(
  calibration: NonNullable<ModelFiles['meta']['calibration']>,
  tuning: Tuning | undefined,
): (cap: number | null) => number {
  const lambda = tuning?.lambda;
  return (cap) => {
    if (tuning?.calibration === false) return 0;
    if (typeof lambda === 'number') {
      return cap !== null && cap <= LOW_NOTCH_CAP ? lambda : lambdaOf(calibration, cap);
    }
    if (lambda) {
      const i = calibration.positions.indexOf(cap);
      return i < 0 ? 0 : (lambda[i] ?? lambdaOf(calibration, cap));
    }
    return lambdaOf(calibration, cap);
  };
}

/** q at the given percentile (0-100, nearest rank) over the trained recommendable films. */
export function qualityPercentile(engine: Engine, percentile: number): number {
  const { catalog, model } = engine;
  const scale = model.meta.quality?.scale ?? 1;
  const nTrained = catalog.n_trained ?? catalog.n;
  const values: number[] = [];
  for (let i = 0; i < nTrained; i++) {
    if (model.recommendable[i]) values.push((catalog.quality?.[i] ?? 0) / scale);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return 0;
  const k = Math.ceil((percentile / 100) * values.length) - 1;
  return values[Math.min(values.length - 1, Math.max(0, k))]!;
}

export interface Recommendations {
  /** Time of the genre calibration (8 positions), for reco-bench. */
  calibrationMs: number;
  positions: PositionResult[];
  history: UserFilm[];
  nExcluded: number;
  /** Intermediate steps, for the diagnostics (`why-film`): scores of every item, the ranked
   * candidates, each position before calibration (pool), the excluded items, the fold-in films. */
  scores: Float64Array;
  ranked: Int32Array;
  pools: PositionResult[];
  excluded: ReadonlySet<number>;
  foldInItems: number[];
}

/** Fold-in on exact + probable_variant + confirmed, scores, exclusions, slider positions. */
export function recommend(
  engine: Engine,
  matched: readonly MatchedEntry[],
  options: { n?: number; caps?: readonly (number | null)[]; tuning?: Tuning } = {},
): Recommendations {
  const { model } = engine;
  const tuning = options.tuning;
  const nTrained = engine.catalog.n_trained ?? engine.catalog.n;
  const history = toUserHistory(matched); // exact + probable_variant + confirmed
  // tuning 'off': estimated films out of the profile (they stay seen)
  const profileFilms =
    tuning?.recent === 'off' ? history.filter((h) => h.item < nTrained) : history;
  // step 6c (D2): disliked rated films out of the fold-in (they stay seen, never recommended)
  const kept = keptForFoldIn(
    profileFilms.map((h) => h.percentile),
    profileFilms.map((h) => h.rating !== undefined),
    model.meta.foldin_drop_below,
    model.meta.foldin_min_kept ?? 0,
  );
  const foldInFilms = profileFilms.filter((_, i) => kept[i]);
  const x = foldIn(
    model,
    foldInFilms.map((h) => h.item),
    foldInFilms.map((h) => h.percentile),
  );
  const scores = scoreAll(model, x);
  const excluded = exclusions(matched, history);
  const seen = history.map((h) => h.item);
  for (const i of versionExclusions(engine.versions, seen)) excluded.add(i);
  if (tuning?.recent) for (let i = nTrained; i < model.nItems; i++) excluded.add(i);
  const ranked = rankCandidates(scores, model.recommendable, excluded);
  const caps = options.caps ?? model.meta.slider.positions;
  const n = options.n ?? 50;
  const calibration = model.meta.calibration;
  const raw = topByPosition(
    ranked,
    scores,
    model.popularity,
    caps,
    calibration ? Math.max(n, calibration.pool) : n,
  );
  // step 8 (R6b): quality term, pools on score' = score / s_max + gamma q (raw kept for the
  // relative scores « loin de tes goûts »)
  const classics = tuning?.classics
    ? {
        gamma: tuning.classics.gamma,
        threshold: qualityPercentile(engine, tuning.classics.percentile),
        maxItem: tuning.classics.estimated ? model.nItems : nTrained,
      }
    : undefined;
  const qualityRanked = qualityPools(
    raw,
    ranked,
    scores,
    model,
    engine.catalog.quality,
    calibration ? Math.max(n, calibration.pool) : n,
    tuning?.quality === false ? 0 : tuning?.gamma,
    classics,
  );
  // tuning `pool`: a shallower calibration pool at the notches <= LOW_NOTCH_CAP (analysis)
  const depth = tuning?.pool;
  const pools =
    depth === undefined
      ? qualityRanked
      : qualityRanked.map((p) =>
          p.cap !== null && p.cap <= LOW_NOTCH_CAP
            ? { ...p, items: p.items.slice(0, depth), scores: p.scores.slice(0, depth) }
            : p,
        );
  // step 6c (D1): genre calibration of each position, once, on its pool (the fold-in films' genres)
  const t0 = performance.now();
  const positions = calibration
    ? calibratePositions(
        pools,
        scores,
        shareProfile(
          engine.catalog.genres,
          engine.catalog.genre_names.length,
          foldInFilms.map((h) => h.item),
          foldInFilms.map((h) => signal(h.percentile, model.meta.beta)),
        ),
        engine.catalog.genres,
        calibration,
        n,
        tunedLambda(calibration, tuning),
      )
    : pools.map((p) => ({
        ...p,
        items: p.items.slice(0, n),
        scores: p.items.slice(0, n).map((i) => scores[i]!),
      }));
  const calibrationMs = performance.now() - t0;
  return {
    calibrationMs,
    positions,
    history,
    nExcluded: excluded.size,
    scores,
    ranked,
    pools,
    excluded,
    foldInItems: foldInFilms.map((h) => h.item),
  };
}
