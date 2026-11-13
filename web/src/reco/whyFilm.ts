// « pourquoi pas ce film ? » (step 8, before closing): where one film stands in the lists of a user,
// with the same engine as the site. Diagnostics only (terminal script `why-film`), never shown.
import type { MatchedEntry } from '../matching/history';
import { type Engine, type Recommendations, recommend } from './engine';
import { isEstimated } from './workerCore';

export interface NotchDiagnosis {
  cap: number | null;
  /** popularity <= cap: the film may appear at this notch. */
  visible: boolean;
  /** 1-based rank of its score among the candidates under the cap (before calibration). */
  rankBefore: number | null;
  /** in the pool given to the calibration (the first `pool` candidates under the cap). */
  inPool: boolean;
  /** 1-based place in the shown list (after calibration), null when not in it. */
  rankAfter: number | null;
  /** size of the shown list. */
  shown: number;
}

export interface WhyFilm {
  item: number;
  title: string;
  year: number | null;
  estimated: boolean;
  recommendable: boolean;
  /** In the user's history (fold-in statuses): rating, percentile, used in the fold-in or not. */
  seen: { rating?: number; percentile: number; inFoldIn: boolean } | null;
  /** Why it can never be recommended to this user, if so. */
  excluded: 'vu' | 'autre version vue' | 'candidat à vérifier' | 'non recommandable' | null;
  popularity: number;
  score: number;
  /** 1-based rank among all the candidates (no cap), null when not a candidate. */
  rankAll: number | null;
  nCandidates: number;
  notches: NotchDiagnosis[];
  /** Films of the history closest to it (cosine of the vectors), best first. */
  nearest: { item: number; title: string; cosine: number; rating?: number; percentile: number }[];
}

function cosine(v: Float32Array, dims: number, a: number, b: number): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let d = 0; d < dims; d++) {
    const x = v[a * dims + d]!;
    const y = v[b * dims + d]!;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

export function whyFilm(
  engine: Engine,
  matched: readonly MatchedEntry[],
  item: number,
  options: { n?: number; nearest?: number; rec?: Recommendations } = {},
): WhyFilm {
  const n = options.n ?? 48;
  const rec = options.rec ?? recommend(engine, matched, { n });
  const { model, catalog } = engine;
  const h = rec.history.find((f) => f.item === item);
  const foldIn = new Set(rec.foldInItems);
  const seenItems = new Set(rec.history.map((f) => f.item));
  const versionSeen = [...seenItems].some((s) => (engine.versions.get(s) ?? []).includes(item));
  const recommendable = model.recommendable[item] === 1;
  const excluded = seenItems.has(item)
    ? 'vu'
    : versionSeen
      ? 'autre version vue'
      : rec.excluded.has(item)
        ? 'candidat à vérifier'
        : !recommendable
          ? 'non recommandable'
          : null;
  const pos = rec.ranked.indexOf(item);
  const popularity = model.popularity[item]!;
  const notches = rec.positions.map((shownPos, k): NotchDiagnosis => {
    const cap = shownPos.cap;
    const visible = cap === null || popularity <= cap;
    let rankBefore: number | null = null;
    if (pos >= 0 && visible) {
      let r = 0;
      for (let j = 0; j <= pos; j++) {
        if (cap === null || model.popularity[rec.ranked[j]!]! <= cap) r++;
      }
      rankBefore = r;
    }
    const after = shownPos.items.indexOf(item);
    return {
      cap,
      visible,
      rankBefore,
      inPool: rec.pools[k]!.items.includes(item),
      rankAfter: after >= 0 ? after + 1 : null,
      shown: shownPos.items.length,
    };
  });
  const nearest = rec.history
    .filter((f) => f.item !== item)
    .map((f) => ({
      item: f.item,
      title: catalog.title[f.item] ?? '',
      cosine: cosine(model.vectors, model.dims, item, f.item),
      ...(f.rating !== undefined && { rating: f.rating }),
      percentile: f.percentile,
    }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, options.nearest ?? 3);
  return {
    item,
    title: catalog.title[item] ?? '',
    year: catalog.year[item] ?? null,
    estimated: isEstimated(catalog, item),
    recommendable,
    seen: h
      ? {
          ...(h.rating !== undefined && { rating: h.rating }),
          percentile: h.percentile,
          inFoldIn: foldIn.has(item),
        }
      : null,
    excluded,
    popularity,
    score: rec.scores[item]!,
    rankAll: pos >= 0 ? pos + 1 : null,
    nCandidates: rec.ranked.length,
    notches,
    nearest,
  };
}
