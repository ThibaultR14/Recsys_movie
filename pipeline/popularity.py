"""Popularity used by the slider (D5 of docs/etape-2-modele.md): MovieLens counts, corrected for
recent movies.

MovieLens 32M stops in 2023 and its users rate mostly the movies of their time: the ratio
ml_rating_count / tmdb_vote_count falls steadily with the release year (0.43 in 2010, 0.07 in
2023). Recent movies look like hidden gems because they are recent, not because they are niche.

Popularity ("year_all", adopted 2026-11-08, diagnostic in docs/etape-4-navigateur.md §6):

    popularity_i = max(round(ml_i * f_year(i)), round(r_ref * tmdb_i))
    f_year       = max(1, r_ref / r_year)

- r_ref  = median of ml / tmdb over movies released 2010-2018 (both > 0)            (~0.285)
- r_year = median of ml / tmdb over the movies of that release year (both > 0), computed on
           the catalogue; a year with fewer than MIN_FILMS_PER_YEAR such movies uses the
           previous year that has enough (no such year, or no release year: f = 1).
- f >= 1 and the max with round(r_ref * tmdb): a movie is never less popular than with the
  previous formula `hybrid` (max(ml, round(r_ref * tmdb))). Missing TMDB votes count as 0.
Only MovieLens and TMDB data (no IMDb dataset column).
"""

from __future__ import annotations

import numpy as np
import polars as pl

REFERENCE_YEARS = (2010, 2018)
MIN_FILMS_PER_YEAR = 50


def tmdb_ratio(ml_counts: np.ndarray, tmdb_votes: np.ndarray, years: np.ndarray) -> float:
    """r_ref: median ml / tmdb over movies released in REFERENCE_YEARS with both counts > 0."""
    ml = np.asarray(ml_counts, dtype=np.float64)
    tv = np.nan_to_num(np.asarray(tmdb_votes, dtype=np.float64), nan=0.0)
    y = np.asarray(years, dtype=np.float64)
    lo, hi = REFERENCE_YEARS
    sel = (y >= lo) & (y <= hi) & (tv > 0) & (ml > 0)
    return float(np.median(ml[sel] / tv[sel]))


def hybrid(ml_counts: np.ndarray, tmdb_votes: np.ndarray, ratio: float) -> np.ndarray:
    """Previous formula (step 2): max(ml, round(ratio * tmdb)); kept as the lower bound."""
    tv = np.nan_to_num(np.asarray(tmdb_votes, dtype=np.float64), nan=0.0)
    scaled = np.rint(ratio * tv).astype(np.int64)
    return np.maximum(np.asarray(ml_counts, dtype=np.int64), scaled)


def year_ratios(
    ml_counts: np.ndarray, tmdb_votes: np.ndarray, years: np.ndarray
) -> dict[int, tuple[float, int]]:
    """Release year -> (median ml / tmdb, number of movies with both counts > 0)."""
    ml = np.asarray(ml_counts, dtype=np.float64)
    tv = np.nan_to_num(np.asarray(tmdb_votes, dtype=np.float64), nan=0.0)
    y = np.asarray(years, dtype=np.float64)
    ok = (tv > 0) & (ml > 0) & ~np.isnan(y)
    out = {}
    for year in np.unique(y[ok]).astype(int):
        sel = ok & (y == year)
        out[int(year)] = (float(np.median(ml[sel] / tv[sel])), int(sel.sum()))
    return out


def year_factors(
    ml_counts: np.ndarray, tmdb_votes: np.ndarray, years: np.ndarray, r_ref: float
) -> dict[int, float]:
    """f_year = max(1, r_ref / r_year) for every release year present in `years`.

    A year with fewer than MIN_FILMS_PER_YEAR usable movies takes the ratio of the closest
    previous year that has enough; none -> f = 1.
    """
    ratios = year_ratios(ml_counts, tmdb_votes, years)
    reliable = sorted(y for y, (_, n) in ratios.items() if n >= MIN_FILMS_PER_YEAR)
    present = np.unique(np.asarray(years, dtype=np.float64))
    factors = {}
    for year in present[~np.isnan(present)].astype(int):
        previous = [y for y in reliable if y <= year]
        if not previous:
            factors[int(year)] = 1.0
            continue
        r_year = ratios[previous[-1]][0]
        factors[int(year)] = max(1.0, r_ref / r_year)
    return factors


def year_corrected(
    ml_counts: np.ndarray, tmdb_votes: np.ndarray, years: np.ndarray, r_ref: float | None = None
) -> tuple[np.ndarray, dict]:
    """Adopted popularity (int64) and its parameters (r_ref, factors > 1 by year)."""
    ml = np.asarray(ml_counts, dtype=np.int64)
    y = np.asarray(years, dtype=np.float64)
    if r_ref is None:
        r_ref = tmdb_ratio(ml, tmdb_votes, y)
    factors = year_factors(ml, tmdb_votes, y, r_ref)
    f = np.array([1.0 if np.isnan(v) else factors.get(int(v), 1.0) for v in y])
    f = np.maximum(f, 1.0)  # floor, whatever the table says
    corrected = np.rint(ml * f).astype(np.int64)
    pop = np.maximum(corrected, hybrid(ml, tmdb_votes, r_ref))
    info = {
        "r_ref": r_ref,
        "factors": {str(k): round(v, 4) for k, v in sorted(factors.items()) if v > 1.0},
    }
    return pop, info


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


def production_popularity(catalog_parquet) -> tuple[np.ndarray, dict]:
    """Adopted popularity on complete MovieLens counts (popularity.bin) and its parameters."""
    c = catalog_columns(catalog_parquet)
    return year_corrected(c["ml_rating_count"], c["tmdb_vote_count"], c["year"])
