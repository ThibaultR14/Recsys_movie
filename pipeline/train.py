"""Train and evaluate ALS (step 2, C2 of docs/etape-2-modele.md).

Training users only (split/train.parquet); validation/test users are folded in, like on the site.

Subcommands (from `pipeline/`):
    uv run python train.py check-foldin          # NumPy fold-in vs implicit.recalculate_user
    uv run python train.py time                  # time one config (factors 64, 15 iterations)
    uv run python train.py search                # ~30 random configs on validation (resumable)
    uv run python train.py run --factors 64 --regularization 0.05 --alpha 10 --beta 1 \
        --iterations 30 [--split test]           # one config; the test split refuses to overwrite
"""

from __future__ import annotations

import os

# Must be set before NumPy is imported (recommendation of implicit).
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import argparse  # noqa: E402
import itertools  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from datetime import UTC, datetime  # noqa: E402

import numpy as np  # noqa: E402
import scipy.sparse as sp  # noqa: E402

import evaluate as ev  # noqa: E402
from config import RESULTS_DIR, SEED  # noqa: E402
from models import als  # noqa: E402

SEARCH_DIR = RESULTS_DIR / "als_search"
GRID = {
    "factors": [32, 64, 128],
    "regularization": [0.01, 0.05, 0.1, 0.5],
    "alpha": [1, 5, 10, 20, 40],
    "beta": [0, 1, 3],
}
N_SEARCH = 30
SEARCH_ITERATIONS = 15
REFERENCE_CONFIG = {"factors": 64, "regularization": 0.05, "alpha": 10, "beta": 1}
N_FOLDIN_CHECK = 200


train_ratings = ev.train_ratings  # moved to evaluate.py (shared with train_ease.py)


def config_key(cfg: dict) -> str:
    return "f{factors:g}_r{regularization:g}_a{alpha:g}_b{beta:g}_i{iterations:g}".format(**cfg)


def search_configs(n: int = N_SEARCH, seed: int = SEED) -> list[dict]:
    """n distinct configs drawn at random from GRID (reproducible)."""
    grid = [dict(zip(GRID, values, strict=True)) for values in itertools.product(*GRID.values())]
    picks = np.random.default_rng(seed).choice(len(grid), size=n, replace=False)
    return [{**grid[i], "iterations": SEARCH_ITERATIONS} for i in picks]


class Context:
    """Data shared across configs: catalogue, training ratings, signal cache per beta."""

    def __init__(self):
        self.catalog = ev.load_catalog()
        self.ratings = train_ratings(self.catalog)
        self._signal: dict[float, sp.csr_matrix] = {}

    def signal(self, beta: float) -> sp.csr_matrix:
        if beta not in self._signal:
            self._signal = {beta: als.signal_values(self.ratings, beta)}  # keep one: RAM
        return self._signal[beta]


def fit(ctx: Context, cfg: dict):
    t0 = time.perf_counter()
    model = als.train(
        ctx.signal(cfg["beta"]),
        factors=cfg["factors"],
        regularization=cfg["regularization"],
        alpha=cfg["alpha"],
        iterations=cfg["iterations"],
    )
    return model, time.perf_counter() - t0


def run_config(ctx: Context, cfg: dict, split: str) -> dict:
    model, train_s = fit(ctx, cfg)
    adapter = als.ALSModel(
        model.item_factors,
        regularization=cfg["regularization"],
        alpha=cfg["alpha"],
        beta=cfg["beta"],
        name=f"als_{config_key(cfg)}",
    )
    t0 = time.perf_counter()
    result = ev.evaluate(adapter, split)
    result["config"] = cfg
    result["train_seconds"] = round(train_s, 1)
    result["eval_seconds"] = round(time.perf_counter() - t0, 1)
    return result


def cmd_check_foldin(ctx: Context) -> dict:
    """D4 criterion: cosine > 0.999 and identical top 20 for >= 95 % of 200 val users."""
    cfg = {**REFERENCE_CONFIG, "iterations": SEARCH_ITERATIONS}
    model, _ = fit(ctx, cfg)
    eval_set = ev.load_eval_set("val", ctx.catalog)
    users = np.sort(
        np.random.default_rng(SEED).choice(len(eval_set.user_ids), N_FOLDIN_CHECK, replace=False)
    )
    ratings = eval_set.foldin[users]
    signal = als.signal_values(ratings, cfg["beta"])
    ours = als.fold_in(
        model.item_factors, signal, regularization=cfg["regularization"], alpha=cfg["alpha"]
    )
    theirs = np.asarray(model.recalculate_user(np.arange(len(users)), signal), dtype=np.float64)
    cos = (ours * theirs).sum(1) / (np.linalg.norm(ours, axis=1) * np.linalg.norm(theirs, axis=1))
    Y = model.item_factors.astype(np.float64)
    cand = ctx.catalog.recommendable
    top_ours = ev.top_k(ours @ Y.T, ratings, cand, 20)
    top_theirs = ev.top_k(theirs @ Y.T, ratings, cand, 20)
    same_order = (top_ours == top_theirs).all(axis=1)
    same_set = np.array([set(a) == set(b) for a, b in zip(top_ours, top_theirs, strict=True)])
    rel_err = np.linalg.norm(ours - theirs, axis=1) / np.linalg.norm(theirs, axis=1)
    out = {
        "config": cfg,
        "n_users": len(users),
        "cosine_min": float(cos.min()),
        "cosine_mean": float(cos.mean()),
        "relative_l2_error_max": float(rel_err.max()),
        "top20_same_order_share": float(same_order.mean()),
        "top20_same_set_share": float(same_set.mean()),
        "passed": bool(cos.min() > 0.999 and same_order.mean() >= 0.95),
    }
    return out


def cmd_time(ctx: Context) -> dict:
    cfg = {**REFERENCE_CONFIG, "iterations": SEARCH_ITERATIONS}
    result = run_config(ctx, cfg, "val")
    return {k: result[k] for k in ("config", "train_seconds", "eval_seconds")} | {
        "ndcg@20": result["metrics"]["ndcg@20"]
    }


def cmd_search(ctx: Context) -> None:
    SEARCH_DIR.mkdir(parents=True, exist_ok=True)
    configs = search_configs()
    # group by beta to reuse the signal matrix; order otherwise fixed
    for i, cfg in sorted(enumerate(configs), key=lambda t: (t[1]["beta"], t[0])):
        path = SEARCH_DIR / f"{config_key(cfg)}.json"
        if path.exists():
            print(f"[{i + 1:2d}/{len(configs)}] skip {path.name}", flush=True)
            continue
        result = run_config(ctx, cfg, "val")
        result["search_index"] = i
        path.write_text(json.dumps(result, indent=2) + "\n")
        ndcg = result["metrics"]["ndcg@20"]
        print(
            f"[{i + 1:2d}/{len(configs)}] {config_key(cfg)} ndcg@20={ndcg['mean']:.5f}"
            f" ± {ndcg['ci95']:.5f} train={result['train_seconds']}s",
            flush=True,
        )


def cmd_run(ctx: Context, cfg: dict, split: str, force: bool) -> dict:
    path = RESULTS_DIR / f"als_{config_key(cfg)}_{split}.json"
    if split == "test" and path.exists() and not force:
        raise SystemExit(f"{path.name} exists: the test split is evaluated once per model")
    result = run_config(ctx, cfg, split)
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(f"-> {path}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check-foldin")
    sub.add_parser("time")
    sub.add_parser("search")
    run = sub.add_parser("run")
    run.add_argument("--factors", type=int, required=True)
    run.add_argument("--regularization", type=float, required=True)
    run.add_argument("--alpha", type=float, required=True)
    run.add_argument("--beta", type=float, required=True)
    run.add_argument("--iterations", type=int, default=SEARCH_ITERATIONS)
    run.add_argument("--split", choices=["val", "test"], default="val")
    run.add_argument("--force", action="store_true")
    args = parser.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ctx = Context()
    stamp = datetime.now(UTC).isoformat(timespec="seconds")
    if args.cmd == "check-foldin":
        out = cmd_check_foldin(ctx) | {"created_at": stamp}
        (RESULTS_DIR / "als_foldin_check.json").write_text(json.dumps(out, indent=2) + "\n")
        print(json.dumps(out, indent=2))
    elif args.cmd == "time":
        print(json.dumps(cmd_time(ctx), indent=2))
    elif args.cmd == "search":
        cmd_search(ctx)
    else:
        cfg = {
            "factors": args.factors,
            "regularization": args.regularization,
            "alpha": args.alpha,
            "beta": args.beta,
            "iterations": args.iterations,
        }
        result = cmd_run(ctx, cfg, args.split, args.force)
        print(json.dumps(result["metrics"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
