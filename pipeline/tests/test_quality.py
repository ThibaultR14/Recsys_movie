import numpy as np
import pytest

import export
import quality as q


def test_catalog_quality_centred_and_shrunk():
    qs, c = q.catalog_quality([100, 100, 0], [4.0, 3.0, np.nan], shrink=50)
    assert c == pytest.approx(3.5)
    assert qs[0] == pytest.approx((100 * 4 + 50 * 3.5) / 150 - 3.5)
    assert qs[2] == 0.0  # no rating: the catalogue mean


def test_site_quality_tmdb_line_for_estimated_films():
    rng = np.random.default_rng(0)
    n = 400
    counts = rng.integers(20, 2000, n)
    means = rng.uniform(2.0, 4.5, n)
    tmdb = 2 * means - 0.5 + rng.normal(0, 0.05, n)  # TMDB out of 10, closely related
    votes = rng.integers(60, 5000, n)
    ints, info = q.site_quality(
        counts, means, tmdb, votes, np.array([8.0, 4.0]), np.array([900, 900])
    )
    assert len(ints) == n + 2 and info["tmdb"]["corr"] > 0.9
    assert ints[-2] > 0 > ints[-1]  # a well-received recent film up, a badly received one down
    assert info["gamma"] == 0.1 and info["shrink"] == 50


def test_quality_pool_matches_a_full_sort():
    rng = np.random.default_rng(1)
    n = 300
    scores = rng.normal(0, 1, n)
    quality = rng.integers(-800, 800, n)
    pop = rng.integers(1, 5000, n)
    rec = rng.random(n) > 0.1
    seen = np.zeros(n, dtype=bool)
    seen[:10] = True
    items, adj = export.quality_pool(scores, seen, rec, pop, 2000, 40, quality, 0.1)
    cand = np.flatnonzero(rec & ~seen & (pop <= 2000))
    smax = scores[cand].max()
    full = sorted(cand, key=lambda i: (-(scores[i] / smax + 0.1 * (quality[i] / 1000)), i))[:40]
    assert items.tolist() == [int(i) for i in full]
    assert adj[0] >= adj[-1]
