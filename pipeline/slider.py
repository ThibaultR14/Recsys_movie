"""Slider "connu <-> pépite": re-ranking of model scores by popularity (step 2, D5).

    s_ui = model score standardised over the user's candidates (mean 0, std 1)
    z_i  = log(1 + popularity_i) standardised over all recommendable movies (computed once)
    score_ui = s_ui - lam * z_i

lam > 0 pushes less popular movies up, lam < 0 favours classics, lam = 0 keeps the model's order
(standardisation is a positive affine map per user).
"""

from __future__ import annotations

import numpy as np
import polars as pl
import scipy.sparse as sp

SOURCES = ("ml_rating_count", "tmdb_vote_count")
LAMBDAS = tuple(round(-0.5 + 0.1 * i, 1) for i in range(26))  # -0.5 .. 2.0, step 0.1


def popularity_z(popularity: np.ndarray, recommendable: np.ndarray) -> np.ndarray:
    """z_i = standardised log(1 + popularity), mean/std taken over recommendable movies only."""
    logp = np.log1p(np.asarray(popularity, dtype=np.float64))
    ref = logp[recommendable]
    return ((logp - ref.mean()) / ref.std()).astype(np.float32)


def tmdb_popularity(catalog: pl.DataFrame) -> np.ndarray:
    """`tmdb_vote_count` in item_idx order; missing -> smallest observed value (D5)."""
    cat = catalog.sort("item_idx")
    votes = cat["tmdb_vote_count"]
    return votes.fill_null(votes.min()).to_numpy().astype(np.float64)


def candidate_mask(foldin: sp.csr_matrix, recommendable: np.ndarray) -> np.ndarray:
    """(n_users, n_items) bool: recommendable and not in the user's fold-in."""
    mask = np.broadcast_to(recommendable, foldin.shape).copy()
    rows = np.repeat(np.arange(foldin.shape[0]), np.diff(foldin.indptr))
    mask[rows, foldin.indices] = False
    return mask


def standardize_rows(scores: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Per row, (score - mean) / std over the entries where `mask` is true (float64 stats).

    Entries outside the mask are set to -inf. A row with zero spread gets s = 0 on its candidates.
    """
    s = scores.astype(np.float64)
    n = mask.sum(axis=1, keepdims=True)
    masked = np.where(mask, s, 0.0)
    mean = masked.sum(axis=1, keepdims=True) / np.maximum(n, 1)
    var = (np.where(mask, s - mean, 0.0) ** 2).sum(axis=1, keepdims=True) / np.maximum(n, 1)
    std = np.sqrt(var)
    out = (s - mean) / np.where(std > 0, std, 1.0)
    out[~mask] = -np.inf
    return out.astype(np.float32)


def rerank(standardized: np.ndarray, z: np.ndarray, lam: float) -> np.ndarray:
    """score_ui = s_ui - lam * z_i (non-candidates stay at -inf)."""
    return standardized - np.float32(lam) * z[None, :]


# --- C4 complement: variants (V2 = re-rank within the model's top K, V3 = popularity cap) ---


def top_pool(scores: np.ndarray, mask: np.ndarray, size: int) -> tuple[np.ndarray, np.ndarray]:
    """Per row, the `size` best candidates by model score: (item indices, raw scores), unordered."""
    masked = np.where(mask, scores.astype(np.float32), -np.inf)
    idx = np.argpartition(-masked, size - 1, axis=1)[:, :size]
    return idx, np.take_along_axis(masked, idx, axis=1)


def standardize_pool(pool_scores: np.ndarray) -> np.ndarray:
    """Per row (mean 0, std 1) over the pool; zero spread -> 0."""
    s = pool_scores.astype(np.float64)
    mean = s.mean(axis=1, keepdims=True)
    std = s.std(axis=1, keepdims=True)
    return ((s - mean) / np.where(std > 0, std, 1.0)).astype(np.float32)


def rerank_pool(pool_idx: np.ndarray, pool_s: np.ndarray, z: np.ndarray, lam: float, k: int):
    """V2: top k of s - lam * z inside the pool, best first (item indices)."""
    v = pool_s - np.float32(lam) * z[pool_idx]
    part = np.argpartition(-v, k - 1, axis=1)[:, :k]
    order = np.argsort(-np.take_along_axis(v, part, axis=1), axis=1, kind="stable")
    return np.take_along_axis(pool_idx, np.take_along_axis(part, order, axis=1), axis=1)


def popularity_iqr(ranked: np.ndarray, counts: np.ndarray, k: int) -> dict[str, float]:
    """Regularity: spread across users of the median popularity of their top-k list."""
    med = np.median(counts[ranked[:, :k]], axis=1)
    p25, p50, p75 = np.percentile(med, [25, 50, 75])
    return {"p25": float(p25), "p50": float(p50), "p75": float(p75), "iqr": float(p75 - p25)}
