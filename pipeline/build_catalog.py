"""Build the movie catalogue (B3): MovieLens movies with >= MIN_RATINGS ratings.

Outputs (in `data/processed/`, never shipped as is):
- `catalog.parquet`: one row per movie, sorted by movie_id, with `item_idx` = 0..n-1 (row order of
  the future ALS item vectors). Publishable columns come from MovieLens (`ml_*`, ids); internal QA
  columns from the IMDb datasets carry the `imdbds_` prefix and must never reach `web/public/data/`.
- `ratings_filtered.parquet`: ratings of catalogue movies only, duplicate movieIds merged.
- `movie_id_merges.parquet`: movieIds merged into a canonical movieId (same tmdbId).

Steps, in order:
1. threshold on raw MovieLens rating counts (before any merge);
2. tmdbId duplicates (see `resolve_tmdb_duplicates`): same film -> merged into the movieId with the
   most ratings (a user who rated both keeps their most recent rating); different films sharing a
   wrong tmdbId -> not merged, tmdb_id cleared and flagged for lookup in B4;
3. offline quality filter: drop entries whose IMDb titleType is a series/episode.

Usage (from `pipeline/`):
    uv run python build_catalog.py [--min-ratings N]
"""

from __future__ import annotations

import argparse
import sys

import polars as pl

from config import MIN_RATINGS, PROCESSED, RAW
from download import scan_imdb

ML_DIR = RAW / "ml-32m"
RATINGS_PARQUET = PROCESSED / "ratings.parquet"
CATALOG_PARQUET = PROCESSED / "catalog.parquet"
RATINGS_FILTERED_PARQUET = PROCESSED / "ratings_filtered.parquet"
MERGES_PARQUET = PROCESSED / "movie_id_merges.parquet"

EXCLUDED_TITLE_TYPES = ("tvSeries", "tvEpisode", "tvMiniSeries")
MAX_DUPLICATE_YEAR_GAP = 1  # two movieIds sharing a tmdbId are the same film if years differ <= 1

# Every column, by origin. IMDb-derived columns must carry the prefix (checked by tests).
IMDB_PREFIX = "imdbds_"
PUBLISHABLE_COLUMNS = (
    "item_idx",
    "movie_id",
    "imdb_id",
    "tmdb_id",
    "ml_title",
    "ml_year",
    "ml_genres",
    "ml_rating_count",
    "ml_mean_rating",
    "needs_tmdb_lookup",
    "missing_year",
)
IMDB_COLUMNS = (
    "imdbds_found",
    "imdbds_primary_title",
    "imdbds_original_title",
    "imdbds_start_year",
    "imdbds_title_type",
    "imdbds_num_votes",
    "imdbds_average_rating",
)
CATALOG_COLUMNS = PUBLISHABLE_COLUMNS + IMDB_COLUMNS
MERGES_SCHEMA = {
    "movie_id_from": pl.Int32,
    "movie_id_to": pl.Int32,
    "tmdb_id": pl.Int64,
    "imdb_id_from": pl.String,
    "imdb_id_to": pl.String,
    "imdb_id_to_original": pl.String,  # canonical's links.csv imdb_id before the override
    "rating_count_from": pl.Int32,
}

# "(1995)" at the very end; also tolerates year ranges such as "(2007-)" and a doubled closing
# parenthesis ("... (1983))", movieId 98063). An earlier "(1987-1997)" in the name is kept.
YEAR_SUFFIX = r"\s*\((\d{4})(?:[-–]\d{0,4})?\)+\s*$"


# --- Pure transformations (unit tested) ----------------------------------------------------------


def imdb_tt(col: pl.Expr) -> pl.Expr:
    """MovieLens numeric imdbId (str or int, leading zeros or not) -> "tt" + >= 7 digits."""
    return pl.lit("tt") + col.cast(pl.String).cast(pl.Int64).cast(pl.String).str.zfill(7)


def ml_year(title: pl.Expr) -> pl.Expr:
    return title.str.strip_chars().str.extract(YEAR_SUFFIX, 1).cast(pl.Int32)


def ml_title(title: pl.Expr) -> pl.Expr:
    return title.str.strip_chars().str.replace(YEAR_SUFFIX, "").str.strip_chars()


def ml_genres(genres: pl.Expr) -> pl.Expr:
    return (
        pl.when(genres == "(no genres listed)")
        .then(pl.lit([], dtype=pl.List(pl.String)))
        .otherwise(genres.str.split("|"))
    )


def _excluded(row: dict) -> bool:
    return row["imdbds_title_type"] in EXCLUDED_TITLE_TYPES


def _year_gap(a: dict, b: dict) -> int:
    if a["ml_year"] is None or b["ml_year"] is None:
        return 0  # unknown year: trust the shared tmdbId
    return abs(a["ml_year"] - b["ml_year"])


def resolve_tmdb_duplicates(movies: pl.DataFrame) -> tuple[pl.DataFrame, dict[int, str], list[int]]:
    """Resolve movies sharing a tmdb_id.

    Needs columns movie_id, tmdb_id, imdb_id, ml_year, raw_rating_count, imdbds_title_type,
    imdbds_found. Per group, the anchor is the most-rated member whose IMDb type is not excluded.
    - same film = members within MAX_DUPLICATE_YEAR_GAP years of the anchor (excluded-type members
      only if same year: their imdbId is a MovieLens link error, e.g. a film linked to an episode);
      merged into the most-rated member (canonical), which takes the best imdb_id of the group
      (found in title.basics with an allowed type, then most ratings) — always a links.csv value;
    - other allowed-type members: a different film with a wrong tmdbId -> conflict.

    Returns (merges, {canonical movie_id: imdb_id} overrides, movie_ids whose tmdb_id is cleared).
    """
    dups = movies.filter(pl.col("tmdb_id").is_not_null() & pl.col("tmdb_id").is_duplicated())
    merges, overrides, conflicts = [], {}, []
    for (_tmdb,), group in dups.group_by("tmdb_id", maintain_order=True):
        rows = group.sort(["raw_rating_count", "movie_id"], descending=[True, False]).to_dicts()
        eligible = [r for r in rows if not _excluded(r)]
        if not eligible:
            continue  # every member is dropped by the type filter
        anchor = eligible[0]
        same, conflict = [anchor], []
        for r in rows:
            if r is anchor:
                continue
            gap = _year_gap(anchor, r)
            if _excluded(r):
                if gap == 0:
                    same.append(r)
            elif gap <= MAX_DUPLICATE_YEAR_GAP:
                same.append(r)
            else:
                conflict.append(r)
        canonical = max(same, key=lambda r: (r["raw_rating_count"], -r["movie_id"]))
        best = max(
            same,
            key=lambda r: (bool(r["imdbds_found"]) and not _excluded(r), r["raw_rating_count"]),
        )
        if best["imdb_id"] != canonical["imdb_id"]:
            overrides[canonical["movie_id"]] = best["imdb_id"]
        for r in same:
            if r is not canonical:
                merges.append(
                    {
                        "movie_id_from": r["movie_id"],
                        "movie_id_to": canonical["movie_id"],
                        "tmdb_id": r["tmdb_id"],
                        "imdb_id_from": r["imdb_id"],
                        "imdb_id_to": best["imdb_id"],
                        "imdb_id_to_original": canonical["imdb_id"],
                        "rating_count_from": r["raw_rating_count"],
                    }
                )
        if conflict:
            conflicts += [canonical["movie_id"]] + [r["movie_id"] for r in conflict]
    merges_df = pl.DataFrame(merges, schema=MERGES_SCHEMA).sort("movie_id_from")
    return merges_df, overrides, sorted(conflicts)


def apply_merges(ratings: pl.DataFrame, merges: pl.DataFrame) -> tuple[pl.DataFrame, dict]:
    """Rewrite merged movieIds to their canonical id; one rating per (user, movie), most recent wins
    (equal timestamps: the rating originally on the canonical movie wins)."""
    mapping = merges.select(
        pl.col("movie_id_from").alias("movieId"), pl.col("movie_id_to").alias("canonical")
    )
    touched_ids = pl.concat([merges["movie_id_from"], merges["movie_id_to"]]).unique().implode()
    touched = ratings.filter(pl.col("movieId").is_in(touched_ids))
    untouched = ratings.filter(~pl.col("movieId").is_in(touched_ids))

    remapped = (
        touched.join(mapping, on="movieId", how="left")
        .with_columns(
            pl.col("canonical").is_not_null().alias("reassigned"),
            pl.coalesce("canonical", "movieId").cast(ratings.schema["movieId"]).alias("movieId"),
        )
        .drop("canonical")
    )
    deduped = remapped.sort(
        ["userId", "movieId", "timestamp", "reassigned"], descending=[False, False, False, True]
    ).unique(["userId", "movieId"], keep="last", maintain_order=True)
    stats = {
        "reassigned": int(remapped["reassigned"].sum()),
        "collisions": remapped.height - deduped.height,
        "reassigned_kept": int(deduped["reassigned"].sum()),
    }
    out = pl.concat([untouched, deduped.drop("reassigned").select(ratings.columns)])
    return out.sort(["userId", "timestamp", "movieId"]), stats


# --- Loading -------------------------------------------------------------------------------------


def load_movielens() -> pl.DataFrame:
    counts = (
        pl.scan_parquet(RATINGS_PARQUET)
        .group_by("movieId")
        .agg(pl.len().alias("raw_rating_count"))
        .collect()
    )
    movies = pl.read_csv(ML_DIR / "movies.csv", schema_overrides={"movieId": pl.Int32})
    links = pl.read_csv(
        ML_DIR / "links.csv",
        schema_overrides={"movieId": pl.Int32, "imdbId": pl.String, "tmdbId": pl.Int64},
    )
    return (
        movies.join(links, on="movieId", how="left")
        .join(counts, on="movieId", how="left")
        .select(
            pl.col("movieId").alias("movie_id"),
            imdb_tt(pl.col("imdbId")).alias("imdb_id"),
            pl.col("tmdbId").alias("tmdb_id"),
            ml_title(pl.col("title")).alias("ml_title"),
            ml_year(pl.col("title")).alias("ml_year"),
            ml_genres(pl.col("genres")).alias("ml_genres"),
            pl.col("raw_rating_count").fill_null(0).cast(pl.Int32),
        )
    )


def load_imdb() -> pl.DataFrame:
    """Offline QA only (title.basics + title.ratings). Everything but the key is `imdbds_`."""
    basics = scan_imdb("title.basics.tsv.gz").select(
        pl.col("tconst").alias("imdb_id"),
        pl.col("primaryTitle").alias("imdbds_primary_title"),
        pl.col("originalTitle").alias("imdbds_original_title"),
        pl.col("startYear").cast(pl.Int32, strict=False).alias("imdbds_start_year"),
        pl.col("titleType").alias("imdbds_title_type"),
    )
    ratings = scan_imdb("title.ratings.tsv.gz").select(
        pl.col("tconst").alias("imdb_id"),
        pl.col("numVotes").cast(pl.Int32).alias("imdbds_num_votes"),
        pl.col("averageRating").cast(pl.Float32).alias("imdbds_average_rating"),
    )
    return (
        basics.join(ratings, on="imdb_id", how="left")
        .with_columns(pl.lit(True).alias("imdbds_found"))
        .collect()
    )


def join_imdb(movies: pl.DataFrame, imdb: pl.DataFrame) -> pl.DataFrame:
    return (
        movies.drop([c for c in IMDB_COLUMNS if c in movies.columns])
        .join(imdb, on="imdb_id", how="left")
        .with_columns(pl.col("imdbds_found").fill_null(False))
    )


# --- Build ---------------------------------------------------------------------------------------


def fmt(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def build(min_ratings: int) -> dict:
    report: dict = {"min_ratings": min_ratings}
    movies = load_movielens()
    imdb = load_imdb()

    # 1. Threshold on raw counts, before any merge.
    selected = join_imdb(movies.filter(pl.col("raw_rating_count") >= min_ratings), imdb)
    report["above_threshold"] = selected.height
    report["not_found_before"] = selected.filter(~pl.col("imdbds_found")).height

    # 2. tmdbId duplicates.
    merges, overrides, conflicts = resolve_tmdb_duplicates(selected)
    report["dup_tmdb_rows"] = selected.filter(
        pl.col("tmdb_id").is_not_null() & pl.col("tmdb_id").is_duplicated()
    ).height
    report["merges"], report["overrides"] = merges, overrides
    report["conflicts"] = selected.filter(pl.col("movie_id").is_in(conflicts))
    over = pl.DataFrame(
        {"movie_id": list(overrides), "imdb_override": list(overrides.values())},
        schema={"movie_id": pl.Int32, "imdb_override": pl.String},
    )
    merged = (
        selected.filter(~pl.col("movie_id").is_in(merges["movie_id_from"].implode()))
        .join(over, on="movie_id", how="left")
        .with_columns(
            pl.coalesce("imdb_override", "imdb_id").alias("imdb_id"),
            pl.when(pl.col("movie_id").is_in(conflicts))
            .then(None)
            .otherwise(pl.col("tmdb_id"))
            .alias("tmdb_id"),
        )
        .drop("imdb_override")
    )
    merged = join_imdb(merged, imdb)

    # 3. Offline quality filter on IMDb title type (unknown type = kept, imdbds_found = false).
    is_excluded = pl.col("imdbds_title_type").is_in(EXCLUDED_TITLE_TYPES).fill_null(False)
    excluded = merged.filter(is_excluded)
    report["excluded_by_type"] = dict(
        excluded.group_by("imdbds_title_type").len().sort("imdbds_title_type").iter_rows()
    )
    report["excluded_examples"] = excluded.sort("raw_rating_count", descending=True).head(5)
    kept = merged.filter(~is_excluded)

    # Would merging before thresholding have changed the catalogue? Pool raw counts per tmdb_id over
    # all MovieLens movies; count tmdb_ids absent from the catalogue that would reach the threshold.
    pooled = (
        movies.filter(pl.col("tmdb_id").is_not_null())
        .group_by("tmdb_id")
        .agg(pl.col("raw_rating_count").sum().alias("pooled"), pl.len().alias("n"))
        .filter((pl.col("n") > 1) & (pl.col("pooled") >= min_ratings))
        .filter(~pl.col("tmdb_id").is_in(selected["tmdb_id"].drop_nulls().implode()))
    )
    report["would_join_if_merged_first"] = pooled.height

    # Ratings of catalogue movies (+ merged ids), then merge.
    keep_ids = pl.concat([kept["movie_id"], merges["movie_id_from"]]).implode()
    ratings = pl.scan_parquet(RATINGS_PARQUET).filter(pl.col("movieId").is_in(keep_ids)).collect()
    ratings, merge_stats = apply_merges(ratings, merges)
    report.update(merge_stats)
    report["ratings_filtered"] = ratings.height

    stats = ratings.group_by("movieId").agg(
        pl.len().cast(pl.Int32).alias("ml_rating_count"),
        pl.col("rating").mean().cast(pl.Float32).alias("ml_mean_rating"),
    )
    catalog = (
        kept.join(stats, left_on="movie_id", right_on="movieId", how="left")
        .sort("movie_id")
        .with_columns(
            pl.int_range(pl.len(), dtype=pl.Int32).alias("item_idx"),
            pl.col("tmdb_id").is_null().alias("needs_tmdb_lookup"),
            pl.col("ml_year").is_null().alias("missing_year"),
        )
        .select(CATALOG_COLUMNS)
    )
    report["catalog"] = catalog

    PROCESSED.mkdir(parents=True, exist_ok=True)
    catalog.write_parquet(CATALOG_PARQUET, compression="zstd")
    ratings.write_parquet(RATINGS_FILTERED_PARQUET, compression="zstd")
    merges.write_parquet(MERGES_PARQUET, compression="zstd")
    return report


def print_report(r: dict) -> None:
    cat: pl.DataFrame = r["catalog"]
    n = cat.height
    n_excl = sum(r["excluded_by_type"].values())
    merges: pl.DataFrame = r["merges"]
    n_merged = merges.height

    print(f"\n== Catalogue (MIN_RATINGS = {r['min_ratings']}) ==")
    print(f"films >= {r['min_ratings']} notes (avant fusion) : {fmt(r['above_threshold'])}")

    print(f"\ndoublons de tmdb_id : {r['dup_tmdb_rows']} entrées")
    print(f"  fusionnés : {n_merged} movieId -> canonique (le plus noté)")
    print(merges)
    print(
        f"  imdb_id du canonique remplacé par celui du doublon (trouvé dans title.basics) : "
        f"{len(r['overrides'])}"
    )
    conf: pl.DataFrame = r["conflicts"]
    if conf.height:
        print(
            f"  conflits (films différents, écart d'année > {MAX_DUPLICATE_YEAR_GAP}) : "
            f"{conf.height} films, pas fusionnés, tmdb_id vidé -> needs_tmdb_lookup"
        )
        print(conf.select("movie_id", "imdb_id", "tmdb_id", "ml_title", "ml_year"))
    print(
        f"  notes : {fmt(r['reassigned'])} réaffectées ; {fmt(r['collisions'])} utilisateurs "
        f"avaient noté les deux (note la plus récente gardée) ; "
        f"{fmt(r['reassigned_kept'])} réaffectées conservées"
    )
    joined = r["would_join_if_merged_first"]
    print(
        "  seuil calculé avant fusion : "
        + (
            "fusionner d'abord n'aurait rien changé"
            if joined == 0
            else f"fusionner d'abord aurait ajouté {joined} film(s) (non ajoutés)"
        )
    )

    print(f"\nexclus par type IMDb : {fmt(n_excl)}")
    for t, c in r["excluded_by_type"].items():
        print(f"  - {t} : {c}")
    ex = r["excluded_examples"].select("imdb_id", "ml_title", "imdbds_title_type")
    print("  exemples : " + "; ".join(f"{a} {b} ({c})" for a, b, c in ex.iter_rows()))

    print(
        f"\ncalcul : {fmt(r['above_threshold'])} - {fmt(n_excl)} (types) - {fmt(n_merged)} "
        f"(fusions) = {fmt(r['above_threshold'] - n_excl - n_merged)} ; catalogue = {fmt(n)}"
    )
    below = cat.filter(pl.col("ml_rating_count") < r["min_ratings"]).height
    print(f"films sous le seuil après fusion : {below}")
    print(f"ratings_filtered : {fmt(r['ratings_filtered'])} notes")

    print("\n== Contrôles ==")
    dup_mid = cat.filter(pl.col("movie_id").is_duplicated()).height
    dup_imdb = cat.filter(pl.col("imdb_id").is_duplicated())
    dup_tmdb = cat.filter(pl.col("tmdb_id").is_not_null() & pl.col("tmdb_id").is_duplicated())
    print(
        f"doublons movie_id : {dup_mid} ; imdb_id : {dup_imdb.height} ; tmdb_id : {dup_tmdb.height}"
    )
    if dup_imdb.height:
        print(dup_imdb.select("movie_id", "imdb_id", "tmdb_id", "ml_title", "ml_rating_count"))
    with_imdb = int(cat["imdb_id"].is_not_null().sum())
    found = int(cat["imdbds_found"].sum())
    print(f"imdb_id présent : {with_imdb}/{n} ({100 * with_imdb / n:.2f} %)")
    print(
        f"trouvés dans title.basics : {fmt(found)} ({100 * found / n:.2f} %) ; non trouvés "
        f"(gardés, imdbds_found = false) : {n - found} (avant correction des doublons : "
        f"{r['not_found_before']})"
    )
    print(
        f"needs_tmdb_lookup : {int(cat['needs_tmdb_lookup'].sum())} ; "
        f"missing_year : {int(cat['missing_year'].sum())}"
    )
    types = cat.group_by("imdbds_title_type").len().sort("len", descending=True)
    print("types gardés : " + ", ".join(f"{t or 'inconnu'} {c}" for t, c in types.iter_rows()))

    diff = pl.col("ml_year") - pl.col("imdbds_start_year")
    gap = cat.filter(diff.abs() > 1).with_columns(diff.alias("diff"))
    print(f"\nécarts d'année MovieLens vs IMDb > 1 an : {gap.height}")
    print(
        gap.sort("ml_rating_count", descending=True)
        .head(10)
        .select("movie_id", "imdb_id", "ml_title", "ml_year", "imdbds_start_year", "diff")
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--min-ratings", type=int, default=MIN_RATINGS)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    pl.Config.set_tbl_width_chars(150).set_fmt_str_lengths(45).set_tbl_rows(20)
    print_report(build(args.min_ratings))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
