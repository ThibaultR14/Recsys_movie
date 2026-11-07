"""Offline evaluation protocol (step 2, decisions D1 and D3 of docs/etape-2-modele.md).

For each validation/test user:
- candidates = recommendable movies not in their fold-in;
- held-out restricted to recommendable movies; a held-out movie is *relevant* if its rating is
  >= the median rating of the user's fold-in (`recall_all` counts every held-out movie);
- popularity metrics use `ml_rating_count` recomputed on training users only (no leakage).

Users without any relevant movie are excluded from Recall/NDCG (counted), but kept in popularity
and coverage metrics. Results are written as JSON in `data/processed/results/<model>_<split>.json`.

Usage (from `pipeline/`):
    uv run python evaluate.py --model popular --split val
    uv run python evaluate.py --model random --split val
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import numpy as np
import polars as pl
import scipy.sparse as sp

import metrics as m
from config import LONG_TAIL_HEAD_SHARE, PROCESSED, RESULTS_DIR, SPLIT_DIR, TOP_K

CATALOG_PARQUET = PROCESSED / "catalog.parquet"
BATCH_SIZE = 1000


class Model(Protocol):
    name: str

    def scores(self, foldin: sp.csr_matrix) -> np.ndarray: ...


@dataclass
class EvalSet:
    """Fold-in matrix and held-out lists of one evaluation split, users sorted by userId."""

    user_ids: np.ndarray  # (n_users,)
    foldin: sp.csr_matrix  # (n_users, n_items), values = ratings
    heldout: list[np.ndarray]  # recommendable held-out item indices, per user
    relevant: list[np.ndarray]  # relevant subset of `heldout`, per user
    n_heldout_dropped: int  # held-out ratings on non-recommendable movies


@dataclass
class Catalog:
    movie_ids: np.ndarray  # movie_id at each item_idx
    recommendable: np.ndarray  # bool, at each item_idx

    @property
    def n_items(self) -> int:
        return len(self.movie_ids)


def load_catalog() -> Catalog:
    cat = pl.read_parquet(CATALOG_PARQUET, columns=["item_idx", "movie_id", "recommendable"])
    cat = cat.sort("item_idx")
    assert (cat["item_idx"].to_numpy() == np.arange(cat.height)).all(), "item_idx not 0..n-1"
    return Catalog(cat["movie_id"].to_numpy(), cat["recommendable"].to_numpy())


def item_index(catalog: Catalog) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "movieId": catalog.movie_ids,
            "item_idx": np.arange(catalog.n_items, dtype=np.int32),
            "recommendable": catalog.recommendable,
        }
    )


def train_counts(catalog: Catalog, train_path=SPLIT_DIR / "train.parquet") -> np.ndarray:
    """Number of training-user ratings per item_idx."""
    per_movie = pl.scan_parquet(train_path).group_by("movieId").agg(pl.len().alias("n")).collect()
    counts = item_index(catalog).join(per_movie, on="movieId", how="left").sort("item_idx")
    return counts["n"].fill_null(0).to_numpy().astype(np.int64)


def train_ratings(catalog: Catalog) -> sp.csr_matrix:
    """(training users x items) ratings matrix, users in userId order."""
    df = pl.read_parquet(SPLIT_DIR / "train.parquet", columns=["userId", "movieId", "rating"])
    df = df.join(item_index(catalog).select("movieId", "item_idx"), on="movieId")
    rows = df["userId"].rank("dense").cast(pl.Int32).to_numpy() - 1
    m = sp.csr_matrix(
        (df["rating"].to_numpy(), (rows, df["item_idx"].to_numpy())),
        shape=(int(rows.max()) + 1, catalog.n_items),
        dtype=np.float32,
    )
    m.sort_indices()
    return m


def build_eval_set(foldin: pl.DataFrame, heldout: pl.DataFrame, catalog: Catalog) -> EvalSet:
    idx = item_index(catalog)
    foldin = foldin.join(idx, on="movieId", how="inner")
    heldout = heldout.join(idx, on="movieId", how="inner")
    user_ids = np.sort(foldin["userId"].unique().to_numpy())
    row_of = pl.DataFrame({"userId": user_ids, "row": np.arange(len(user_ids), dtype=np.int32)})

    foldin = foldin.join(row_of, on="userId")
    matrix = sp.csr_matrix(
        (
            foldin["rating"].to_numpy().astype(np.float32),
            (foldin["row"].to_numpy(), foldin["item_idx"].to_numpy()),
        ),
        shape=(len(user_ids), catalog.n_items),
    )
    medians = foldin.group_by("userId").agg(median=pl.col("rating").median())

    n_dropped = int((~heldout["recommendable"]).sum())
    held = (
        heldout.filter("recommendable")
        .join(medians, on="userId")
        .with_columns(relevant=pl.col("rating") >= pl.col("median"))
        .group_by("userId")
        .agg(
            items=pl.col("item_idx").sort(),
            rel_items=pl.col("item_idx").filter(pl.col("relevant")).sort(),
        )
    )
    held = row_of.join(held, on="userId", how="left").sort("row")
    empty = np.array([], dtype=np.int32)

    def to_arrays(col: str) -> list[np.ndarray]:
        return [empty if v is None else np.asarray(v, dtype=np.int32) for v in held[col].to_list()]

    return EvalSet(user_ids, matrix, to_arrays("items"), to_arrays("rel_items"), n_dropped)


def load_eval_set(split: str, catalog: Catalog) -> EvalSet:
    foldin = pl.read_parquet(SPLIT_DIR / f"{split}_foldin.parquet")
    heldout = pl.read_parquet(SPLIT_DIR / f"{split}_heldout.parquet")
    return build_eval_set(foldin, heldout, catalog)


def top_k(scores: np.ndarray, foldin: sp.csr_matrix, candidates: np.ndarray, k: int) -> np.ndarray:
    """Top k candidate items per row (best first). `scores` is modified in place."""
    scores[:, ~candidates] = -np.inf
    rows = np.repeat(np.arange(foldin.shape[0]), np.diff(foldin.indptr))
    scores[rows, foldin.indices] = -np.inf
    part = np.argpartition(-scores, k - 1, axis=1)[:, :k]
    part_scores = np.take_along_axis(scores, part, axis=1)
    order = np.argsort(-part_scores, axis=1, kind="stable")
    return np.take_along_axis(part, order, axis=1)


def recommend(
    model: Model, eval_set: EvalSet, candidates: np.ndarray, k: int = TOP_K
) -> np.ndarray:
    """(n_users, k) recommended item indices, users in eval_set order."""
    out = []
    for start in range(0, len(eval_set.user_ids), BATCH_SIZE):
        batch = eval_set.foldin[start : start + BATCH_SIZE]
        out.append(top_k(model.scores(batch), batch, candidates, k))
    return np.vstack(out)


def compute_metrics(
    ranked: np.ndarray,
    eval_set: EvalSet,
    counts: np.ndarray,
    candidates: np.ndarray,
    k: int = TOP_K,
) -> dict:
    is_head = m.head_mask(counts, candidates, LONG_TAIL_HEAD_SHARE)
    per_user: dict[str, Callable[[int], float | None]] = {
        f"recall@{k}": lambda u: m.recall_at_k(ranked[u], eval_set.relevant[u], k),
        f"ndcg@{k}": lambda u: m.ndcg_at_k(ranked[u], eval_set.relevant[u], k),
        f"recall_all@{k}": lambda u: m.recall_at_k(ranked[u], eval_set.heldout[u], k),
        f"pop_moyenne@{k}": lambda u: m.mean_log_popularity(ranked[u], counts, k),
        f"pop_mediane@{k}": lambda u: m.median_popularity(ranked[u], counts, k),
        f"longue_traine@{k}": lambda u: m.long_tail_share(ranked[u], is_head, k),
    }
    users = range(len(eval_set.user_ids))
    out = {name: m.mean_ci(fn(u) for u in users) for name, fn in per_user.items()}
    out[f"couverture@{k}"] = m.coverage(ranked, int(candidates.sum()), k)
    return out


def evaluate(model: Model, split: str, k: int = TOP_K) -> dict:
    catalog = load_catalog()
    eval_set = load_eval_set(split, catalog)
    counts = train_counts(catalog)
    candidates = catalog.recommendable
    t0 = time.perf_counter()
    ranked = recommend(model, eval_set, candidates, k)
    elapsed = time.perf_counter() - t0
    n_users = len(eval_set.user_ids)
    manifest = json.loads((SPLIT_DIR / "manifest.json").read_text())
    return {
        "model": model.name,
        "split": split,
        "k": k,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "split_sha256": manifest["sha256"],
        "popularity_source": "ml_rating_count (training users only)",
        "n_users": n_users,
        "n_users_no_relevant": sum(len(r) == 0 for r in eval_set.relevant),
        "n_users_no_heldout": sum(len(h) == 0 for h in eval_set.heldout),
        "n_heldout_non_recommendable_dropped": eval_set.n_heldout_dropped,
        "n_candidates_max": int(candidates.sum()),
        "recommend_seconds": round(elapsed, 2),
        "metrics": compute_metrics(ranked, eval_set, counts, candidates, k),
    }


def build_model(name: str) -> Model:
    from baselines import PopularModel, RandomModel

    catalog = load_catalog()
    if name == "popular":
        return PopularModel(train_counts(catalog))
    if name == "random":
        return RandomModel(catalog.n_items)
    raise ValueError(f"unknown model {name!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model", required=True, choices=["popular", "random"])
    parser.add_argument("--split", required=True, choices=["val", "test"])
    args = parser.parse_args()
    result = evaluate(build_model(args.model), args.split)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{args.model}_{args.split}.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(f"-> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
