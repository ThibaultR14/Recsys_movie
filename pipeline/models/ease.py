"""EASE (Steck, 2019): precision reference for step 2 (D7). Never exported to the website.

    G = XᵀX + λ·I,   P = G⁻¹,   B = I − P · diag(1 / diag(P))   (so B_jj = 0, B_ij = −P_ij / P_jj)

X = (training users x items) signal r_ui = 1 + β·p_ui (D2), β = 0 gives the binary variant.
A user is scored with x_u · B, x_u = the same signal computed on their fold-in only.

Memory: with n = 23 019 items, one dense n x n matrix is 2.1 GB in float32, 4.2 GB in float64.
Peak use here is about G (float32, kept across λ values) + one float64 working matrix that is
factorised, inverted and turned into B in place (LAPACK potrf / potri): ~6.5 GB, plus the data.
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp
from scipy.linalg import lapack

from models.als import signal_values

GRAM_BLOCK = 2048
SYM_BLOCK = 2048


def bytes_needed(n_items: int) -> int:
    """Rough peak memory of `fit_from_gram` with a float32 Gram matrix kept alongside."""
    return n_items * n_items * (4 + 8)


def gram(X: sp.spmatrix, block: int = GRAM_BLOCK) -> np.ndarray:
    """Dense XᵀX in float32, accumulated in float64 one block of columns at a time."""
    X = sp.csc_matrix(X, dtype=np.float64)
    Xt = X.T.tocsr()
    n = X.shape[1]
    G = np.empty((n, n), dtype=np.float32)
    for j0 in range(0, n, block):
        j1 = min(n, j0 + block)
        G[:, j0:j1] = (Xt @ X[:, j0:j1]).toarray()
    return G


def _symmetrize_from_upper(a: np.ndarray, block: int = SYM_BLOCK) -> None:
    """Copy the upper triangle into the lower one, in place, without a full-size temporary."""
    n = a.shape[0]
    for i0 in range(0, n, block):
        i1 = min(n, i0 + block)
        # lower part of rows i0:i1, columns < i0: from the upper part (columns i0:i1, rows < i0)
        a[i0:i1, :i0] = a[:i0, i0:i1].T
        sub = a[i0:i1, i0:i1]
        sub[np.tril_indices(i1 - i0, -1)] = sub.T[np.tril_indices(i1 - i0, -1)]


def fit_from_gram(G: np.ndarray, lam: float) -> np.ndarray:
    """B (float64, Fortran order) from a Gram matrix XᵀX. `G` is not modified."""
    n = G.shape[0]
    work = np.empty((n, n), dtype=np.float64, order="F")
    work[...] = G
    work[np.diag_indices(n)] += lam

    c, info = lapack.dpotrf(work, lower=0, overwrite_a=1, clean=0)
    if info != 0:
        raise np.linalg.LinAlgError(f"dpotrf failed (info={info})")
    assert np.shares_memory(c, work), "dpotrf did not work in place"
    p, info = lapack.dpotri(c, lower=0, overwrite_c=1)
    if info != 0:
        raise np.linalg.LinAlgError(f"dpotri failed (info={info})")
    assert np.shares_memory(p, work), "dpotri did not work in place"
    del c, p

    _symmetrize_from_upper(work)  # work = P
    d = work.diagonal().copy()
    work /= -d[None, :]  # B_ij = -P_ij / P_jj
    work[np.diag_indices(n)] = 0.0
    return work


def fit(X: sp.spmatrix, lam: float) -> np.ndarray:
    return fit_from_gram(gram(X), lam)


def fit_dense_reference(X: np.ndarray, lam: float) -> np.ndarray:
    """Textbook formula with np.linalg.inv (tests only)."""
    G = X.T @ X + lam * np.eye(X.shape[1])
    P = np.linalg.inv(G)
    B = -P / np.diag(P)[None, :]
    np.fill_diagonal(B, 0.0)
    return B


class EASEModel:
    """Adapter for evaluate.py: scores = signal(fold-in) · B."""

    def __init__(self, B: np.ndarray, *, beta: float, name: str = "ease"):
        self.B = B
        self.beta = beta
        self.name = name

    def scores(self, foldin_ratings: sp.csr_matrix) -> np.ndarray:
        x = signal_values(foldin_ratings, self.beta).astype(np.float64)
        return np.asarray(x @ self.B, dtype=np.float32)
