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


def test_year_factors_floor_and_previous_year_fallback():
    # 60 movies of 2010 (ratio 0.5), 60 of 2020 (ratio 0.1), 10 of 2021 (ratio 0.01: too few)
    ml = np.array([50] * 60 + [10] * 60 + [1] * 10)
    tmdb = np.array([100] * 130)
    years = np.array([2010] * 60 + [2020] * 60 + [2021] * 10, dtype=float)
    f = popm.year_factors(ml, tmdb, years, r_ref=0.2)
    assert f[2010] == 1.0  # 0.2 / 0.5 < 1 -> floor at 1
    assert f[2020] == pytest.approx(2.0)  # 0.2 / 0.1
    assert f[2021] == pytest.approx(2.0)  # < 50 movies -> ratio of 2020, not 0.2 / 0.01


def test_year_corrected_never_below_previous_formula():
    rng = np.random.default_rng(0)
    ml = rng.integers(1, 5000, 3000)
    tmdb = rng.integers(0, 20000, 3000).astype(float)
    tmdb[::17] = np.nan
    years = rng.integers(1990, 2024, 3000).astype(float)
    years[::31] = np.nan
    pop, info = popm.year_corrected(ml, tmdb, years)
    assert (pop >= popm.hybrid(ml, tmdb, info["r_ref"])).all()
    assert (pop >= ml).all()
    assert all(v > 1 for v in info["factors"].values())


def test_year_corrected_formula_by_hand():
    ml = np.array([100, 100, 100] + [100] * 60 + [10] * 60)
    tmdb = np.array([1000.0, 0.0, 100.0] + [400.0] * 60 + [200.0] * 60)
    years = np.array([2015, 2020, np.nan] + [2015] * 60 + [2020] * 60)
    pop, _ = popm.year_corrected(ml, tmdb, years, r_ref=0.25)
    # 2015: r_year = 0.25 -> f = 1 ; 2020: r_year = 0.05 -> f = 5 ; no year -> f = 1
    assert pop[:3].tolist() == [250, 500, 100]  # max(100, 250) ; 100 * 5 ; max(100, 25)


def test_catalogue_never_less_popular_than_before():
    from config import PROCESSED

    path = PROCESSED / "catalog.parquet"
    if not path.exists():
        pytest.skip("catalogue not built")
    c = popm.catalog_columns(path)
    pop, info = popm.production_popularity(path)
    before = popm.hybrid(c["ml_rating_count"], c["tmdb_vote_count"], info["r_ref"])
    assert (pop >= before).all()
    assert info["r_ref"] == pytest.approx(0.2846, abs=1e-4)


def test_votes_rank_table_is_median_of_sorted_years():
    t = popm.votes_rank_table([[10, 30, 20], [40, 5], [25, 35, 15]])
    assert t.tolist() == [35.0, 20.0, 12.5]  # 3rd rank: years with 3 films only (10, 15)
    assert (np.diff(t) <= 0).all()


def test_ranks_in_year_single_vote_source():
    ids, votes = [7, 9, 4], np.array([500.0, 100.0, 100.0])
    # film 7 in the list keeps its place (rank 1) even if its own vote count differs
    r = popm.ranks_in_year([7, 8, 4], np.array([999.0, 300.0, 100.0]), ids, votes)
    assert r.tolist() == [0, 1, 1]  # 8 (not listed, 300 votes) after 500; 4 before 9 (tie, id)


def test_rank_corrected_only_from_first_year_and_never_lower():
    import polars as pl

    disc = pl.DataFrame(
        {
            "id": [1, 2, 3, 4, 5, 6],
            "year": [2010, 2010, 2011, 2011, 2020, 2020],
            "vote_count": [100, 50, 100, 50, 100, 50],
        }
    )
    base = np.array([1000, 100, 2000, 300, 10, 500])
    pop, info = popm.rank_corrected(
        base,
        [1, 2, 3, 4, 5, 6],
        np.array([2010, 2010, 2011, 2011, 2020, 2020], dtype=float),
        np.array([100, 50, 100, 50, 100, 50], dtype=float),
        disc,
        r_ref=0.3,
        first_year=2020,
        ref_years=(2010, 2011),
    )
    # reference table: rank 0 = median(1000, 2000) = 1500, rank 1 = median(100, 300) = 200
    assert pop[:4].tolist() == base[:4].tolist()  # before the first year: unchanged
    assert pop[4] == 1500 and pop[5] == 500  # 6 keeps its higher year_all popularity
    assert info["rank_table_head"] == [1500, 200]
