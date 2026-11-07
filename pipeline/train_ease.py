"""Train and evaluate EASE (step 2, C3 of docs/etape-2-modele.md). Comparison only, never exported.

Needs ~7 GB of free RAM for the 23 019-item catalogue: run it on Google Colab
(`notebooks/ease_colab.ipynb`) if the local machine does not have it.

Subcommands (from `pipeline/`):
    uv run python train_ease.py ram                 # free RAM vs what EASE needs
    uv run python train_ease.py search              # λ_ease x {β retained, binary} on validation
    uv run python train_ease.py best --split test   # best validation config, evaluated once on test
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from datetime import UTC, datetime

import numpy as np

import evaluate as ev
from config import RESULTS_DIR
from evaluate import train_ratings
from models import als, ease

EASE_DIR = RESULTS_DIR / "ease"
LAMBDAS = [100, 300, 1_000, 3_000, 10_000]
BETA_RETAINED = 1  # beta of the ALS configuration retained in C2 (A and B both use beta = 1)
BETAS = [BETA_RETAINED, 0]  # 0 = binary variant
GIB = 2**30


def available_ram() -> int | None:
    try:
        import psutil
    except ImportError:
        return None
    return psutil.virtual_memory().available


def ram_report(n_items: int) -> dict:
    avail = available_ram()
    need = ease.bytes_needed(n_items)
    return {
        "n_items": n_items,
        "needed_gib": round(need / GIB, 2),
        "available_gib": None if avail is None else round(avail / GIB, 2),
        "enough": None if avail is None else avail >= need * 1.15,
        "host": platform.node(),
        "numpy": np.__version__,
    }


def key(beta: float, lam: float) -> str:
    return f"ease_b{beta:g}_l{lam:g}"


def run_one(G: np.ndarray, beta: float, lam: float, split: str, gram_s: float) -> dict:
    t0 = time.perf_counter()
    B = ease.fit_from_gram(G, lam)
    fit_s = time.perf_counter() - t0
    result = ev.evaluate(ease.EASEModel(B, beta=beta, name=key(beta, lam)), split)
    result["config"] = {"lambda": lam, "beta": beta}
    result["gram_seconds"] = round(gram_s, 1)
    result["fit_seconds"] = round(fit_s, 1)
    result["ram"] = ram_report(G.shape[0])
    return result


def gram_for(ctx_ratings, beta: float) -> tuple[np.ndarray, float]:
    t0 = time.perf_counter()
    G = ease.gram(als.signal_values(ctx_ratings, beta))
    return G, time.perf_counter() - t0


def cmd_search(force_ram: bool) -> None:
    catalog = ev.load_catalog()
    report = ram_report(catalog.n_items)
    print(json.dumps(report), flush=True)
    if report["enough"] is False and not force_ram:
        raise SystemExit("not enough free RAM for EASE: use notebooks/ease_colab.ipynb")
    EASE_DIR.mkdir(parents=True, exist_ok=True)
    ratings = train_ratings(catalog)
    for beta in BETAS:
        todo = [lam for lam in LAMBDAS if not (EASE_DIR / f"{key(beta, lam)}_val.json").exists()]
        if not todo:
            print(f"beta={beta:g}: all done", flush=True)
            continue
        G, gram_s = gram_for(ratings, beta)
        print(f"beta={beta:g}: gram {gram_s:.0f}s", flush=True)
        for lam in todo:
            result = run_one(G, beta, lam, "val", gram_s)
            path = EASE_DIR / f"{key(beta, lam)}_val.json"
            path.write_text(json.dumps(result, indent=2) + "\n")
            ndcg = result["metrics"]["ndcg@20"]
            print(
                f"{key(beta, lam)} ndcg@20={ndcg['mean']:.5f} ± {ndcg['ci95']:.5f}"
                f" fit={result['fit_seconds']}s",
                flush=True,
            )
        del G


def best_val_config() -> dict:
    rows = []
    for path in sorted(EASE_DIR.glob("ease_*_val.json")):
        r = json.loads(path.read_text())
        rows.append((r["metrics"]["ndcg@20"]["mean"], r["config"]))
    expected = len(LAMBDAS) * len(BETAS)
    if len(rows) != expected:
        raise SystemExit(f"{len(rows)}/{expected} validation results: run `search` first")
    return max(rows, key=lambda t: t[0])[1]


def cmd_best(split: str) -> None:
    cfg = best_val_config()
    beta, lam = cfg["beta"], cfg["lambda"]
    path = RESULTS_DIR / f"{key(beta, lam)}_{split}.json"
    if path.exists():
        raise SystemExit(f"{path.name} exists: the test split is evaluated once per model")
    catalog = ev.load_catalog()
    G, gram_s = gram_for(train_ratings(catalog), beta)
    result = run_one(G, beta, lam, split, gram_s)
    result["selected_on"] = "validation ndcg@20"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["metrics"], indent=2))
    print(f"-> {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ram")
    search = sub.add_parser("search")
    search.add_argument("--force-ram", action="store_true", help="run even if RAM looks short")
    best = sub.add_parser("best")
    best.add_argument("--split", choices=["test"], default="test")
    args = parser.parse_args()
    stamp = datetime.now(UTC).isoformat(timespec="seconds")
    if args.cmd == "ram":
        print(json.dumps(ram_report(ev.load_catalog().n_items) | {"at": stamp}, indent=2))
    elif args.cmd == "search":
        cmd_search(args.force_ram)
    else:
        cmd_best(args.split)
    return 0


if __name__ == "__main__":
    sys.exit(main())
