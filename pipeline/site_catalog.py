"""catalog.json and title-index.json for the website (step 3, D2 and D3).

Pure functions on the catalogue frame (sorted by item_idx); writing, guard and sizes are done by
`export.py catalog`. Only MovieLens and TMDB fields (never an `imdbds_` column).

title-index.json: keys = normalised titles (titles.py, v2), sorted and unique; post[i] = sorted
`4 * item_idx + source` for keys[i], source 0 tmdb_title, 1 ml_title (as is or cleaned),
2 tmdb_original_title, 3 MovieLens alternate title; a film keeps its best (lowest) source per key.
"""

from __future__ import annotations

import polars as pl

from titles import NORMALIZATION_VERSION, ml_title_variants, normalize_title, title_keys

SRC_TMDB, SRC_ML, SRC_ORIGINAL, SRC_ML_ALT = 0, 1, 2, 3
NO_GENRE = "(no genres listed)"
CATALOG_COLUMNS = [
    "item_idx",
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
]


def load_catalog_frame(path) -> pl.DataFrame:
    cat = pl.read_parquet(path, columns=CATALOG_COLUMNS).sort("item_idx")
    assert cat["item_idx"].to_list() == list(range(cat.height)), "item_idx not 0..n-1"
    return cat


def display_title(tmdb_title: str | None, ml_title: str) -> str:
    """tmdb_title, else the cleaned MovieLens title (article back in front, no alternate title)."""
    return tmdb_title if tmdb_title else ml_title_variants(ml_title)


def build_catalog_json(cat: pl.DataFrame) -> dict:
    rows = cat.to_dicts()
    genre_names = sorted({g for r in rows for g in (r["ml_genres"] or []) if g != NO_GENRE})
    gid = {g: i for i, g in enumerate(genre_names)}
    titles = [display_title(r["tmdb_title"], r["ml_title"]) for r in rows]
    return {
        "v": 1,
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
    }


def film_keys(tmdb_title: str | None, tmdb_original: str | None, ml_title: str) -> dict[str, int]:
    """Normalised key -> best source for one film."""
    out: dict[str, int] = {}

    def add(key: str, src: int) -> None:
        if key and src < out.get(key, 99):
            out[key] = src

    add(normalize_title(tmdb_title), SRC_TMDB)
    ml_main = {normalize_title(ml_title), normalize_title(ml_title_variants(ml_title))}
    for k in ml_main:
        add(k, SRC_ML)
    for k in title_keys(ml_title) - ml_main:
        add(k, SRC_ML_ALT)
    add(normalize_title(tmdb_original), SRC_ORIGINAL)
    return out


def build_title_index(cat: pl.DataFrame) -> dict:
    postings: dict[str, list[int]] = {}
    ml_year = {}
    for r in cat.iter_rows(named=True):
        i = r["item_idx"]
        for key, src in film_keys(r["tmdb_title"], r["tmdb_original_title"], r["ml_title"]).items():
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
