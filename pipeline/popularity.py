"""Popularity used by the slider (D5): MovieLens counts, corrected for recent movies with TMDB.

MovieLens 32M stops in 2023: recent movies have few ratings because they are recent, not because
they are niche. Hybrid popularity:

    popularity_i = max(ml_rating_count_i, round(r * tmdb_vote_count_i))

with r = median of ml_rating_count / tmdb_vote_count over movies released 2010-2018 (both > 0).
The max can only make a movie MORE popular: it takes recent blockbusters out of the low caps
without letting TMDB noise pass for hidden gems. Missing tmdb_vote_count -> MovieLens count only.
Only MovieLens and TMDB data (no IMDb dataset column).
"""

from __future__ import annotations

import numpy as np
import polars as pl

REFERENCE_YEARS = (2010, 2018)


def tmdb_ratio(ml_counts: np.ndarray, tmdb_votes: np.ndarray, years: np.ndarray) -> float:
    """Median ml / tmdb over movies released in REFERENCE_YEARS with both counts > 0."""
    ml = np.asarray(ml_counts, dtype=np.float64)
    tv = np.asarray(tmdb_votes, dtype=np.float64)
    y = np.asarray(years, dtype=np.float64)
    lo, hi = REFERENCE_YEARS
    sel = (y >= lo) & (y <= hi) & (tv > 0) & (ml > 0)
    return float(np.median(ml[sel] / tv[sel]))


def hybrid(ml_counts: np.ndarray, tmdb_votes: np.ndarray, ratio: float) -> np.ndarray:
    """max(ml, round(ratio * tmdb)), int64; NaN/missing TMDB votes count as 0."""
    tv = np.nan_to_num(np.asarray(tmdb_votes, dtype=np.float64), nan=0.0)
    scaled = np.rint(ratio * tv).astype(np.int64)
    return np.maximum(np.asarray(ml_counts, dtype=np.int64), scaled)


def catalog_columns(catalog_parquet) -> dict[str, np.ndarray]:
    """year, ml_rating_count (complete) and tmdb_vote_count (NaN if missing), item_idx order."""
    cat = pl.read_parquet(
        catalog_parquet, columns=["item_idx", "year", "ml_rating_count", "tmdb_vote_count"]
    ).sort("item_idx")
    return {
        "year": cat["year"].cast(pl.Float64).fill_null(np.nan).to_numpy(),
        "ml_rating_count": cat["ml_rating_count"].to_numpy().astype(np.int64),
        "tmdb_vote_count": cat["tmdb_vote_count"].cast(pl.Float64).fill_null(np.nan).to_numpy(),
    }


def production_popularity(catalog_parquet) -> tuple[np.ndarray, float]:
    """Hybrid popularity on complete MovieLens counts (popularity.bin) and its ratio r."""
    c = catalog_columns(catalog_parquet)
    r = tmdb_ratio(c["ml_rating_count"], c["tmdb_vote_count"], c["year"])
    return hybrid(c["ml_rating_count"], c["tmdb_vote_count"], r), r
