"""Ranking metrics (step 2, decision D3 of docs/etape-2-modele.md).

Per-user metrics take a ranked list of item indices (best first) and return a float, or None when
the user has no relevant item (excluded from the mean, counted separately). Aggregates are means
over users with a 95 % confidence interval (1.96 x standard error).
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

Z_95 = 1.96


def recall_at_k(ranked: np.ndarray, relevant: np.ndarray, k: int) -> float | None:
    """Relevant items found in the top k / min(k, number of relevant items)."""
    n_rel = len(relevant)
    if n_rel == 0:
        return None
    hits = np.isin(ranked[:k], relevant).sum()
    return float(hits) / min(k, n_rel)


def ndcg_at_k(ranked: np.ndarray, relevant: np.ndarray, k: int) -> float | None:
    """Binary-gain NDCG: sum of 1/log2(rank + 1) over hits, divided by the ideal DCG."""
    n_rel = len(relevant)
    if n_rel == 0:
        return None
    discounts = 1.0 / np.log2(np.arange(2, k + 2))
    hits = np.isin(ranked[:k], relevant)
    dcg = float(discounts[: len(hits)][hits].sum())
    idcg = float(discounts[: min(k, n_rel)].sum())
    return dcg / idcg


def mean_log_popularity(ranked: np.ndarray, counts: np.ndarray, k: int) -> float:
    """Mean of log(1 + count) over the top k (lower = more hidden gems)."""
    return float(np.log1p(counts[ranked[:k]]).mean())


def median_popularity(ranked: np.ndarray, counts: np.ndarray, k: int) -> float:
    """Median count over the top k ("a typical movie in the list has N ratings")."""
    return float(np.median(counts[ranked[:k]]))


def long_tail_share(ranked: np.ndarray, is_head: np.ndarray, k: int) -> float:
    """Share of the top k outside the head (most popular movies)."""
    return float(1.0 - is_head[ranked[:k]].mean())


def head_mask(counts: np.ndarray, candidates: np.ndarray, share: float) -> np.ndarray:
    """Boolean mask of the `share` most popular candidates (ties broken by item index).

    The head size is round(share x number of candidates).
    """
    cand_idx = np.flatnonzero(candidates)
    n_head = int(round(share * len(cand_idx)))
    order = cand_idx[np.lexsort((cand_idx, -counts[cand_idx]))]
    mask = np.zeros(len(counts), dtype=bool)
    mask[order[:n_head]] = True
    return mask


def coverage(ranked_lists: Iterable[np.ndarray], n_candidates: int, k: int) -> float:
    """Distinct items recommended to at least one user / number of recommendable items."""
    seen: set[int] = set()
    for ranked in ranked_lists:
        seen.update(ranked[:k].tolist())
    return len(seen) / n_candidates


def mean_ci(values: Iterable[float | None]) -> dict[str, float | int]:
    """Mean, 95 % CI half-width and n over the non-None values."""
    arr = np.array([v for v in values if v is not None], dtype=np.float64)
    n = len(arr)
    if n == 0:
        return {"mean": float("nan"), "ci95": float("nan"), "n": 0}
    sem = arr.std(ddof=1) / np.sqrt(n) if n > 1 else 0.0
    return {"mean": float(arr.mean()), "ci95": float(Z_95 * sem), "n": n}
