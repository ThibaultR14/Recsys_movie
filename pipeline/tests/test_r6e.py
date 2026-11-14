"""Step 8 (R6e): recent line of the estimated films' q, classics bonus, estimated films per row."""

import numpy as np

import calibration as cal
import export
import quality as q


def test_estimated_line_fitted_on_recent_films_only():
    rng = np.random.default_rng(0)
    n = 600
    counts = rng.integers(20, 2000, n)
    means = rng.uniform(2.0, 4.5, n)
    years = np.where(np.arange(n) < 300, 2005, 2021)
    # recent films: TMDB rating inflated by 0.6 point (out of 10)
    tmdb = 2 * means - 0.5 + np.where(years >= 2019, 0.6, 0.0) + rng.normal(0, 0.05, n)
    votes = rng.integers(60, 5000, n)
    est_avg, est_votes = np.array([7.5]), np.array([3000])
    old, info_old = q.site_quality(counts, means, tmdb, votes, est_avg, est_votes)
    new, info = q.site_quality(counts, means, tmdb, votes, est_avg, est_votes, years)
    assert info["tmdb"]["fit_from_year"] == 2019 and info["tmdb"]["fit_films"] == 300
    assert info_old["tmdb"]["fit_from_year"] is None
    assert info["tmdb"]["catalog_line"] == {
        "slope": info_old["tmdb"]["slope"],
        "intercept": info_old["tmdb"]["intercept"],
    }
    assert np.array_equal(old[:n], new[:n])  # trained films unchanged
    assert new[-1] < old[-1]  # the inflated rating of a recent film is discounted


def test_classics_threshold_nearest_rank_over_trained_recommendable():
    ints = np.array([100, 200, 300, 400, 500, 900, 950])
    rec = np.array([True, True, True, True, False, True, True])
    # trained = 5 first: recommendable values 0.1 0.2 0.3 0.4; p99 -> ceil(3.96) - 1 = 3
    assert q.classics_threshold(ints, rec, 5, 99) == 0.4
    assert q.classics_threshold(ints, rec, 5, 50) == 0.2
    info = q.classics_info(ints, rec, 5)
    assert info["gamma"] == 0.5 and info["percentile"] == 99 and info["films_above"] == 0


def test_quality_pool_with_classics_matches_a_full_sort():
    rng = np.random.default_rng(2)
    n = 300
    scores = rng.normal(0, 1, n)
    quality = rng.integers(-800, 800, n)
    pop = rng.integers(1, 5000, n)
    rec = rng.random(n) > 0.1
    seen = np.zeros(n, dtype=bool)
    classics = {"gamma": 0.5, "threshold": 0.4, "max_item": 250}
    items, adj = export.quality_pool(scores, seen, rec, pop, None, 40, quality, 0.1, classics)
    cand = np.flatnonzero(rec)
    smax = scores[cand].max()

    def key(i):
        qi = quality[i] / 1000
        bonus = 0.5 * max(0.0, qi - 0.4) if i < 250 else 0.0
        return (-(scores[i] / smax + 0.1 * qi + bonus), i)

    assert items.tolist() == [int(i) for i in sorted(cand, key=key)[:40]]
    # an estimated film (>= max_item) never gets the bonus
    plain, _ = export.quality_pool(scores, seen, rec, pop, None, 40, quality, 0.1)
    assert set(items) != set(plain)


def test_cap_estimated_one_per_row():
    est = 100
    items = [100, 101, 1, 2, 102, 3, 4, 5, 6, 7, 8, 9, 10, 11, 103, 12, 13, 14]
    out = export.cap_estimated(items, est, 1, 8, 16)
    assert len(out) == 16
    for r in range(2):
        assert sum(i >= est for i in out[r * 8 : r * 8 + 8]) <= 1
    assert out[0] == 100 and out[8] == 101  # the waiting film opens the next row
    # order kept among the trained films
    trained = [i for i in out if i < est]
    assert trained == sorted(trained)


def test_cap_estimated_stops_when_only_estimated_films_remain():
    out = export.cap_estimated([100, 101, 102, 1], 100, 1, 8, 8)
    assert out == [100, 1]


def test_production_lambda_table():
    assert cal.PRODUCTION["lambda_by_position"] == [0.1, 0.1, 0.1, 0.7, 0.9, 0.9, 0.9, 0.9]
