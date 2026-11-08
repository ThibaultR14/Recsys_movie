import numpy as np
import pytest
import scipy.sparse as sp

from models import als


def csr(rows):
    return sp.csr_matrix(np.array(rows, dtype=np.float32))


def test_percentiles_hand_example():
    # user 0: ratings 2, 4, 4, 5 -> average ranks 1, 2.5, 2.5, 4 -> p = 0, 0.5, 0.5, 1
    # user 1: a single rating -> 0.5
    p = als.percentile_values(csr([[2, 4, 4, 5, 0], [0, 0, 0, 0, 3]]))
    assert p[0].toarray().ravel().tolist() == pytest.approx([0, 0.5, 0.5, 1, 0])
    assert p[1].data.tolist() == [0.5]


def test_signal_never_zero():
    s = als.signal_values(csr([[1, 0, 5], [3, 3, 0]]), beta=3)
    assert s.nnz == 4
    assert s[0].data.tolist() == pytest.approx([1.0, 4.0])
    assert s[1].data.tolist() == pytest.approx([2.5, 2.5])  # ties: p = 0.5 each


def test_fold_in_matches_implicit_reference():
    from implicit.cpu.als import user_linear_equation

    rng = np.random.default_rng(0)
    Y = rng.normal(size=(30, 8))
    signal = sp.random(5, 30, density=0.3, random_state=1, format="csr", dtype=np.float64)
    signal.data = 1 + 3 * signal.data
    reg, alpha = 0.1, 7.0
    X = als.fold_in(Y, signal, regularization=reg, alpha=alpha)
    for u in range(5):
        A, b = user_linear_equation(Y, Y.T @ Y, alpha * signal, u, reg, 8)
        assert X[u] == pytest.approx(np.linalg.solve(A, b), rel=1e-9, abs=1e-12)


def test_fold_in_closed_form_single_item():
    # one item y, confidence c: (yyᵀ + reg I + (c - 1) yyᵀ) x = c y -> x = c y / (c |y|² + reg)
    Y = np.array([[2.0, 0.0], [0.0, 1.0]])
    signal = sp.csr_matrix(([1.5], ([0], [0])), shape=(1, 2))
    x = als.fold_in(Y, signal, regularization=0.5, alpha=2.0)
    c = 3.0
    assert x[0, 0] == pytest.approx(c * 2 / (c * 4 + 1 * 0 + 0.5))
    assert x[0, 1] == pytest.approx(0.0)


def test_fold_in_empty_user_is_zero():
    X = als.fold_in(np.ones((3, 2)), sp.csr_matrix((1, 3)), regularization=1, alpha=1)
    assert (X == 0).all()


# --- step 6c (D2): disliked films out of the fold-in ---------------------------------------------


def _p(ratings):
    r = sp.csr_matrix(np.array([ratings], dtype=np.float32))
    return als.percentile_values(r).data


def test_kept_for_foldin_ties_and_exact_threshold():
    p = _p([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])  # 0.05, 0.05, 0.2, 0.3 (float32), 0.4 …
    keep = als.kept_for_foldin(p, None, drop_below=0.3, min_kept=5)
    assert keep.tolist() == [False, False, False] + [True] * 8  # 0.3 exactly: kept (strict <)
    # a tie group straddling the threshold is dropped or kept as a whole
    p = _p([1, 2, 2, 2, 3, 4, 5, 6, 7, 8])  # ranks 2-4 share p = 2/9 ≈ 0.22
    keep = als.kept_for_foldin(p, None, drop_below=0.3, min_kept=5)
    assert keep[:4].tolist() == [False, False, False, False] and keep[4:].all()


def test_kept_for_foldin_unrated_never_dropped_and_guard():
    p = np.array([0.0, 0.1, 0.5, 0.5, 0.8, 0.9, 1.0], dtype=np.float32)
    rated = np.array([True, True, False, False, True, True, True])
    assert als.kept_for_foldin(p, rated, drop_below=0.6, min_kept=5).tolist() == [
        False,
        False,
        True,
        True,
        True,
        True,
        True,
    ]
    # dropping 2 of 6 would leave 4 < 5: everything kept
    p6 = _p([1, 2, 3, 4, 5, 6])
    assert als.kept_for_foldin(p6, None, drop_below=0.3, min_kept=5).all()
    assert als.kept_for_foldin(p6, None, drop_below=None, min_kept=5).all()
