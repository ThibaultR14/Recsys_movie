"""Vectors of films that ALS never saw (step 8, docs/etape-8-films-recents.md, D1-D7). Pure.

- D1  neighbours: the TMDB `recommendations` of a film that are already placed (trained films, or
      films placed before it in chronological order, weight gamma), first k, weight 1/rank;
      centred mean with shrinkage s: s * sum w (y - mu) / sum w.
- D1c norm: the estimate is rescaled to the median norm of the trained films of the same TMDB
      vote bin (fixed bins, a bin with < MIN_FILMS_PER_BIN films takes the nearest one).
- D2  content: ridge regression of the centred ALS vectors on sparse TMDB features.
- D3  mix: alpha(n) * neighbours + (1 - alpha(n)) * content, alpha = n / (n + kappa); not placed
      when fewer than MIN_NEIGHBOURS neighbours and no telling content.
- D4  quality: Bayesian mean of the TMDB rating.
- D6  fold-in with a weight omega per film (omega = 1: the usual fold-in, omega = 0: left out).
- D7  slider popularity: rank of the TMDB votes within the release year, mapped to the
      popularity distribution of reference films; never below r_ref * votes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import lsqr

# D1c: lower edges of the TMDB vote bins after the first one (50-99, 100-199, ..., >= 10 000).
VOTE_BIN_EDGES = (100, 200, 500, 1_000, 2_000, 5_000, 10_000)
MIN_FILMS_PER_BIN = 30
MIN_NEIGHBOURS = 3  # D3
MIN_CONTENT_TOKENS = 2  # D3: director, cast or keyword tokens known to the content model
RATING_BIN_EDGES = (5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0)  # Bayesian TMDB rating (D2 feature)


# --- D1c norm ------------------------------------------------------------------------------------


# Alternative bins on the slider popularity (R3 comparison): the caps of the slider.
POPULARITY_BIN_EDGES = (200, 500, 1_000, 2_000, 5_000, 10_000, 20_000)


def vote_bins(votes, edges=VOTE_BIN_EDGES) -> np.ndarray:
    return np.searchsorted(edges, np.asarray(votes, dtype=np.float64), side="right")


def norm_table(
    votes, norms, min_films: int = MIN_FILMS_PER_BIN, edges=VOTE_BIN_EDGES
) -> np.ndarray:
    """Median norm per bin of `votes` (TMDB votes, or any count with `edges`); a bin with
    < min_films films takes the nearest valid bin (the lower one on a tie)."""
    b = vote_bins(votes, edges)
    norms = np.asarray(norms, dtype=np.float64)
    n_bins = len(edges) + 1
    med = np.full(n_bins, np.nan)
    for i in range(n_bins):
        sel = b == i
        if sel.sum() >= min_films:
            med[i] = float(np.median(norms[sel]))
    valid = np.flatnonzero(~np.isnan(med))
    if len(valid) == 0:
        raise ValueError("aucune tranche de votes assez fournie")
    for i in np.flatnonzero(np.isnan(med)):
        med[i] = med[valid[np.argmin(np.abs(valid - i) * 2 + (valid > i))]]
    return med


def target_norms(votes, table: np.ndarray, edges=VOTE_BIN_EDGES) -> np.ndarray:
    return table[vote_bins(votes, edges)]


# --- D4 quality ----------------------------------------------------------------------------------


def bayes_rating(average, votes, m: float, c: float) -> np.ndarray:
    """(v R + m C) / (v + m); a missing average counts as C."""
    r = np.nan_to_num(np.asarray(average, dtype=np.float64), nan=c)
    v = np.asarray(votes, dtype=np.float64)
    return (v * r + m * c) / (v + m)


# --- D2 content ----------------------------------------------------------------------------------


def film_tokens(f: dict, *, m: float = 200.0, c: float = 6.5) -> list[str]:
    """Sparse features of one TMDB film (dict with the columns of tmdb_films.parquet)."""
    toks = [f"d:{i}" for i in f.get("director_ids") or []]
    toks += [f"c:{i}" for i in (f.get("cast") or [])[:5]]
    toks += [f"g:{i}" for i in f.get("genres") or []]
    toks += [f"k:{i}" for i in f.get("keywords") or []]
    if f.get("original_language"):
        toks.append(f"l:{f['original_language']}")
    toks += [f"o:{x}" for x in f.get("origin_country") or []]
    if f.get("year"):
        toks.append(f"y:{int(f['year']) // 10 * 10}")
    votes = f.get("vote_count") or 0
    toks.append(f"v:{int(vote_bins([votes])[0])}")
    r = float(bayes_rating([f.get("vote_average")], [votes], m, c)[0])
    toks.append(f"r:{int(np.searchsorted(RATING_BIN_EDGES, r, side='right'))}")
    return list(dict.fromkeys(toks))


TELLING_PREFIXES = ("d:", "c:", "k:")


@dataclass
class ContentModel:
    vocab: dict[str, int]
    weights: np.ndarray  # (n_features + 1, dims), last row = intercept
    lam: float

    def features(self, films: list[dict]) -> tuple[sp.csr_matrix, np.ndarray]:
        """(X, telling): X with the intercept column; telling = number of known telling tokens."""
        return features(films, self.vocab)

    def predict(self, films: list[dict]) -> tuple[np.ndarray, np.ndarray]:
        X, telling = self.features(films)
        return np.asarray(X @ self.weights), telling


def build_vocab(films: list[dict], min_count: int = 3) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in films:
        for t in film_tokens(f):
            counts[t] = counts.get(t, 0) + 1
    kept = sorted(t for t, n in counts.items() if n >= min_count)
    return {t: i for i, t in enumerate(kept)}


def features(films: list[dict], vocab: dict[str, int]) -> tuple[sp.csr_matrix, np.ndarray]:
    rows, cols, telling = [], [], np.zeros(len(films), dtype=np.int64)
    n = len(vocab)
    for r, f in enumerate(films):
        for t in film_tokens(f):
            j = vocab.get(t)
            if j is not None:
                rows.append(r)
                cols.append(j)
                telling[r] += t.startswith(TELLING_PREFIXES)
        rows.append(r)
        cols.append(n)  # intercept
    X = sp.csr_matrix(
        (np.ones(len(rows)), (rows, cols)), shape=(len(films), n + 1), dtype=np.float64
    )
    return X, telling


def fit_content(
    films: list[dict],
    targets: np.ndarray,
    sample_weight: np.ndarray,
    lam: float,
    vocab: dict[str, int] | None = None,
) -> ContentModel:
    """Ridge regression (one lsqr per output dimension); the intercept is penalised too, which
    is harmless with centred targets."""
    vocab = build_vocab(films) if vocab is None else vocab
    X, _ = features(films, vocab)
    sw = np.sqrt(np.asarray(sample_weight, dtype=np.float64))
    Xw = sp.diags(sw) @ X
    T = np.asarray(targets, dtype=np.float64)
    W = np.zeros((X.shape[1], T.shape[1]))
    for j in range(T.shape[1]):
        W[:, j] = lsqr(Xw, sw * T[:, j], damp=np.sqrt(lam), atol=1e-8, btol=1e-8, iter_lim=2000)[0]
    return ContentModel(vocab, W, lam)


# --- D1 + D3 placement ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Params:
    k: int = 5
    gamma: float = 0.5  # weight of a neighbour that is itself estimated
    s: float = 1.0  # shrinkage of the neighbour offset
    kappa: float = 3.0  # D3: alpha = n / (n + kappa)
    use_neighbours: bool = True
    use_content: bool = True
    chronological: bool = True
    rescale: bool = True


@dataclass
class Placed:
    vectors: dict[int, np.ndarray] = field(default_factory=dict)
    info: dict[int, dict] = field(default_factory=dict)


def place(
    films: list[dict],
    known: dict[int, np.ndarray],
    mu: np.ndarray,
    params: Params,
    content: dict[int, np.ndarray] | None = None,
    telling: dict[int, int] | None = None,
) -> Placed:
    """Place `films` (dicts: key, release_date, neighbours, target_norm), in chronological order.

    `known`: trained vectors by key; `content`: centred content predictions by key; `telling`:
    number of telling content tokens by key. Returns the vectors and, per film, the number of
    neighbours used, their weight n, alpha, depth (0 = only trained neighbours) and whether it
    was placed.
    """
    content = content or {}
    telling = telling or {}
    out = Placed()
    order = sorted(films, key=lambda f: (f.get("release_date") or "", f["key"]))
    for f in order:
        key = f["key"]
        vecs, wts, depth = [], [], 0
        if params.use_neighbours:
            for nb in f.get("neighbours") or []:
                if len(vecs) >= params.k:
                    break
                if nb in known:
                    vecs.append(known[nb])
                    wts.append(1.0)
                elif params.chronological and nb in out.vectors:
                    vecs.append(out.vectors[nb])
                    wts.append(params.gamma)
                    depth = max(depth, out.info[nb]["depth"] + 1)
        n = float(sum(wts))
        tell = telling.get(key, 0) >= MIN_CONTENT_TOKENS and params.use_content
        if len(vecs) < MIN_NEIGHBOURS and not tell:
            out.info[key] = {"placed": False, "n_neighbours": len(vecs), "n": n, "depth": depth}
            continue
        if vecs:
            w = np.asarray(wts) / np.arange(1, len(vecs) + 1)
            offset = params.s * ((np.asarray(vecs) - mu) * w[:, None]).sum(0) / w.sum()
        else:
            offset = np.zeros_like(mu)
        if not params.use_content:
            alpha = 1.0
        elif not vecs:
            alpha = 0.0
        else:
            alpha = n / (n + params.kappa)
        c = content.get(key)
        mix = alpha * offset + (1.0 - alpha) * (np.zeros_like(mu) if c is None else c)
        v = mu + mix
        if params.rescale:
            v = v * (f["target_norm"] / max(np.linalg.norm(v), 1e-12))
        out.vectors[key] = v
        out.info[key] = {
            "placed": True,
            "n_neighbours": len(vecs),
            "n": n,
            "alpha": alpha,
            "depth": depth,
        }
    return out


def popularity_floor(mu: np.ndarray, target_norm: float) -> np.ndarray:
    """Reference without any taste: the mean direction at the target norm (ranks by votes)."""
    return mu * (target_norm / np.linalg.norm(mu))


# --- D6 weighted fold-in -------------------------------------------------------------------------


def fold_in_weighted(
    Y: np.ndarray,  # noqa: N803
    items: np.ndarray,
    r: np.ndarray,
    omega: np.ndarray,
    *,
    regularization: float,
    alpha: float,
    yty: np.ndarray,
) -> np.ndarray:
    """One user: (YᵀY + reg I + Σ ω (c - 1) y yᵀ) x = Σ ω c y, c = alpha r (float64).
    ω = 1 everywhere is `als.fold_in`; ω = 0 leaves a film out."""
    Yu = np.asarray(Y, dtype=np.float64)[items]
    c = alpha * np.asarray(r, dtype=np.float64)
    om = np.asarray(omega, dtype=np.float64)
    A = yty + regularization * np.eye(Yu.shape[1]) + (Yu.T * (om * (c - 1.0))) @ Yu
    return np.linalg.solve(A, Yu.T @ (om * c))


# --- D7 popularity -------------------------------------------------------------------------------


def within_year_percentile(votes, years) -> np.ndarray:
    """Average-rank percentile of each film's votes among the films of its year, in [0, 1]."""
    v = np.asarray(votes, dtype=np.float64)
    y = np.asarray(years)
    out = np.zeros(len(v))
    for year in np.unique(y):
        sel = np.flatnonzero(y == year)
        if len(sel) == 1:
            out[sel] = 0.5
            continue
        order = v[sel].argsort(kind="stable")
        ranks = np.empty(len(sel))
        ranks[order] = np.arange(len(sel))
        # average ranks of ties
        vals = v[sel]
        for val in np.unique(vals):
            t = vals == val
            ranks[t] = ranks[t].mean()
        out[sel] = ranks / (len(sel) - 1)
    return out


def rank_popularity(percentiles, reference_popularity, votes, r_ref: float) -> np.ndarray:
    """Popularity at the same percentile of the reference distribution, >= r_ref * votes."""
    ref = np.sort(np.asarray(reference_popularity, dtype=np.float64))
    q = np.quantile(ref, np.clip(np.asarray(percentiles, dtype=np.float64), 0.0, 1.0))
    floor = np.rint(r_ref * np.asarray(votes, dtype=np.float64))
    return np.maximum(np.rint(q), floor).astype(np.int64)
