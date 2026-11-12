"""Card tags of step 6c, Q6 (docs/etape-6c-qualite.md, section 8): measures before any threshold.

    uv run python tag_diagnostics.py stats   # std of MovieLens ratings, old films x popularity

- « ça divise »: standard deviation of the MovieLens ratings of each film (all users, merged ids:
  the union of the split files is exactly the catalogue's ratings), distribution over the
  catalogue (>= 20 ratings), candidate thresholds (most dispersed 5 / 10 / 15 / 20 %), relation
  with the number of ratings, size it would add to catalog.json (x 100, int).
- « vieux trésor »: films released before 1960 / 1970 / 1980, by popularity (popularity.bin of the
  site, the slider's measure).

Writes `web/test-data/tag_stats.json` (ignored by git, never served): `ml_std_x100` and `year` per
item_idx, read by `web/scripts/tags-report.ts`; catalogue-level numbers only, no user data.
Summary in data/processed/results/quality/tags_stats.json (ignored).
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys

import numpy as np
import polars as pl

from config import PROCESSED, RESULTS_DIR, WEB_DATA

SPLIT_FILES = ("train", "val_foldin", "val_heldout", "test_foldin", "test_heldout")
TEST_DATA = WEB_DATA.parent.parent / "test-data"
OUT = RESULTS_DIR / "quality" / "tags_stats.json"
TOP_SHARES = (0.05, 0.10, 0.15, 0.20)
YEARS = (1960, 1970, 1980)
POP_CAPS = (200, 500, 1_000, 2_000, 5_000, 10_000)
SHRINK_K = 50


def rating_std(ratings: pl.LazyFrame) -> pl.DataFrame:
    """movieId -> (population) standard deviation and count of its ratings."""
    return (
        ratings.group_by("movieId")
        .agg(pl.col("rating").std(ddof=0).alias("std"), pl.len().alias("n"))
        .collect()
    )


def cmd_stats() -> dict:
    sys.stdout.reconfigure(encoding="utf-8")
    ratings = pl.concat(
        [pl.scan_parquet(PROCESSED / "split" / f"{f}.parquet") for f in SPLIT_FILES]
    )
    cat = pl.read_parquet(
        PROCESSED / "catalog.parquet",
        columns=["item_idx", "movie_id", "ml_rating_count", "year", "recommendable"],
    ).sort("item_idx")
    stats = rating_std(ratings)
    cat = cat.join(stats, left_on="movie_id", right_on="movieId", how="left").sort("item_idx")
    assert (cat["n"] == cat["ml_rating_count"]).all(), "ratings of the split != catalogue counts"
    std = cat["std"].to_numpy()
    n = cat["n"].to_numpy()
    rec = cat["recommendable"].to_numpy()
    pop = np.fromfile(WEB_DATA / "popularity.bin", dtype="<u4")
    assert len(pop) == cat.height, "popularity.bin != catalogue"
    year = cat["year"].to_numpy()

    qs = (0.01, 0.05, 0.10, 0.25, 0.5, 0.75, 0.80, 0.85, 0.90, 0.95, 0.99)
    out: dict = {
        "films": int(cat.height),
        "std_quantiles": {str(q): round(float(np.quantile(std, q)), 3) for q in qs},
        "std_mean": round(float(std.mean()), 3),
    }
    thresholds = {}
    for share in TOP_SHARES:
        th = float(np.quantile(std, 1 - share))
        thresholds[str(share)] = round(th, 3)
    out["std_threshold_for_top_share"] = thresholds
    # does a small number of ratings inflate the std? share in the top 10 % by count bucket
    th10 = thresholds["0.1"]
    buckets = [(20, 50), (50, 200), (200, 1_000), (1_000, 10_000), (10_000, 10**9)]
    out["top10_share_by_ratings"] = {
        f"{lo}-{hi if hi < 10**9 else '∞'}": {
            "films": int(((n >= lo) & (n < hi)).sum()),
            "share_top10": round(float((std[(n >= lo) & (n < hi)] >= th10).mean()), 3),
        }
        for lo, hi in buckets
    }
    out["top10_share_by_popularity"] = {
        f"<= {cap}": round(float((std[pop <= cap] >= th10).mean()), 3) for cap in POP_CAPS
    }
    old = {}
    for y in YEARS:
        is_old = (year < y) & rec
        old[str(y)] = {
            "films": int(is_old.sum()),
            "share_of_recommendable": round(float(is_old.sum() / rec.sum()), 3),
            "by_popularity_cap": {str(cap): int((is_old & (pop <= cap)).sum()) for cap in POP_CAPS},
        }
    out["old_films"] = old
    # shrunk variant: the variance pulled towards the catalogue mean with SHRINK_K pseudo-ratings,
    # so that a film with 20 ratings needs more evidence than one with 20 000
    vbar = float((std**2).mean())
    shrunk = np.sqrt((n * std**2 + SHRINK_K * vbar) / (n + SHRINK_K))
    th10s = float(np.quantile(shrunk, 0.9))
    out["shrunk"] = {
        "k": SHRINK_K,
        "threshold_for_top_share": {
            str(s): round(float(np.quantile(shrunk, 1 - s)), 3) for s in TOP_SHARES
        },
        "top10_share_by_ratings": {
            f"{lo}-{hi if hi < 10**9 else '∞'}": round(
                float((shrunk[(n >= lo) & (n < hi)] >= th10s).mean()), 3
            )
            for lo, hi in buckets
        },
        "top10_share_by_popularity": {
            f"<= {cap}": round(float((shrunk[pop <= cap] >= th10s).mean()), 3) for cap in POP_CAPS
        },
    }
    # catalog.json size if added (int, std x 100)
    x100 = [int(round(s * 100)) for s in std]
    blob = json.dumps({"ml_std": x100}, separators=(",", ":")).encode()
    out["catalog_json_added_bytes"] = {"raw": len(blob), "gzip": len(gzip.compress(blob, 9))}
    x10 = [int(round(s * 10)) for s in std]
    blob10 = json.dumps({"ml_std": x10}, separators=(",", ":")).encode()
    out["catalog_json_added_bytes_x10"] = {
        "raw": len(blob10),
        "gzip": len(gzip.compress(blob10, 9)),
    }

    TEST_DATA.mkdir(parents=True, exist_ok=True)
    (TEST_DATA / "tag_stats.json").write_text(
        json.dumps(
            {
                "ml_std_x100": x100,
                "ml_std_shrunk_x100": [int(round(s * 100)) for s in shrunk],
                "year": [None if y is None else int(y) for y in cat["year"].to_list()],
            }
        )
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["stats"])
    parser.parse_args()
    cmd_stats()
    return 0


if __name__ == "__main__":
    sys.exit(main())
