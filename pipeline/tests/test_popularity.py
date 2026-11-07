import numpy as np
import pytest

import popularity as popm


def test_ratio_uses_reference_years_and_positive_counts():
    ml = np.array([10, 30, 50, 100, 7, 5])
    tmdb = np.array([100, 100, 100, 100, 0, 1000])
    years = np.array([2010, 2015, 2018, 2009, 2012, np.nan])
    # only the first three count (2009 out of range, tmdb 0, missing year): 0.1, 0.3, 0.5
    assert popm.tmdb_ratio(ml, tmdb, years) == pytest.approx(0.3)


def test_hybrid_only_raises_popularity():
    ml = np.array([1000, 1000, 50, 20])
    tmdb = np.array([10_000, 100, np.nan, 0])
    out = popm.hybrid(ml, tmdb, 0.3)
    assert out.tolist() == [3000, 1000, 50, 20]  # max(ml, 0.3 * tmdb); missing TMDB -> ml
    assert (out >= ml).all()


def test_hybrid_rounds_to_nearest():
    assert popm.hybrid(np.array([0, 0]), np.array([5, 15]), 0.25).tolist() == [1, 4]  # 1.25, 3.75
