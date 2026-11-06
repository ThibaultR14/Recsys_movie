"""Exploration: movies per rating threshold, what they cover, and how big the site data gets.

Measurement only: nothing is written outside the console. Run from `pipeline/`:
    uv run python notebooks/01_explore.py

Size estimates use real MovieLens fields (id, title, year, imdbId, tmdbId) and *synthetic*
placeholders for the TMDB fields we don't have yet (original title, poster path, director).
The placeholders are random strings, which compress worse than real text: the estimate is an
upper bound. IMDb `title.basics` is only used here for the offline imdbId check.
"""

from __future__ import annotations

import gzip
import json
import random
import re
import string
import sys
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import PROCESSED, RAW  # noqa: E402

THRESHOLDS = (5, 10, 20, 30, 50, 100)
FOCUS = 20
EMB_DIMS = 64
POSTER_RATE = 0.98  # share of catalogue movies assumed to have a TMDB poster
DIRECTORS_PER_MOVIE = 0.4  # distinct directors / movies (directors repeat across films)

ML = RAW / "ml-32m"
YEAR_RE = re.compile(r"\((\d{4})(?:[-–]\d{0,4})?\)\s*$")
# "City of Lost Children, The (Cité des enfants perdus, La) (1995)" -> alt title in parentheses
ALT_RE = re.compile(r"^(.*?)\s*\((?:a\.k\.a\. )?([^()]+)\)\s*$")


def fmt_int(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def fmt_size(n: int) -> str:
    return f"{n / 1e6:.2f} Mo" if n >= 1e5 else f"{n / 1e3:.0f} ko"


def table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    print("| " + " | ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True)) + " |")
    print("|" + "|".join("-" * (w + 2) for w in widths) + "|")
    for r in rows:
        print("| " + " | ".join(c.rjust(w) for c, w in zip(r, widths, strict=True)) + " |")
    print()


def split_title(raw: str) -> tuple[str, str, int | None]:
    """MovieLens 'Title, The (Original) (1995)' -> (title, original title, year)."""
    raw = raw.strip()
    year = None
    if m := YEAR_RE.search(raw):
        year = int(m.group(1))
        raw = raw[: m.start()].strip()
    title, original = raw, raw
    if m := ALT_RE.match(raw):
        title, original = m.group(1), m.group(2)
    return title, original, year


def load() -> pl.DataFrame:
    counts = (
        pl.scan_parquet(PROCESSED / "ratings.parquet")
        .group_by("movieId")
        .agg(pl.len().alias("n_ratings"))
        .collect()
    )
    movies = pl.read_csv(ML / "movies.csv", schema_overrides={"movieId": pl.Int32})
    links = pl.read_csv(
        ML / "links.csv",
        schema_overrides={"movieId": pl.Int32, "imdbId": pl.String, "tmdbId": pl.Int64},
    )
    df = (
        counts.join(movies, on="movieId", how="left")
        .join(links, on="movieId", how="left")
        .with_columns(
            ("tt" + pl.col("imdbId").str.zfill(7)).alias("imdb_tt"),
            pl.col("title")
            .map_elements(lambda t: split_title(t)[2], return_dtype=pl.Int32)
            .alias("year"),
        )
    )
    return df


def section_thresholds(df: pl.DataFrame) -> None:
    total = int(df["n_ratings"].sum())
    print(
        f"## 1. Films par seuil (notes totales : {fmt_int(total)}, films notés : "
        f"{fmt_int(df.height)})\n"
    )
    rows = []
    for t in THRESHOLDS:
        sub = df.filter(pl.col("n_ratings") >= t)
        cov = int(sub["n_ratings"].sum())
        rows.append([f">= {t}", fmt_int(sub.height), fmt_int(cov), f"{100 * cov / total:.2f} %"])
    table(["seuil", "films", "notes couvertes", "part des notes"], rows)


def section_focus(df: pl.DataFrame) -> None:
    sub = df.filter(pl.col("n_ratings") >= FOCUS)
    n = sub.height
    print(f"## 2. Seuil {FOCUS} ({fmt_int(n)} films)\n")

    print("### Répartition par décennie (année du titre MovieLens)\n")
    dec = (
        sub.with_columns((pl.col("year") // 10 * 10).alias("decade"))
        .group_by("decade")
        .agg(pl.len().alias("films"), pl.col("n_ratings").sum().alias("notes"))
        .sort("decade", nulls_last=True)
    )
    rows = [
        [
            "sans année" if d is None else f"{d}s",
            fmt_int(f),
            f"{100 * f / n:.1f} %",
            f"{100 * no / int(sub['n_ratings'].sum()):.1f} %",
        ]
        for d, f, no in dec.iter_rows()
    ]
    table(["décennie", "films", "part films", "part notes"], rows)

    no_tmdb = sub.filter(pl.col("tmdbId").is_null()).height
    no_imdb = sub.filter(pl.col("imdbId").is_null()).height
    print(f"- sans tmdbId dans links.csv : {fmt_int(no_tmdb)} ({100 * no_tmdb / n:.2f} %)")
    print(f"- sans imdbId dans links.csv : {fmt_int(no_imdb)} ({100 * no_imdb / n:.2f} %)")
    dup_tmdb = sub.filter(pl.col("tmdbId").is_not_null() & pl.col("tmdbId").is_duplicated())
    print(f"- tmdbId partagés par plusieurs movieId : {fmt_int(dup_tmdb.height)} films")

    # Offline QA only: IMDb datasets never feed the site.
    basics = (
        pl.scan_csv(
            RAW / "imdb" / "title.basics.tsv.gz",
            separator="\t",
            quote_char=None,
            null_values="\\N",
            infer_schema=False,
        )
        .select(pl.col("tconst").alias("imdb_tt"), pl.col("titleType").alias("imdbds_type"))
        .collect()
    )
    found = sub.join(basics, on="imdb_tt", how="left")
    ok = found.filter(pl.col("imdbds_type").is_not_null()).height
    print(
        f"- imdbId (tt + 7 chiffres min.) présent dans title.basics : {fmt_int(ok)} "
        f"({100 * ok / n:.2f} %) ; absents : {fmt_int(n - ok)}"
    )
    types = (
        found.group_by("imdbds_type").agg(pl.len().alias("films")).sort("films", descending=True)
    )
    print(
        "- titleType IMDb : "
        + ", ".join(f"{t or 'absent'} {fmt_int(c)}" for t, c in types.iter_rows())
    )
    missing = found.filter(pl.col("imdbds_type").is_null()).head(5)
    if missing.height:
        print(
            "- exemples absents : "
            + "; ".join(f"{r['imdb_tt']} {r['title']}" for r in missing.iter_rows(named=True))
        )
    print()


def rand_str(rng: random.Random, alphabet: str, k: int) -> str:
    return "".join(rng.choices(alphabet, k=k))


def catalog_records(sub: pl.DataFrame, rng: random.Random) -> list[dict]:
    base62 = string.ascii_letters + string.digits
    n_dir = max(1, int(sub.height * DIRECTORS_PER_MOVIE))
    directors = [
        f"{rand_str(rng, string.ascii_lowercase, rng.randint(4, 8)).title()} "
        f"{rand_str(rng, string.ascii_lowercase, rng.randint(5, 10)).title()}"
        for _ in range(n_dir)
    ]
    recs = []
    for r in sub.iter_rows(named=True):
        title, original, year = split_title(r["title"])
        recs.append(
            {
                "id": r["movieId"],
                "t": title,
                "ot": original,
                "y": year,
                "imdb": r["imdb_tt"],
                "tmdb": r["tmdbId"],
                "p": f"/{rand_str(rng, base62, 27)}.jpg" if rng.random() < POSTER_RATE else None,
                "d": rng.choice(directors),
            }
        )
    return recs


def gz(data: bytes) -> int:
    return len(gzip.compress(data, compresslevel=9))


def section_sizes(df: pl.DataFrame) -> None:
    import numpy as np

    print("## 3. Taille estimée des fichiers du site (gzip niveau 9)\n")
    print(
        f"catalog.json : objets à clés courtes ; champs TMDB simulés (affiche {POSTER_RATE:.0%}, "
        f"{DIRECTORS_PER_MOVIE} réalisateur distinct / film). "
        f"Embeddings : {EMB_DIMS} dims int8 + 1 échelle float32 par film. "
        "Popularité : uint32 (nombre de notes).\n"
    )
    rows = []
    for t in THRESHOLDS:
        sub = df.filter(pl.col("n_ratings") >= t).sort("movieId")
        n = sub.height
        rng = random.Random(t)
        recs = catalog_records(sub, rng)
        cat_raw = json.dumps(recs, ensure_ascii=False, separators=(",", ":")).encode()
        # Columnar variant: one array per field, keys written once.
        cols = {k: [r[k] for r in recs] for k in recs[0]}
        col_raw = json.dumps(cols, ensure_ascii=False, separators=(",", ":")).encode()

        # Trained ALS factors are roughly Gaussian: int8-quantized they barely compress.
        emb = np.clip(np.random.default_rng(t).normal(0, 40, (n, EMB_DIMS)), -127, 127)
        emb_bytes = emb.astype(np.int8).tobytes() + np.ones(n, np.float32).tobytes()
        pop_bytes = sub["n_ratings"].cast(pl.UInt32).to_numpy().tobytes()

        cat_gz, col_gz, emb_gz, pop_gz = gz(cat_raw), gz(col_raw), gz(emb_bytes), gz(pop_bytes)
        total = col_gz + emb_gz + pop_gz
        rows.append(
            [
                f">= {t}",
                fmt_int(n),
                f"{fmt_size(len(cat_raw))} -> {fmt_size(cat_gz)}",
                fmt_size(col_gz),
                f"{fmt_size(len(emb_bytes))} -> {fmt_size(emb_gz)}",
                fmt_size(pop_gz),
                fmt_size(total),
            ]
        )
    table(
        [
            "seuil",
            "films",
            "catalog.json (brut -> gz)",
            "catalog colonnes gz",
            "embeddings (brut -> gz)",
            "popularité gz",
            "total gz (colonnes)",
        ],
        rows,
    )


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    df = load()
    section_thresholds(df)
    section_focus(df)
    section_sizes(df)


if __name__ == "__main__":
    main()
