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
