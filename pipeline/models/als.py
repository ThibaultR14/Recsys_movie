"""ALS (implicit 0.7.x): signal, training, NumPy fold-in, scores (step 2, D2 and D4).

Signal (D2): every rated/watched movie is a positive. r_ui = 1 + beta * p_ui, with p_ui the
percentile of the rating in the user's own history: p = (average_rank - 1) / (n - 1), 0.5 if n = 1.

Confidence, as implemented by implicit 0.7.3 (`implicit/cpu/als.py`, `fit` / `recalculate_user`,
and the pure-Python reference `user_linear_equation` in the same file): the matrix values are
multiplied by alpha, C_ui = alpha * r_ui, P_ui = 1 on stored entries; unobserved entries have
C = 1, P = 0. The user vector solves

    (YᵀY + reg * I + Σ_i (C_ui - 1) y_i y_iᵀ) x_u = Σ_i C_ui y_i      (sums over the user's movies)

with no scaling of `reg` by the number of interactions. `fold_in` below reproduces exactly that.

This module never sets thread environment variables: callers (train.py) must set
OPENBLAS_NUM_THREADS=1 and MKL_NUM_THREADS=1 before NumPy is imported.
"""

from __future__ import annotations

import numpy as np
import polars as pl
import scipy.sparse as sp

from config import SEED


def percentile_values(ratings: sp.csr_matrix) -> sp.csr_matrix:
    """Same sparsity as `ratings`, values = within-row percentile of the rating (D2)."""
    ratings = ratings.tocsr()
    ratings.sort_indices()
    rows = np.repeat(np.arange(ratings.shape[0], dtype=np.int32), np.diff(ratings.indptr))
    df = pl.DataFrame({"row": rows, "r": ratings.data.astype(np.float64)})
    n = pl.len().over("row")
    p = (
        df.select(
            pl.when(n > 1)
            .then((pl.col("r").rank("average").over("row") - 1) / (n - 1))
            .otherwise(0.5)
        )
        .to_series()
        .to_numpy()
        .astype(np.float32)
    )
    return sp.csr_matrix((p, ratings.indices.copy(), ratings.indptr.copy()), shape=ratings.shape)


def signal_values(ratings: sp.csr_matrix, beta: float) -> sp.csr_matrix:
    """r_ui = 1 + beta * p_ui (always >= 1, never an explicit zero)."""
    p = percentile_values(ratings)
    p.data = (1.0 + beta * p.data).astype(np.float32)
    return p


def train(
    signal: sp.csr_matrix,
    *,
    factors: int,
    regularization: float,
    alpha: float,
    iterations: int,
    seed: int = SEED,
    show_progress: bool = False,
):
    """Fit implicit's ALS on the (users x items) signal matrix. Returns the fitted model."""
    from implicit.cpu.als import AlternatingLeastSquares

    model = AlternatingLeastSquares(
        factors=factors,
        regularization=regularization,
        alpha=alpha,
        iterations=iterations,
        random_state=seed,
        dtype=np.float32,
    )
    model.fit(signal, show_progress=show_progress)
    return model


def kept_for_foldin(
    percentiles: np.ndarray,
    rated: np.ndarray | None,
    *,
    drop_below: float | None,
    min_kept: int,
) -> np.ndarray:
    """Films of ONE user kept in the fold-in (step 6c, D2): every film, except the rated ones whose
    percentile is < drop_below (strict; ties share their percentile, so a group of equal ratings is
    dropped or kept as a whole). Unrated films (p = 0.5) are never dropped. If fewer than
    `min_kept` films would remain, every film is kept. Percentiles are compared in float64, as the
    TypeScript engine does with its float32-rounded percentiles."""
    keep = np.ones(len(percentiles), dtype=bool)
    if drop_below is None:
        return keep
    is_rated = np.ones(len(percentiles), dtype=bool) if rated is None else rated
    keep = ~(is_rated & (np.asarray(percentiles, dtype=np.float64) < drop_below))
    if keep.sum() < min_kept:
        return np.ones(len(percentiles), dtype=bool)
    return keep


def fold_in(
    item_factors: np.ndarray,
    signal: sp.csr_matrix,
    *,
    regularization: float,
    alpha: float,
    yty: np.ndarray | None = None,
) -> np.ndarray:
    """User vectors for new users (rows of `signal`, values r_ui), computed in float64.

    Reference implementation for the TypeScript fold-in (step 4).
    """
    Y = item_factors.astype(np.float64)
    if yty is None:
        yty = Y.T @ Y
    base = yty + regularization * np.eye(Y.shape[1])
    signal = signal.tocsr()
    X = np.zeros((signal.shape[0], Y.shape[1]))
    for u in range(signal.shape[0]):
        lo, hi = signal.indptr[u], signal.indptr[u + 1]
        if lo == hi:
            continue
        Yu = Y[signal.indices[lo:hi]]
        c = alpha * signal.data[lo:hi].astype(np.float64)
        A = base + (Yu.T * (c - 1.0)) @ Yu
        X[u] = np.linalg.solve(A, Yu.T @ c)
    return X


class ALSModel:
    """Adapter for evaluate.py: fold-in from the batch's ratings, then x_u · Y."""

    def __init__(self, item_factors, *, regularization, alpha, beta, name="als"):
        self.Y = np.asarray(item_factors, dtype=np.float32)
        self.yty = self.Y.astype(np.float64).T @ self.Y.astype(np.float64)
        self.regularization = regularization
        self.alpha = alpha
        self.beta = beta
        self.name = name

    def user_factors(self, foldin_ratings: sp.csr_matrix) -> np.ndarray:
        signal = signal_values(foldin_ratings, self.beta)
        return fold_in(
            self.Y, signal, regularization=self.regularization, alpha=self.alpha, yty=self.yty
        )

    def scores(self, foldin_ratings: sp.csr_matrix) -> np.ndarray:
        return (self.user_factors(foldin_ratings).astype(np.float32)) @ self.Y.T
