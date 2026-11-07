import numpy as np
import polars as pl
import pytest
import scipy.sparse as sp

import evaluate as ev
import slider


def test_lambda_grid():
    assert slider.LAMBDAS[0] == -0.5 and slider.LAMBDAS[-1] == 2.0
    assert len(slider.LAMBDAS) == 26 and 0.0 in slider.LAMBDAS and 1.0 in slider.LAMBDAS


def test_popularity_z_uses_recommendable_only():
    pop = np.array([0.0, np.e - 1, np.e**2 - 1, 1e9])  # log1p = 0, 1, 2, ~20.7
    rec = np.array([True, True, True, False])
    z = slider.popularity_z(pop, rec)
    # mean 1, std sqrt(2/3) over the first three
    assert z[:3] == pytest.approx(np.array([-1, 0, 1]) / np.sqrt(2 / 3), rel=1e-6)
    assert z[:3].mean() == pytest.approx(0, abs=1e-6)


def test_tmdb_missing_gets_smallest_observed():
    cat = pl.DataFrame({"item_idx": [1, 0, 2], "tmdb_vote_count": [5, None, 3]})
    assert slider.tmdb_popularity(cat).tolist() == [3.0, 5.0, 3.0]


def test_standardize_rows_by_hand():
    scores = np.array([[1.0, 2.0, 3.0, 100.0], [4.0, 4.0, 0.0, 0.0]], dtype=np.float32)
    mask = np.array([[True, True, True, False], [True, True, False, False]])
    s = slider.standardize_rows(scores, mask)
    # row 0: mean 2, population std sqrt(2/3); 100 is not a candidate
    assert s[0, :3] == pytest.approx(np.array([-1, 0, 1]) / np.sqrt(2 / 3), rel=1e-6)
    assert s[0, 3] == -np.inf
    assert s[1, :2].tolist() == [0.0, 0.0]  # zero spread
    assert np.isneginf(s[1, 2:]).all()


def test_candidate_mask_excludes_foldin_and_non_recommendable():
    foldin = sp.csr_matrix(np.array([[1, 0, 0, 0], [0, 0, 1, 0]], dtype=np.float32))
    rec = np.array([True, True, True, False])
    mask = slider.candidate_mask(foldin, rec)
    assert mask.tolist() == [[False, True, True, False], [True, True, False, False]]


def test_lambda_zero_keeps_model_order_and_lambda_moves_to_unpopular():
    rng = np.random.default_rng(0)
    n_users, n_items = 30, 50
    scores = rng.normal(size=(n_users, n_items)).astype(np.float32) * 7 + 3
    foldin = sp.random(n_users, n_items, density=0.1, random_state=1, format="csr")
    rec = np.ones(n_items, dtype=bool)
    rec[:3] = False
    z = slider.popularity_z(rng.integers(1, 10_000, n_items), rec)
    std = slider.standardize_rows(scores, slider.candidate_mask(foldin, rec))
    base = ev.top_k(scores.copy(), foldin, rec, 10)
    assert (ev.top_k(slider.rerank(std, z, 0.0), foldin, rec, 10) == base).all()
    mean_z = {
        lam: z[ev.top_k(slider.rerank(std, z, lam), foldin, rec, 10)].mean()
        for lam in (-0.5, 0.0, 1.0, 2.0)
    }
    assert mean_z[-0.5] > mean_z[0.0] > mean_z[1.0] > mean_z[2.0]
