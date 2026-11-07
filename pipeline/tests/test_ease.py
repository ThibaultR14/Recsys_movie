import numpy as np
import pytest
import scipy.sparse as sp

from models import ease


def test_two_items_by_hand():
    # X = [[1, 1], [1, 0]] -> XᵀX = [[2, 1], [1, 1]]; λ = 1 -> G = [[3, 1], [1, 2]], det 5
    # P = G⁻¹ = [[2, -1], [-1, 3]] / 5 -> B_01 = -P_01 / P_11 = 1/3, B_10 = -P_10 / P_00 = 1/2
    X = sp.csr_matrix(np.array([[1.0, 1.0], [1.0, 0.0]]))
    B = ease.fit(X, lam=1.0)
    assert B == pytest.approx(np.array([[0.0, 1 / 3], [1 / 2, 0.0]]))


def test_matches_textbook_formula_and_zero_diagonal():
    rng = np.random.default_rng(0)
    X = sp.random(200, 37, density=0.2, random_state=1, format="csr", dtype=np.float64)
    X.data = 1 + rng.random(X.nnz)
    reference = ease.fit_dense_reference(X.toarray(), 3.0)
    # exact path: float64 Gram matrix
    B64 = ease.fit_from_gram((X.T @ X).toarray(), 3.0)
    assert B64 == pytest.approx(reference, rel=1e-9, abs=1e-12)
    # production path: Gram matrix stored in float32 -> float32 rounding only
    B = ease.fit(X, lam=3.0)
    assert B.flags.f_contiguous
    assert np.diag(B) == pytest.approx(0.0)
    assert np.abs(B - reference).max() < 1e-6


def test_gram_blocks_and_symmetrize_blocks():
    rng = np.random.default_rng(2)
    X = sp.random(50, 23, density=0.3, random_state=3, format="csr")
    G = ease.gram(X, block=5)  # several blocks, last one partial
    assert G == pytest.approx((X.T @ X).toarray(), rel=1e-6)
    a = np.asfortranarray(rng.random((11, 11)))
    expected = np.triu(a) + np.triu(a, 1).T
    ease._symmetrize_from_upper(a, block=4)
    assert a == pytest.approx(expected)


def test_model_scores_use_signal():
    B = np.asfortranarray(np.array([[0.0, 2.0, 1.0], [0.5, 0.0, 0.0], [0.0, 0.0, 0.0]]))
    ratings = sp.csr_matrix(np.array([[4.0, 0.0, 2.0]], dtype=np.float32))
    # beta = 1: percentiles 1 (rating 4) and 0 (rating 2) -> signal [2, 0, 1]
    s = ease.EASEModel(B, beta=1).scores(ratings)
    assert s.dtype == np.float32
    assert s[0] == pytest.approx([0.0, 4.0, 2.0])
