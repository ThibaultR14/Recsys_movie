"""Classify the films a match report did not recognise (step 3, E6). Offline, local only.

    uv run python match_diagnostics.py ../web/test-data/reports/<label>.json [--show]

For every `not_found` / `ambiguous` / `probable_fuzzy` entry, looks the title + year (±1) up in
the whole of MovieLens 32M (movies.csv, every film, even below the catalogue threshold) and, if
absent, in the IMDb datasets (offline only: primaryTitle / originalTitle of movies, mapped back
to MovieLens through links.csv). Categories:

    in_catalogue        the film is in the catalogue: a matching failure (to fix)
    merged_or_excluded  in MovieLens with >= 20 ratings but not in the catalogue (merge, TV, manual)
    below_threshold     in MovieLens with < 20 ratings
    after_movielens     not in MovieLens, released 2024 or later (MovieLens 32M stops in 2023)
    not_in_movielens    not in MovieLens (IMDb film found, or nothing found)

Writes <report>.diagnostics.json next to the report (ignored by git). `--show` prints the titles:
only for Thibault's own export, never for volunteers (counts only).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import polars as pl

from build_catalog import ml_title, ml_year
from config import PROCESSED, RAW
from titles import normalize_title, title_keys

ML_DIR = RAW / "ml-32m"
IMDB_BASICS = RAW / "imdb" / "title.basics.tsv.gz"
CHECKED = ("not_found", "ambiguous", "probable_fuzzy")
ARTICLES = {"the", "a", "an", "le", "la", "les", "l", "il", "el", "der", "die", "das"}


def strip_article(key: str) -> str:
    head, _, rest = key.partition(" ")
    return rest if rest and head in ARTICLES else key


def movielens_keys() -> pl.DataFrame:
    """(key, movie_id, year, raw count) for every MovieLens film, keys also without article."""
    movies = pl.read_csv(ML_DIR / "movies.csv", schema_overrides={"movieId": pl.Int32})
    movies = movies.select(
        pl.col("movieId").alias("movie_id"),
        ml_title(pl.col("title")).alias("ml_title"),
        ml_year(pl.col("title")).alias("year"),
    )
    counts = (
        pl.scan_parquet(PROCESSED / "ratings.parquet")
        .group_by("movieId")
        .agg(pl.len().alias("n_ratings"))
        .collect()
        .rename({"movieId": "movie_id"})
    )
    movies = movies.join(counts, on="movie_id", how="left").with_columns(
        pl.col("n_ratings").fill_null(0)
    )
    rows = []
    for r in movies.iter_rows(named=True):
        for k in title_keys(r["ml_title"]):
            for kk in {k, strip_article(k)}:
                rows.append((kk, r["movie_id"], r["year"], r["n_ratings"]))
    return pl.DataFrame(
        rows, schema=["key", "movie_id", "year", "n_ratings"], orient="row"
    ).unique()


def imdb_lookup(keys: set[str]) -> pl.DataFrame:
    """Offline IMDb datasets: movies whose primary/original title normalises to one of the keys."""
    basics = pl.read_csv(
        IMDB_BASICS,
        separator="\t",
        quote_char=None,
        null_values="\\N",
        columns=["tconst", "titleType", "primaryTitle", "originalTitle", "startYear"],
        schema_overrides={"startYear": pl.Int32},
    )
    basics = basics.filter(pl.col("titleType").is_in(["movie", "tvMovie", "video", "short"]))
    hits = []
    for r in basics.iter_rows(named=True):
        for t in (r["primaryTitle"], r["originalTitle"]):
            k = normalize_title(t)
            if k in keys or strip_article(k) in keys:
                hits.append((k, strip_article(k), int(r["tconst"][2:]), r["startYear"]))
    return pl.DataFrame(hits, schema=["key", "key_noart", "imdb_num", "year"], orient="row")


def classify(entry: dict, ml: pl.DataFrame, catalogue_ids: set[int], merged: dict, links, imdb):
    key = normalize_title(entry["title"])
    keys = {key, strip_article(key)}
    year = entry["year"]

    def near(df: pl.DataFrame) -> pl.DataFrame:
        if year is None:
            return df
        return df.filter(pl.col("year").is_null() | ((pl.col("year") - year).abs() <= 1))

    hits = near(ml.filter(pl.col("key").is_in(list(keys))))
    via = "movielens_title"
    if hits.is_empty() and not imdb.is_empty():
        im = near(
            imdb.filter(pl.col("key").is_in(list(keys)) | pl.col("key_noart").is_in(list(keys)))
        )
        ids = links.filter(pl.col("imdbId").is_in(im["imdb_num"].to_list()))["movieId"].to_list()
        hits = ml.filter(pl.col("movie_id").is_in(ids)).unique("movie_id")
        via = "imdb_title"
        if hits.is_empty() and not im.is_empty():
            via = "imdb_only"
    if hits.is_empty():
        cat = "after_movielens" if year is not None and year >= 2024 else "not_in_movielens"
        return {"category": cat, "via": via if via == "imdb_only" else None}
    best = hits.sort("n_ratings", descending=True).row(0, named=True)
    mid = merged.get(best["movie_id"], best["movie_id"])
    if mid in catalogue_ids:
        cat = "in_catalogue"
    elif best["n_ratings"] >= 20:
        cat = "merged_or_excluded"
    else:
        cat = "below_threshold"
    return {"category": cat, "via": via, "movie_id": int(mid), "n_ratings": int(best["n_ratings"])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("report", type=Path)
    parser.add_argument("--show", action="store_true", help="print titles (own export only)")
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    entries = [e for e in report["entries"] if e["status"] in CHECKED]
    ml = movielens_keys()
    catalogue_ids = set(
        pl.read_parquet(PROCESSED / "catalog.parquet", columns=["movie_id"])["movie_id"].to_list()
    )
    merges = pl.read_parquet(PROCESSED / "movie_id_merges.parquet")
    merged = dict(
        zip(merges["movie_id_from"].to_list(), merges["movie_id_to"].to_list(), strict=True)
    )
    links = pl.read_csv(ML_DIR / "links.csv", columns=["movieId", "imdbId"])
    wanted = {k for e in entries for k in (normalize_title(e["title"]),)}
    wanted |= {strip_article(k) for k in wanted}
    imdb = imdb_lookup(wanted) if IMDB_BASICS.exists() else pl.DataFrame()
    out = []
    for e in entries:
        d = classify(e, ml, catalogue_ids, merged, links, imdb)
        out.append({"status": e["status"], **d, "entry": e})
    summary: dict[str, dict[str, int]] = {}
    for o in out:
        summary.setdefault(o["status"], {}).setdefault(o["category"], 0)
        summary[o["status"]][o["category"]] += 1
    path = args.report.with_suffix(".diagnostics.json")
    path.write_text(json.dumps({"summary": summary, "entries": out}, indent=1, ensure_ascii=False))
    print(json.dumps(summary, indent=2))
    if args.show:
        for o in out:
            e = o["entry"]
            print(
                f"{o['status']:<15} {o['category']:<18} {e['title']} ({e['year']})"
                f" n={o.get('n_ratings')} via={o.get('via')}"
            )
    print(f"-> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
