import numpy as np
import polars as pl

import split


def make_ratings(n_per_user: dict[int, int]) -> pl.DataFrame:
    rows = []
    for user, n in n_per_user.items():
        for i in range(n):
            # two ratings share each timestamp: ties broken by movieId
            rows.append((user, 1000 - i, float(1 + i % 5), 100 + i // 2))
    return pl.DataFrame(rows, schema=split.RATING_COLUMNS, orient="row").with_columns(
        pl.col("userId", "movieId").cast(pl.Int32), pl.col("rating").cast(pl.Float32)
    )


def test_assign_roles_disjoint_and_eligible():
    ratings = make_ratings({u: (5 if u % 4 == 0 else 12) for u in range(1, 41)})
    users = split.assign_roles(ratings, seed=1, n_val=5, n_test=6, min_ratings=10)
    assert users.height == 40
    assert users["userId"].n_unique() == 40
    counts = dict(users["role"].value_counts().iter_rows())
    assert counts == {"test": 6, "train": 29, "val": 5}
    # ineligible users are always train
    assert (users.filter(~pl.col("eligible"))["role"] == "train").all()


def test_assign_roles_reproducible():
    ratings = make_ratings({u: 12 for u in range(1, 31)})
    a = split.assign_roles(ratings, seed=7, n_val=4, n_test=4, min_ratings=10)
    b = split.assign_roles(ratings, seed=7, n_val=4, n_test=4, min_ratings=10)
    assert a.equals(b)


def test_split_history_sizes_and_order():
    hist = split.split_history(make_ratings({1: 10, 2: 13, 3: 1}))
    sizes = hist.group_by("userId").agg(f=pl.col("foldin").sum(), n=pl.len()).sort("userId")
    assert sizes["f"].to_list() == [8, 10, 0]  # floor(0.8 n); a single rating goes to held-out
    for _, g in hist.group_by("userId"):
        fold, held = g.filter("foldin"), g.filter(~pl.col("foldin"))
        if fold.height:
            assert held["timestamp"].min() >= fold["timestamp"].max()
    # tie on timestamp: lower movieId goes first
    u1 = hist.filter(pl.col("userId") == 1).select("timestamp", "movieId").rows()
    assert u1 == sorted(u1)
    # the split point falls inside a tie (ts 103 holds ranks 6-7, ts 104 ranks 8-9)
    u1_fold = hist.filter((pl.col("userId") == 1) & pl.col("foldin"))
    assert u1_fold["timestamp"].max() == 103


def test_split_ratings_and_checks(monkeypatch):
    monkeypatch.setattr(split, "N_VAL_USERS", 3)
    monkeypatch.setattr(split, "N_TEST_USERS", 3)
    ratings = make_ratings({u: 10 + u for u in range(1, 21)})
    users = split.assign_roles(ratings, seed=3, n_val=3, n_test=3, min_ratings=10)
    tables = split.split_ratings(ratings, users)
    counts = split.check_split(tables)
    assert counts["train"] == 14
    total = sum(tables[n].height for n in split.SPLIT_FILES if n != "users")
    assert total == ratings.height
    u = tables["users"].filter(pl.col("role") != "train")
    assert (u["n_foldin"] + u["n_heldout"] == u["n_ratings"]).all()
    assert np.all(u["n_foldin"].to_numpy() == (u["n_ratings"].to_numpy() * 4) // 5)
