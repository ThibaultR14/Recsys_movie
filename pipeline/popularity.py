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


# --- Step 8 (docs/etape-8-films-recents.md, R3d): rank of the TMDB votes within the year ----------
#
# From RANK_FIRST_YEAR on, MovieLens under-counts even the hits (its users stop in 2023): the 10th
# most voted TMDB film of 2019 has a year_all popularity (5 158) below every year of 2010-2018
# (7 225 to 21 335), and 2020-2023 are far below. For those years, the film ranked r by TMDB votes
# within its release year (TMDB films with >= 50 votes, /discover) gets the median, over
# RANK_REFERENCE_YEARS, of the r-th highest popularity of the year (year_all, unchanged there);
# never below its year_all popularity (a film never becomes more confidential) nor r_ref x
# votes. One vote source for the ranks: the /discover vote counts (a catalogue film missing from
# /discover is ranked by its own vote count among them). Same rule for the estimated films.

RANK_REFERENCE_YEARS = (2010, 2018)
RANK_FIRST_YEAR = 2019  # first year whose 10th most voted film is below every reference year


def votes_rank_table(year_lists: list[list[float]]) -> np.ndarray:
    """year_lists: per reference year, the popularity of its films. Value at rank r = median over
    the years of the r-th highest popularity of the year (years with fewer films left out): the
    rule validated at R3c, non-increasing by construction (median of sorted lists)."""
    lists = [sorted(x, reverse=True) for x in year_lists]
    depth = max(len(x) for x in lists)
    return np.array([float(np.median([x[k] for x in lists if k < len(x)])) for k in range(depth)])


def ranks_in_year(
    ids: list[int], votes: np.ndarray, year_ids: list[int], year_votes: np.ndarray
) -> np.ndarray:
    """0-based rank of each film among the /discover films of its year, by votes (most voted
    first, ties by id). A film of the list keeps its own place; another one is placed by votes."""
    order = sorted(range(len(year_ids)), key=lambda k: (-year_votes[k], year_ids[k]))
    place = {year_ids[k]: r for r, k in enumerate(order)}
    sorted_votes = -np.sort(-np.asarray(year_votes, dtype=np.float64))
    out = np.empty(len(ids), dtype=np.int64)
    for k, (t, v) in enumerate(zip(ids, votes, strict=True)):
        if t in place:
            out[k] = place[t]
        else:
            out[k] = int(np.searchsorted(-sorted_votes, -float(v), side="right"))
    return out


def rank_popularity_from_table(
    ranks: np.ndarray, table: np.ndarray, votes, base: np.ndarray, r_ref: float
) -> np.ndarray:
    """max(table[rank] (last value beyond it), round(r_ref x votes), base)."""
    r = np.minimum(np.asarray(ranks, dtype=np.int64), len(table) - 1)
    floor = np.rint(r_ref * np.nan_to_num(np.asarray(votes, dtype=np.float64), nan=0.0))
    return np.maximum.reduce([np.rint(table[r]), floor, np.asarray(base, dtype=np.float64)]).astype(
        np.int64
    )


def discover_frame(discover_parquet) -> pl.DataFrame:
    return pl.read_parquet(
        discover_parquet, columns=["id", "release_date", "vote_count"]
    ).with_columns(year=pl.col("release_date").str.slice(0, 4).cast(pl.Int64, strict=False))


def rank_reference(
    disc: pl.DataFrame, pop_of_tmdb: dict[int, int], r_ref: float, ref_years=RANK_REFERENCE_YEARS
) -> np.ndarray:
    lists = []
    for y in range(ref_years[0], ref_years[1] + 1):
        d = disc.filter(pl.col("year") == y).sort(["vote_count", "id"], descending=[True, False])
        lists.append(
            [
                pop_of_tmdb.get(t, round(r_ref * v))
                for t, v in zip(d["id"].to_list(), d["vote_count"].to_list(), strict=True)
            ]
        )
    return votes_rank_table(lists)


def rank_corrected(
    base_pop: np.ndarray,
    tmdb_ids: list,
    years: np.ndarray,
    tmdb_votes: np.ndarray,
    disc: pl.DataFrame,
    r_ref: float,
    first_year: int = RANK_FIRST_YEAR,
    ref_years=RANK_REFERENCE_YEARS,
    pop_of_tmdb: dict[int, int] | None = None,
) -> tuple[np.ndarray, dict]:
    """Rank rule for the films released from `first_year` on (catalogue or estimated films).
    `pop_of_tmdb`: popularity of the reference films (default: base_pop of these films)."""
    if pop_of_tmdb is None:
        pop_of_tmdb = {
            int(t): int(p) for t, p in zip(tmdb_ids, base_pop, strict=True) if t is not None
        }
    table = rank_reference(disc, pop_of_tmdb, r_ref, ref_years)
    out = np.asarray(base_pop, dtype=np.int64).copy()
    y = np.asarray(years, dtype=np.float64)
    votes = np.nan_to_num(np.asarray(tmdb_votes, dtype=np.float64), nan=0.0)
    for year in sorted({int(v) for v in y[~np.isnan(y)] if v >= first_year}):
        sel = np.flatnonzero(y == year)
        sel = np.array([k for k in sel if tmdb_ids[k] is not None], dtype=np.int64)
        if len(sel) == 0:
            continue
        d = disc.filter(pl.col("year") == year)
        ranks = ranks_in_year(
            [int(tmdb_ids[k]) for k in sel],
            votes[sel],
            d["id"].to_list(),
            d["vote_count"].to_numpy().astype(np.float64),
        )
        out[sel] = rank_popularity_from_table(ranks, table, votes[sel], out[sel], r_ref)
    info = {
        "rank_first_year": first_year,
        "rank_reference_years": list(ref_years),
        "rank_table_head": [int(v) for v in table[:10]],
        "rank_table_len": int(len(table)),
    }
    return out, info


def production_popularity_v8(catalog_parquet, discover_parquet) -> tuple[np.ndarray, dict]:
    """Step 8 popularity of the catalogue (popularity.bin): year_all, then the rank rule from
    RANK_FIRST_YEAR on. Also returns what the estimated films need (table, r_ref)."""
    base, info = production_popularity(catalog_parquet)
    cat = pl.read_parquet(
        catalog_parquet, columns=["item_idx", "tmdb_id", "year", "tmdb_vote_count"]
    ).sort("item_idx")
    disc = discover_frame(discover_parquet)
    pop, rinfo = rank_corrected(
        base,
        cat["tmdb_id"].to_list(),
        cat["year"].cast(pl.Float64).fill_null(np.nan).to_numpy(),
        cat["tmdb_vote_count"].cast(pl.Float64).fill_null(np.nan).to_numpy(),
        disc,
        info["r_ref"],
    )
    return pop, {**info, **rinfo, "year_all": base}
