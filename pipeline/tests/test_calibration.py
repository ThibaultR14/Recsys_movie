import numpy as np

import calibration as cal

# 3 genres; items 0-3 genre 0 (best scores), items 4-5 genre 1, item 6 without genre
G = np.zeros((7, 3))
G[0:4, 0] = 1.0
G[4:6, 1] = 1.0
POOL = np.array([[0, 1, 2, 3, 4, 5, 6]])
SCORES = np.array([[1.0, 0.99, 0.98, 0.97, 0.9, 0.89, 0.95]])


def test_lambda_zero_keeps_the_model_order():
    P = np.array([[0.5, 0.5, 0.0]])
    out = cal.calibrate_batch(POOL, SCORES, P, G, 0.0, n=7)
    assert out.tolist() == [[0, 1, 2, 3, 6, 4, 5]]  # score order


def test_strong_lambda_follows_the_profile():
    P = np.array([[0.5, 0.5, 0.0]])
    pool, scores = POOL[:, :6], SCORES[:, :6]  # without the film without genre
    out = cal.calibrate_batch(pool, scores, P, G, 0.99, n=4)
    assert sorted(out[0].tolist()) == [0, 1, 4, 5]  # half genre 1, as the profile
    # once the genres match the profile, a film without genre keeps them matched (Q1)
    out = cal.calibrate_batch(POOL, SCORES, P, G, 0.99, n=3)
    assert out.tolist() == [[0, 4, 6]]


def test_no_genre_film_leaves_the_distribution_unchanged():
    # profile all genre 0: a film without genre neither helps nor hurts calibration
    P = np.array([[1.0, 0.0, 0.0]])
    out = cal.calibrate_batch(POOL, SCORES, P, G, 0.99, n=5)
    assert 4 not in out[0] and 5 not in out[0]
    assert cal.profile(G, np.array([0, 6]), np.array([1.0, 1.0])).tolist() == [1.0, 0.0, 0.0]


def test_pool_shorter_than_the_list():
    pools = np.array([[0, 4, -1]])
    out = cal.calibrate_batch(
        pools, np.array([[1.0, 0.5, -np.inf]]), np.array([[0.5, 0.5, 0]]), G, 0.5, n=3
    )
    assert out.tolist() == [[0, 4, -1]]


def test_share_mode_targets_the_share_of_films():
    # films 0-3: Animation + 3 other genres (1/4 each in mass mode); 4-7: Drama only
    Gm = np.zeros((8, 5))
    Gm[0:4, :4] = 0.25
    Gm[4:8, 4] = 1.0
    Gs = (Gm > 0).astype(float)
    pool = np.array([[0, 1, 2, 3, 4, 5, 6, 7]])
    scores = np.array([[1.0, 0.99, 0.98, 0.97, 0.8, 0.79, 0.78, 0.77]])
    # profile: 25 % of the films are animation films
    hist = np.array([0, 4, 5, 6])
    Ps = cal.profile(Gs, hist, np.ones(4), "share")[None, :]
    assert Ps[0, 0] == 0.25 and Ps[0, 4] == 0.75
    out = cal.calibrate_batch(pool, scores, Ps, Gs, 0.99, n=4, mode="share")
    assert sum(i < 4 for i in out[0]) == 1  # one animation film out of 4, as the profile
