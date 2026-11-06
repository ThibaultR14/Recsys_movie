"""Split users for offline evaluation (step 2, C1, decision D1 of docs/etape-2-modele.md).

- Eligible users: at least MIN_EVAL_USER_RATINGS ratings in the catalogue.
- N_VAL_USERS validation and N_TEST_USERS test users drawn at random (SEED) among eligible users;
  every other user is a training user, with all their ratings. Validation/test users never appear
  in the training matrix: their vector is computed by fold-in, like on the website.
- Per validation/test user: ratings sorted by (timestamp, movieId); the oldest 80 % (rounded down)
  form the fold-in, the most recent 20 % (at least 1) the held-out.

The held-out keeps every movie, recommendable or not: restricting it to recommendable movies is
done at evaluation time (evaluate.py), so the split does not depend on catalogue flags.

Outputs in `data/processed/split/`: train, val_foldin, val_heldout, test_foldin, test_heldout,
users (userId -> role) and `manifest.json` (sha256 of each file, to check reproducibility).

Usage (from `pipeline/`):
    uv run python split.py
"""

from __future__ import annotations

import hashlib
import json
import sys

import numpy as np
import polars as pl

from config import (
    FOLDIN_DEN,
    FOLDIN_NUM,
    MIN_EVAL_USER_RATINGS,
    N_TEST_USERS,
    N_VAL_USERS,
    PROCESSED,
    SEED,
    SPLIT_DIR,
)

RATINGS_FILTERED_PARQUET = PROCESSED / "ratings_filtered.parquet"
RATING_COLUMNS = ["userId", "movieId", "rating", "timestamp"]
ROLES = ("train", "val", "test")
SPLIT_FILES = (
    "train",
    "val_foldin",
    "val_heldout",
    "test_foldin",
    "test_heldout",
    "users",
)


def assign_roles(
    ratings: pl.DataFrame,
    *,
    seed: int = SEED,
    n_val: int = N_VAL_USERS,
    n_test: int = N_TEST_USERS,
    min_ratings: int = MIN_EVAL_USER_RATINGS,
) -> pl.DataFrame:
    """One row per user: userId, n_ratings, eligible, role. Sorted by userId."""
    users = (
        ratings.group_by("userId")
        .agg(pl.len().cast(pl.Int32).alias("n_ratings"))
        .sort("userId")
        .with_columns(eligible=pl.col("n_ratings") >= min_ratings)
    )
    eligible = users.filter("eligible")["userId"].to_numpy()  # sorted: draw is reproducible
    if len(eligible) < n_val + n_test:
        raise ValueError(f"only {len(eligible)} eligible users for {n_val} + {n_test}")
    drawn = np.random.default_rng(seed).permutation(eligible)
    role_of = pl.DataFrame(
        {
            "userId": np.concatenate([drawn[:n_val], drawn[n_val : n_val + n_test]]),
            "role": ["val"] * n_val + ["test"] * n_test,
        },
        schema={"userId": pl.Int32, "role": pl.String},
    )
    return users.join(role_of, on="userId", how="left").with_columns(
        pl.col("role").fill_null("train")
    )


def split_history(ratings: pl.DataFrame) -> pl.DataFrame:
    """Add `n_foldin` and a boolean `foldin` column: oldest 80 % (rounded down) of each user.

    Ratings are ordered by (timestamp, movieId). The held-out always has at least 1 rating
    (users with a single rating get an empty fold-in; never the case for eligible users).
    """
    n = pl.len().over("userId")
    n_foldin = pl.min_horizontal((n * FOLDIN_NUM) // FOLDIN_DEN, n - 1)
    return (
        ratings.sort(["userId", "timestamp", "movieId"])
        .with_columns(
            rank=pl.int_range(pl.len()).over("userId"),
            n_foldin=n_foldin.cast(pl.Int32),
        )
        .with_columns(foldin=pl.col("rank") < pl.col("n_foldin"))
        .drop("rank")
    )


def split_ratings(ratings: pl.DataFrame, users: pl.DataFrame) -> dict[str, pl.DataFrame]:
    """Return the split tables (see SPLIT_FILES), every rating table sorted."""
    with_role = ratings.join(users.select("userId", "role"), on="userId", how="inner")
    out: dict[str, pl.DataFrame] = {
        "train": with_role.filter(pl.col("role") == "train")
        .select(RATING_COLUMNS)
        .sort(["userId", "movieId"])
    }
    split_counts = []
    for role in ("val", "test"):
        hist = split_history(with_role.filter(pl.col("role") == role).select(RATING_COLUMNS))
        out[f"{role}_foldin"] = hist.filter("foldin").select(RATING_COLUMNS)
        out[f"{role}_heldout"] = hist.filter(~pl.col("foldin")).select(RATING_COLUMNS)
        split_counts.append(hist.group_by("userId").agg(pl.col("n_foldin").first()))
    n_foldin = pl.concat(split_counts)
    out["users"] = (
        users.join(n_foldin, on="userId", how="left")
        .with_columns(n_heldout=pl.col("n_ratings") - pl.col("n_foldin"))
        .select("userId", "role", "n_ratings", "eligible", "n_foldin", "n_heldout")
        .sort("userId")
    )
    return out


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_split(tables: dict[str, pl.DataFrame]) -> dict[str, int]:
    """Check the C1 criteria; raise on failure. Return counts for the report."""
    users = tables["users"]
    counts = {role: int((users["role"] == role).sum()) for role in ROLES}
    counts["eligible"] = int(users["eligible"].sum())
    counts["all_users"] = users.height
    assert users["userId"].n_unique() == users.height, "a user has two roles"
    assert counts["val"] == N_VAL_USERS and counts["test"] == N_TEST_USERS
    train_users = set(tables["train"]["userId"].unique().to_list())
    for role in ("val", "test"):
        fold, held = tables[f"{role}_foldin"], tables[f"{role}_heldout"]
        role_users = set(users.filter(pl.col("role") == role)["userId"].to_list())
        assert not role_users & train_users, f"{role} user in train"
        per_user = (
            fold.group_by("userId")
            .agg(n_f=pl.len(), last_f=pl.col("timestamp").max())
            .join(
                held.group_by("userId").agg(n_h=pl.len(), first_h=pl.col("timestamp").min()),
                on="userId",
                how="full",
                coalesce=True,
            )
        )
        assert set(per_user["userId"].to_list()) == role_users
        assert per_user["n_f"].min() >= 8, f"{role}: fold-in < 8"
        assert per_user["n_h"].min() >= 2, f"{role}: held-out < 2"
        assert (per_user["first_h"] >= per_user["last_f"]).all(), f"{role}: held-out before fold-in"
        counts[f"{role}_foldin_ratings"] = fold.height
        counts[f"{role}_heldout_ratings"] = held.height
    counts["train_ratings"] = tables["train"].height
    return counts


def main() -> int:
    ratings = pl.read_parquet(RATINGS_FILTERED_PARQUET, columns=RATING_COLUMNS)
    users = assign_roles(ratings)
    tables = split_ratings(ratings, users)
    del ratings
    counts = check_split(tables)
    SPLIT_DIR.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in SPLIT_FILES:
        path = SPLIT_DIR / f"{name}.parquet"
        tables[name].write_parquet(path, statistics=False)
        hashes[path.name] = sha256(path)
    manifest = {"seed": SEED, "counts": counts, "sha256": hashes}
    (SPLIT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
