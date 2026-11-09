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


def test_one_user_incremental_matches_the_batch_version():
    rng = np.random.default_rng(0)
    n_items, n_genres = 300, 6
    genres = [
        sorted(rng.choice(n_genres, rng.integers(0, 4), replace=False).tolist())
        for _ in range(n_items)
    ]
    Gs = np.zeros((n_items, n_genres))
    for i, gs in enumerate(genres):
        Gs[i, gs] = 1.0
    same = 0
    for _trial in range(40):
        pool = rng.permutation(n_items)[:60]
        scores = np.sort(rng.random(60))[::-1]
        hist = rng.choice(n_items, 30, replace=False)
        w = rng.random(30) + 1
        p = cal.share_profile_one(genres, n_genres, hist, w)
        assert np.allclose(p, cal.profile(Gs, hist, w, "share"))
        for lam in (0.0, 0.1, 0.9):
            one = cal.calibrate_one(pool, scores, p, genres, lam, 20)
            batch = cal.calibrate_batch(
                pool[None, :], scores[None, :], np.array([p]), Gs, lam, 20, "share"
            )
            same += one == batch[0].tolist()
    assert same == 120  # identical lists (no near-tie at this scale)


def test_production_table_has_one_lambda_per_slider_position():
    import export

    assert len(cal.PRODUCTION["lambda_by_position"]) == len(export.SLIDER_POSITIONS)
    assert cal.PRODUCTION["mode"] == "share" and cal.PRODUCTION["pool"] == 150


# --- D1b (Q4b): proximity penalty to the disliked films ---------------------------------------


def test_proximity_is_the_clipped_max_cosine_with_the_disliked_films():
    Y = np.array([[1.0, 0.0], [0.0, 2.0], [-1.0, 0.0], [1.0, 1.0], [0.0, 0.0]])
    unit = cal.unit_rows(Y)
    # pool 3 vs disliked {0, 1}: cos 0.707 with both; pool 2 vs {0, 1}: -1 and 0 -> 0
    out = cal.proximity([3, 2, -1, 4], [0, 1], unit)
    assert np.allclose(out, [np.sqrt(0.5), 0.0, 0.0, 0.0])
    assert cal.proximity([3, 2], [], unit).tolist() == [0.0, 0.0]  # no disliked film


def test_penalty_moves_a_film_down_and_one_user_matches_the_batch_version():
    rng = np.random.default_rng(1)
    n_items, n_genres = 200, 5
    genres = [
        sorted(rng.choice(n_genres, rng.integers(1, 3), replace=False).tolist())
        for _ in range(n_items)
    ]
    Gs = np.zeros((n_items, n_genres))
    for i, gs in enumerate(genres):
        Gs[i, gs] = 1.0
    pool = rng.permutation(n_items)[:50]
    scores = np.sort(rng.random(50))[::-1] + 1
    p = cal.share_profile_one(genres, n_genres, rng.choice(n_items, 20, replace=False), np.ones(20))
    pen = np.zeros(50)
    pen[0] = 10.0  # the best film, pushed to the bottom
    for lam in (0.0, 0.9):
        one = cal.calibrate_one(pool, scores, p, genres, lam, 49, penalty=pen)
        batch = cal.calibrate_batch(
            pool[None, :], scores[None, :], np.array([p]), Gs, lam, 49, "share", pen[None, :]
        )
        assert one == batch[0].tolist()
        assert pool[0] not in one  # the last one left out of 49 among 50
    # μ = 0 (no penalty) is the D1 list
    assert cal.calibrate_one(pool, scores, p, genres, 0.9, 20, penalty=np.zeros(50)) == (
        cal.calibrate_one(pool, scores, p, genres, 0.9, 20)
    )


def test_disliked_near_counts_the_lists_with_a_disliked_nearest_neighbour():
    Y = np.array([[1.0, 0.0], [0.0, 1.0], [1.0, 0.1], [0.1, 1.0], [0.7, 0.7]])
    unit = cal.unit_rows(Y)
    lists = np.array([[2, 3, -1]])
    # history 0, 1 ; disliked 0: film 2 has 0 among its 2 nearest (2 films), film 3 too
    assert cal.disliked_near(lists, [np.array([0, 1])], [np.array([0])], unit, near=2)[0] == 2
    # nearest only: film 2 -> 0 (disliked), film 3 -> 1
    assert cal.disliked_near(lists, [np.array([0, 1])], [np.array([0])], unit, near=1)[0] == 1
    assert cal.disliked_near(lists, [np.array([0, 1])], [np.array([], dtype=int)], unit)[0] == 0
