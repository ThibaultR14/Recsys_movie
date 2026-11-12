import numpy as np
import pytest
import scipy.sparse as sp

from models import als
from models import coldstart as cs


def test_vote_bins_edges():
    assert cs.vote_bins([50, 99, 100, 199, 200, 9_999, 10_000, 10**6]).tolist() == [
        0,
        0,
        1,
        1,
        2,
        6,
        7,
        7,
    ]


def test_norm_table_fills_small_bins_with_nearest_lower_on_tie():
    votes = [60] * 30 + [300] * 30  # bins 0 and 2 filled, bin 1 empty (tie -> lower = bin 0)
    norms = [1.0] * 30 + [3.0] * 30
    t = cs.norm_table(votes, norms)
    assert t[0] == 1.0 and t[2] == 3.0
    assert t[1] == 1.0  # tie between bins 0 and 2: the lower one
    assert t[7] == 3.0  # nearest valid bin
    assert cs.target_norms([150, 5_000], t).tolist() == [1.0, 3.0]


def test_norm_table_needs_a_valid_bin():
    with pytest.raises(ValueError):
        cs.norm_table([60] * 5, [1.0] * 5)


def test_bayes_rating():
    r = cs.bayes_rating([8.0, np.nan, 4.0], [200, 10, 0], m=200, c=6.0)
    assert r.tolist() == pytest.approx([7.0, 6.0, 6.0])


def test_film_tokens_and_vocab():
    f = {
        "director_ids": [1],
        "cast": [10, 11, 12, 13, 14, 15],
        "genres": [18],
        "keywords": [7],
        "original_language": "fr",
        "origin_country": ["FR"],
        "year": 2024,
        "vote_count": 150,
        "vote_average": 7.0,
    }
    toks = cs.film_tokens(f)
    assert "c:15" not in toks and "c:14" in toks  # 5 first actors
    assert {"d:1", "g:18", "k:7", "l:fr", "o:FR", "y:2020", "v:1"} <= set(toks)
    vocab = cs.build_vocab([f, f, {"director_ids": [2]}], min_count=2)
    assert "d:1" in vocab and "d:2" not in vocab
    X, telling = cs.features([f, {"director_ids": [2]}], vocab)
    assert X.shape == (2, len(vocab) + 1)
    assert X[:, -1].toarray().ravel().tolist() == [1.0, 1.0]  # intercept
    assert telling.tolist() == [7, 0]  # d:1, 5 actors, k:7


def test_fit_content_recovers_a_linear_map():
    rng = np.random.default_rng(0)
    films = [
        {"director_ids": [int(rng.integers(5))], "genres": [int(rng.integers(3))]}
        for _ in range(300)
    ]
    vocab = cs.build_vocab(films, min_count=1)
    X, _ = cs.features(films, vocab)
    W = rng.normal(size=(X.shape[1], 4))
    T = np.asarray(X @ W)
    m = cs.fit_content(films, T, np.ones(len(films)), lam=1e-6, vocab=vocab)
    pred, _ = m.predict(films)
    assert np.abs(pred - T).max() < 1e-3


def _film(key, date, nbs, norm=1.0):
    return {"key": key, "release_date": date, "neighbours": nbs, "target_norm": norm}


def test_place_neighbours_rank_weights_and_rescale():
    mu = np.zeros(2)
    known = {1: np.array([1.0, 0.0]), 2: np.array([0.0, 1.0]), 3: np.array([0.0, 1.0])}
    p = cs.Params(k=5, use_content=False, rescale=False)
    out = cs.place([_film(10, "2024-01-01", [1, 2, 3, 99])], known, mu, p)
    w = np.array([1, 1 / 2, 1 / 3])
    expected = (np.array([[1, 0], [0, 1], [0, 1]]) * w[:, None]).sum(0) / w.sum()
    assert np.allclose(out.vectors[10], expected)
    assert out.info[10]["n_neighbours"] == 3 and out.info[10]["depth"] == 0
    p2 = cs.Params(k=5, use_content=False, rescale=True)
    out2 = cs.place([_film(10, "2024-01-01", [1, 2, 3], norm=2.0)], known, mu, p2)
    assert np.linalg.norm(out2.vectors[10]) == pytest.approx(2.0)


def test_place_chronological_uses_earlier_films_with_gamma():
    mu = np.zeros(2)
    known = {1: np.array([1.0, 0.0]), 2: np.array([1.0, 0.0]), 3: np.array([1.0, 0.0])}
    films = [
        _film(20, "2025-01-01", [10, 1, 2]),  # 10 is placed before (2024)
        _film(10, "2024-01-01", [1, 2, 3]),
    ]
    p = cs.Params(k=3, gamma=0.5, use_content=False, rescale=False)
    out = cs.place(films, known, mu, p)
    assert out.info[20]["depth"] == 1 and out.info[20]["n"] == pytest.approx(2.5)
    p_off = cs.Params(k=3, use_content=False, rescale=False, chronological=False)
    out_off = cs.place(films, known, mu, p_off)
    assert not out_off.info[20]["placed"]  # only 2 trained neighbours
    later = cs.place([_film(10, "2026-01-01", [20, 1, 2, 3]), films[0]], known, mu, p)
    assert later.info[10]["depth"] == 0  # 20 (2025, 2 trained neighbours) was not placed


def test_place_mix_and_not_placed():
    mu = np.array([1.0, 1.0])
    known = {1: np.array([3.0, 1.0]), 2: np.array([3.0, 1.0]), 3: np.array([3.0, 1.0])}
    content = {10: np.array([0.0, 4.0])}
    p = cs.Params(k=3, kappa=3.0, s=1.0, rescale=False)
    out = cs.place([_film(10, "2024", [1, 2, 3])], known, mu, p, content, {10: 5})
    # alpha = 3 / (3 + 3) = 0.5 ; offset neighbours = (2, 0) ; content = (0, 4)
    assert np.allclose(out.vectors[10], mu + 0.5 * np.array([2.0, 0.0]) + 0.5 * np.array([0, 4]))
    none = cs.place([_film(11, "2024", [1])], known, mu, p, {}, {11: 1})
    assert not none.info[11]["placed"]
    content_only = cs.place([_film(12, "2024", [])], known, mu, p, {12: np.ones(2)}, {12: 2})
    assert np.allclose(content_only.vectors[12], mu + 1.0)


def test_fold_in_weighted_matches_als_and_omega_zero_drops():
    rng = np.random.default_rng(1)
    Y = rng.normal(size=(30, 4)).astype(np.float32)
    yty = Y.astype(np.float64).T @ Y.astype(np.float64)
    items = np.array([2, 5, 9])
    r = np.array([1.5, 2.0, 1.0])
    signal = sp.csr_matrix((r, ([0, 0, 0], items)), shape=(1, 30))
    ref = als.fold_in(Y, signal, regularization=0.05, alpha=1.0, yty=yty)[0]
    x = cs.fold_in_weighted(Y, items, r, np.ones(3), regularization=0.05, alpha=1.0, yty=yty)
    assert np.allclose(x, ref, atol=1e-12)
    x0 = cs.fold_in_weighted(
        Y, items, r, np.array([1, 0, 1]), regularization=0.05, alpha=1.0, yty=yty
    )
    keep = sp.csr_matrix((r[[0, 2]], ([0, 0], items[[0, 2]])), shape=(1, 30))
    assert np.allclose(x0, als.fold_in(Y, keep, regularization=0.05, alpha=1.0, yty=yty)[0])


def test_within_year_percentile_and_rank_popularity():
    p = cs.within_year_percentile([10, 20, 30, 20, 5], [2024, 2024, 2024, 2024, 2025])
    assert p.tolist() == pytest.approx([0.0, 0.5, 1.0, 0.5, 0.5])
    pop = cs.rank_popularity([0.0, 1.0, 0.5], [100, 200, 300], [10, 10, 2_000], r_ref=0.285)
    assert pop.tolist() == [100, 300, 570]  # floor 0.285 x 2000 = 570 > median 200


def test_popularity_floor_norm():
    v = cs.popularity_floor(np.array([3.0, 4.0]), 10.0)
    assert np.allclose(v, [6.0, 8.0])


def test_absolute_rank_popularity():
    by_rank = cs.reference_by_rank([[10, 30, 20], [40, 5], [25, 35, 15]])
    assert by_rank.tolist() == [35.0, 20.0, 10.0]  # medians of the 1st, 2nd, 3rd (missing = 0)
    pop = cs.absolute_rank_popularity([0, 2, 9], by_rank, [10, 10, 1_000], r_ref=0.285)
    assert pop.tolist() == [35, 10, 285]  # beyond the reference: last value, then the floor
