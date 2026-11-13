"""catalog.json and title-index.json for the website (step 3, D2 and D3).

Pure functions on the catalogue frame (sorted by item_idx); writing, guard and sizes are done by
`export.py catalog`. Only MovieLens and TMDB fields (never an `imdbds_` column).

title-index.json: keys = normalised titles (titles.py, v2), sorted and unique; post[i] = sorted
`4 * item_idx + source` for keys[i], source 0 tmdb_title, 1 ml_title (as is or cleaned),
2 tmdb_original_title, 3 MovieLens alternate title; a film keeps its best (lowest) source per key.

Manual display titles (`title` action of `manual_overrides.csv`, step 5 D7) replace the shown
title in catalog.json and add their key to title-index.json as source 0 (the TMDB title keeps its
key too). The model and catalog.parquet are untouched.

catalog.json v2 (step 6b, D5): `ml_mean` (MovieLens mean rating x 10, int) and `ml_count`
(number of MovieLens ratings) for the « ★ 3,9 · 1 240 notes » line of the cards.
`version_of` (step 6c, D3): [item_idx, target item_idx] pairs from the `version_of` lines of
manual_overrides.csv; the site never recommends one film of a pair once the other is seen.
`divisive` (step 6c, Q6): sorted item_idx of the « ça divise » films (10 % most dispersed
MovieLens ratings, shrunk std); aggregates only.

catalog.json v3 (step 8): the estimated films (TMDB films missing from MovieLens) follow the
trained ones, from item_idx `n_trained` on; their `ml_mean` / `ml_count` are null and
`tmdb_mean` / `tmdb_count` (TMDB rating out of 5 x 10, number of TMDB votes; one value per
estimated film, in item order) give the « ★ 3,4 · TMDB » line. Their genres are TMDB genres
translated to MovieLens genres (`recent_films.TMDB_TO_ML_GENRE`).
`quality` (step 8, R6b): round(1000 q) per item, the quality term of `quality.py`.
"""

from __future__ import annotations

import math

import numpy as np
import polars as pl

from titles import NORMALIZATION_VERSION, ml_title_variants, normalize_title, title_keys

SRC_TMDB, SRC_ML, SRC_ORIGINAL, SRC_ML_ALT = 0, 1, 2, 3
NO_GENRE = "(no genres listed)"
CATALOG_COLUMNS = [
    "item_idx",
    "movie_id",
    "tmdb_title",
    "tmdb_original_title",
    "ml_title",
    "year",
    "ml_year",
    "tmdb_id",
    "imdb_id",
    "imdb_id_aliases",
    "tmdb_directors",
    "poster_path",
    "ml_genres",
    "ml_mean_rating",
    "ml_rating_count",
]

CATALOG_JSON_VERSION = 3  # v2 (step 6b, D5): ml_mean, ml_count; v3 (step 8): estimated films


def mean_x10(mean: float | None) -> int | None:
    """MovieLens mean rating (out of 5) x 10, rounded half up: 3.85 -> 39, shown as « 3,9 »."""
    # round(…, 6) first: 3.05 * 10 is 30.499999999999996 in binary floating point
    return None if mean is None else math.floor(round(mean * 10, 6) + 0.5)


def load_catalog_frame(path) -> pl.DataFrame:
    cat = pl.read_parquet(path, columns=CATALOG_COLUMNS).sort("item_idx")
    assert cat["item_idx"].to_list() == list(range(cat.height)), "item_idx not 0..n-1"
    return cat


def title_overrides(cat: pl.DataFrame, overrides: pl.DataFrame) -> dict[int, str]:
    """`title` lines of manual_overrides.csv -> {item_idx: display title}. Every movie_id must be a
    catalogue movie (not excluded, not merged into another one)."""
    lines = overrides.filter(pl.col("action") == "title")
    idx = dict(cat.select("movie_id", "item_idx").iter_rows())
    unknown = [m for m in lines["movie_id"].to_list() if m not in idx]
    if unknown:
        raise ValueError(f"manual_overrides: title for movie_id(s) not in the catalogue: {unknown}")
    return {idx[m]: t.strip() for m, t in lines.select("movie_id", "title").iter_rows()}


def display_title(tmdb_title: str | None, ml_title: str) -> str:
    """tmdb_title, else the cleaned MovieLens title (article back in front, no alternate title)."""
    return tmdb_title if tmdb_title else ml_title_variants(ml_title)


def version_pairs(cat: pl.DataFrame, overrides: pl.DataFrame) -> list[list[int]]:
    """`version_of` lines of manual_overrides.csv -> sorted [item_idx, target item_idx] pairs. Both
    movies must be in the catalogue."""
    lines = overrides.filter(pl.col("action") == "version_of")
    idx = dict(cat.select("movie_id", "item_idx").iter_rows())
    pairs = []
    for m, t in lines.select("movie_id", "target_movie_id").iter_rows():
        if m not in idx or t not in idx:
            raise ValueError(f"manual_overrides: version_of {m} -> {t}: movie not in the catalogue")
        pairs.append([idx[m], idx[t]])
    return sorted(pairs)


# « ça divise » card tag (step 6c, Q6): the most dispersed MovieLens ratings, with the variance
# pulled towards the catalogue mean by DIVISIVE_SHRINK_K pseudo-ratings (the raw std of a film with
# 20 ratings is noisy: it would put the tag on little-known films by chance).
DIVISIVE_SHRINK_K = 50
DIVISIVE_TOP_SHARE = 0.10


def rating_dispersion(ratings: pl.LazyFrame) -> pl.DataFrame:
    """movieId -> population std (`std`) and number (`n`) of its ratings."""
    return (
        ratings.group_by("movieId")
        .agg(pl.col("rating").std(ddof=0).alias("std"), pl.len().alias("n"))
        .collect()
    )


def shrunk_std(std: np.ndarray, n: np.ndarray, k: int = DIVISIVE_SHRINK_K) -> np.ndarray:
    """√((n·v + k·v̄) / (n + k)), v = std², v̄ = mean of v over the films."""
    v = np.asarray(std, dtype=np.float64) ** 2
    n = np.asarray(n, dtype=np.float64)
    return np.sqrt((n * v + k * v.mean()) / (n + k))


def divisive_items(std: np.ndarray, n: np.ndarray, share: float = DIVISIVE_TOP_SHARE) -> list[int]:
    """Sorted item_idx (positions in `std`) of the `share` most dispersed films (shrunk std at or
    above its 1 − share quantile)."""
    s = shrunk_std(std, n)
    threshold = np.quantile(s, 1.0 - share)
    return [int(i) for i in np.flatnonzero(s >= threshold)]


def estimated_frame(est: pl.DataFrame, n_trained: int, schema: pl.Schema) -> pl.DataFrame:
    """Rows of the estimated films (step 8) with the catalogue columns, item_idx from n_trained."""
    rows = []
    for k, r in enumerate(est.iter_rows(named=True)):
        rows.append(
            {
                "item_idx": n_trained + k,
                "movie_id": None,
                "tmdb_title": r["title"],
                "tmdb_original_title": r["original_title"],
                "ml_title": "",
                "year": r["year"],
                "ml_year": None,
                "tmdb_id": r["tmdb_id"],
                "imdb_id": r["imdb_id"],
                "imdb_id_aliases": [],
                "tmdb_directors": list(r["director_names"] or []),
                "poster_path": r["poster_path"],
                "ml_genres": list(r["ml_genres"] or []),
                "ml_mean_rating": None,
                "ml_rating_count": None,
            }
        )
    return pl.DataFrame(rows, schema=schema)


def tmdb_mean_x10(vote_average: float | None) -> int | None:
    """TMDB rating out of 10 -> out of 5 x 10, rounded half up: 6.85 -> 3.425 -> 34 (« 3,4 »)."""
    if vote_average is None:
        return None
    return math.floor(vote_average * 5 + 0.5)


def build_catalog_json(
    cat: pl.DataFrame,
    manual_titles: dict[int, str] | None = None,
    versions: list[list[int]] | None = None,
    divisive: list[int] | None = None,
    n_trained: int | None = None,
    estimated: pl.DataFrame | None = None,
    quality: list[int] | None = None,
) -> dict:
    manual = manual_titles or {}
    rows = cat.to_dicts()
    genre_names = sorted({g for r in rows for g in (r["ml_genres"] or []) if g != NO_GENRE})
    gid = {g: i for i, g in enumerate(genre_names)}
    titles = [
        manual.get(i) or display_title(r["tmdb_title"], r["ml_title"]) for i, r in enumerate(rows)
    ]
    return {
        "v": CATALOG_JSON_VERSION,
        "n": len(rows),
        "title": titles,
        "original_title": {
            str(i): r["tmdb_original_title"]
            for i, r in enumerate(rows)
            if r["tmdb_original_title"] and r["tmdb_original_title"] != titles[i]
        },
        "year": [r["year"] for r in rows],
        "tmdb_id": [r["tmdb_id"] for r in rows],
        "imdb_id": [r["imdb_id"] for r in rows],
        "imdb_id_aliases": {
            str(i): list(r["imdb_id_aliases"]) for i, r in enumerate(rows) if r["imdb_id_aliases"]
        },
        "directors": [list(r["tmdb_directors"] or []) for r in rows],
        "poster_path": [r["poster_path"] for r in rows],
        "genres": [sorted(gid[g] for g in (r["ml_genres"] or []) if g != NO_GENRE) for r in rows],
        "genre_names": genre_names,
        # Public rating on the cards (step 6b, D5): aggregates only, never a raw rating.
        "ml_mean": [mean_x10(r["ml_mean_rating"]) for r in rows],
        "ml_count": [r["ml_rating_count"] for r in rows],
        # Other cuts of a film (step 6c, D3): never recommended once the other one is seen.
        "version_of": versions or [],
        # « ça divise » card tag (step 6c, Q6): sorted item_idx
        "divisive": divisive or [],
        # Estimated films (step 8): item_idx >= n_trained; TMDB rating on their cards
        "n_trained": len(rows) if n_trained is None else n_trained,
        "tmdb_mean": []
        if estimated is None
        else [tmdb_mean_x10(v) for v in estimated["vote_average"].to_list()],
        "tmdb_count": [] if estimated is None else estimated["vote_count"].to_list(),
        # Quality term (step 8, R6b): round(1000 q) per item, see quality.py
        "quality": quality or [],
    }


def film_keys(
    tmdb_title: str | None, tmdb_original: str | None, ml_title: str, manual: str | None = None
) -> dict[str, int]:
    """Normalised key -> best source for one film (`manual`: display title set by hand)."""
    out: dict[str, int] = {}

    def add(key: str, src: int) -> None:
        if key and src < out.get(key, 99):
            out[key] = src

    add(normalize_title(manual), SRC_TMDB)
    add(normalize_title(tmdb_title), SRC_TMDB)
    ml_main = {normalize_title(ml_title), normalize_title(ml_title_variants(ml_title))}
    for k in ml_main:
        add(k, SRC_ML)
    for k in title_keys(ml_title) - ml_main:
        add(k, SRC_ML_ALT)
    add(normalize_title(tmdb_original), SRC_ORIGINAL)
    return out


def build_title_index(cat: pl.DataFrame, manual_titles: dict[int, str] | None = None) -> dict:
    manual = manual_titles or {}
    postings: dict[str, list[int]] = {}
    ml_year = {}
    for r in cat.iter_rows(named=True):
        i = r["item_idx"]
        keys = film_keys(r["tmdb_title"], r["tmdb_original_title"], r["ml_title"], manual.get(i))
        for key, src in keys.items():
            postings.setdefault(key, []).append(4 * i + src)
        if r["ml_year"] is not None and r["ml_year"] != r["year"]:
            ml_year[str(i)] = r["ml_year"]
    keys = sorted(postings)
    return {
        "v": 1,
        "norm": NORMALIZATION_VERSION,
        "keys": keys,
        "post": [sorted(postings[k]) for k in keys],
        "ml_year": ml_year,
    }
