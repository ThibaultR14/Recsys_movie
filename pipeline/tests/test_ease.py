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


def test_lapack_runs_with_one_blas_thread(monkeypatch):
    # multithreaded OpenBLAS segfaults in dpotrf on 23 019 x 23 019 (Colab): must be single-threaded
    from threadpoolctl import threadpool_info, threadpool_limits

    def blas_threads():
        return sorted({p["num_threads"] for p in threadpool_info() if p["user_api"] == "blas"})

    seen = {}
    real_potrf, real_potri = ease.lapack.dpotrf, ease.lapack.dpotri

    def spy(name, real):
        def wrapper(*args, **kwargs):
            seen[name] = blas_threads()
            return real(*args, **kwargs)

        return wrapper

    monkeypatch.setattr(ease.lapack, "dpotrf", spy("dpotrf", real_potrf))
    monkeypatch.setattr(ease.lapack, "dpotri", spy("dpotri", real_potri))
    X = sp.random(40, 9, density=0.4, random_state=4, format="csr")
    with threadpool_limits(limits=2, user_api="blas"):  # outside: several threads allowed
        before = blas_threads()
        B = ease.fit(X, lam=2.0)
        after = blas_threads()
    assert before, "no BLAS library found by threadpoolctl"
    assert seen == {"dpotrf": [1], "dpotri": [1]}
    assert after == before  # the limit is lifted once the inversion is done
    assert B == pytest.approx(ease.fit_dense_reference(X.toarray(), 2.0), abs=1e-6)
