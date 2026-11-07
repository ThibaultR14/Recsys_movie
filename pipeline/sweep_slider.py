"""Slider sweep for the two ALS candidates (step 2, C4 of docs/etape-2-modele.md).

Validation only: lam in [-0.5, 2.0] step 0.1, x 2 popularity sources (D5), x configs A and B.
The test split is only used for the qualitative check (3 users, titles shown, no metric).

Subcommands (from `pipeline/`):
    uv run python sweep_slider.py sweep          # -> results/slider/val_<config>_<source>.json
    uv run python sweep_slider.py qualitative    # -> results/slider/qualitative_test.json
    uv run python sweep_slider.py figure         # -> docs/figures/etape2-curseur-validation.png

Item factors are read from data/processed/models/ (trained and saved there if missing).
"""

from __future__ import annotations

import os

# Must be set before NumPy is imported (recommendation of implicit, for training).
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import argparse  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from datetime import UTC, datetime  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402

import evaluate as ev  # noqa: E402
import slider  # noqa: E402
from config import PROCESSED, REPO_ROOT, RESULTS_DIR, SPLIT_DIR, TOP_K  # noqa: E402
from models import als  # noqa: E402

MODELS_DIR = PROCESSED / "models"
SLIDER_DIR = RESULTS_DIR / "slider"
FIGURES_DIR = REPO_ROOT / "docs" / "figures"
CONFIGS = {
    "A": {"factors": 64, "regularization": 0.05, "alpha": 1.0, "beta": 1.0, "iterations": 30},
    "B": {"factors": 64, "regularization": 0.1, "alpha": 10.0, "beta": 1.0, "iterations": 30},
}
QUALI_LAMBDAS = (0.0, 1.0, 2.0)
QUALI_TOP = 10
QUALI_FOLDIN_RANGE = (40, 400)  # fold-in size of the users picked for the qualitative check
QUALI_QUANTILES = {"pointu": 0.1, "median": 0.5, "grand_public": 0.9}


def config_key(cfg: dict) -> str:
    return "f{factors:g}_r{regularization:g}_a{alpha:g}_b{beta:g}_i{iterations:g}".format(**cfg)


def factors_path(cfg: dict):
    return MODELS_DIR / f"als_{config_key(cfg)}_item_factors.npy"


def load_factors(cfg: dict, catalog: ev.Catalog) -> np.ndarray:
    path = factors_path(cfg)
    if not path.exists():
        print(f"training {config_key(cfg)} (factors not saved yet)", flush=True)
        signal = als.signal_values(ev.train_ratings(catalog), cfg["beta"])
        model = als.train(
            signal,
            factors=cfg["factors"],
            regularization=cfg["regularization"],
            alpha=cfg["alpha"],
            iterations=cfg["iterations"],
        )
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        np.save(path, np.asarray(model.item_factors, dtype=np.float32))
    return np.load(path)


def adapter(name: str, catalog: ev.Catalog) -> als.ALSModel:
    cfg = CONFIGS[name]
    return als.ALSModel(
        load_factors(cfg, catalog),
        regularization=cfg["regularization"],
        alpha=cfg["alpha"],
        beta=cfg["beta"],
        name=f"als_{config_key(cfg)}",
    )


def catalog_frame() -> pl.DataFrame:
    return pl.read_parquet(
        ev.CATALOG_PARQUET,
        columns=["item_idx", "movie_id", "tmdb_title", "ml_title", "year", "ml_rating_count"]
        + ["tmdb_vote_count", "recommendable"],
    ).sort("item_idx")


def popularity_scores(catalog: ev.Catalog) -> dict[str, np.ndarray]:
    """z_i per source. ml_rating_count = training-user counts (no leakage, D3)."""
    pops = {
        "ml_rating_count": ev.train_counts(catalog).astype(np.float64),
        "tmdb_vote_count": slider.tmdb_popularity(catalog_frame()),
    }
    return {src: slider.popularity_z(p, catalog.recommendable) for src, p in pops.items()}


def ranked_lists(
    model: als.ALSModel,
    foldin,
    recommendable: np.ndarray,
    zs: dict[str, np.ndarray],
    lambdas,
    k: int,
) -> dict[tuple[str, float], np.ndarray]:
    """Top k per user for every (source, lam), users in `foldin` row order."""
    out: dict[tuple[str, float], list[np.ndarray]] = {(s, lam): [] for s in zs for lam in lambdas}
    for start in range(0, foldin.shape[0], ev.BATCH_SIZE):
        batch = foldin[start : start + ev.BATCH_SIZE]
        std = slider.standardize_rows(
            model.scores(batch), slider.candidate_mask(batch, recommendable)
        )
        for src, z in zs.items():
            for lam in lambdas:
                ranked = ev.top_k(slider.rerank(std, z, lam), batch, recommendable, k)
                out[(src, lam)].append(ranked)
    return {key: np.vstack(parts) for key, parts in out.items()}


def cmd_sweep() -> None:
    SLIDER_DIR.mkdir(parents=True, exist_ok=True)
    catalog = ev.load_catalog()
    eval_set = ev.load_eval_set("val", catalog)
    counts = ev.train_counts(catalog)
    zs = popularity_scores(catalog)
    manifest = json.loads((SPLIT_DIR / "manifest.json").read_text())
    for name, cfg in CONFIGS.items():
        model = adapter(name, catalog)
        t0 = time.perf_counter()
        ranked = ranked_lists(
            model, eval_set.foldin, catalog.recommendable, zs, slider.LAMBDAS, TOP_K
        )
        print(f"{name}: ranked in {time.perf_counter() - t0:.0f}s", flush=True)
        for src in zs:
            rows = []
            for lam in slider.LAMBDAS:
                metrics = ev.compute_metrics(
                    ranked[(src, lam)], eval_set, counts, catalog.recommendable
                )
                rows.append({"lambda": lam, "metrics": metrics})
            result = {
                "config_name": name,
                "config": cfg,
                "model": model.name,
                "split": "val",
                "k": TOP_K,
                "slider_source": src,
                "metrics_popularity": "ml_rating_count (training users only)",
                "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "split_sha256": manifest["sha256"],
                "n_users": len(eval_set.user_ids),
                "sweep": rows,
            }
            path = SLIDER_DIR / f"val_{name}_{src}.json"
            path.write_text(json.dumps(result, indent=2) + "\n")
            lam0 = next(r for r in rows if r["lambda"] == 0.0)["metrics"]["ndcg@20"]["mean"]
            print(f"-> {path.name} (ndcg@20 at lambda 0: {lam0:.5f})", flush=True)


def pick_users(eval_set: ev.EvalSet, counts: np.ndarray) -> dict[str, int]:
    """Rows of 3 test users: median popularity of their fold-in at the 10/50/90th percentile."""
    sizes = np.diff(eval_set.foldin.indptr)
    lo, hi = QUALI_FOLDIN_RANGE
    rows = np.flatnonzero((sizes >= lo) & (sizes <= hi))
    med = np.array(
        [
            np.median(
                counts[
                    eval_set.foldin.indices[
                        eval_set.foldin.indptr[r] : eval_set.foldin.indptr[r + 1]
                    ]
                ]
            )
            for r in rows
        ]
    )
    picked = {}
    for label, q in QUALI_QUANTILES.items():
        target = np.quantile(med, q)
        order = np.lexsort((eval_set.user_ids[rows], np.abs(med - target)))
        picked[label] = int(rows[order[0]])
    return picked


def describe(items: np.ndarray, cat: pl.DataFrame, counts: np.ndarray) -> list[dict]:
    out = []
    for i in items.tolist():
        row = cat.row(i, named=True)
        out.append(
            {
                "item_idx": i,
                "movie_id": row["movie_id"],
                "title": row["tmdb_title"] or row["ml_title"],
                "year": row["year"],
                "ml_rating_count": row["ml_rating_count"],
                "train_count": int(counts[i]),
                "tmdb_vote_count": row["tmdb_vote_count"],
            }
        )
    return out


def cmd_qualitative() -> None:
    SLIDER_DIR.mkdir(parents=True, exist_ok=True)
    catalog = ev.load_catalog()
    cat = catalog_frame()
    eval_set = ev.load_eval_set("test", catalog)
    counts = ev.train_counts(catalog)
    zs = popularity_scores(catalog)
    users = pick_users(eval_set, counts)
    rows = np.array(list(users.values()))
    foldin = eval_set.foldin[rows]
    foldin_df = pl.read_parquet(SPLIT_DIR / "test_foldin.parquet")
    profiles = {}
    for label, r in users.items():
        uid = int(eval_set.user_ids[r])
        lo, hi = (
            foldin.indptr[list(users).index(label)],
            foldin.indptr[list(users).index(label) + 1],
        )
        items = foldin.indices[lo:hi]
        fav = (
            foldin_df.filter(pl.col("userId") == uid)
            .join(ev.item_index(catalog).select("movieId", "item_idx"), on="movieId")
            .sort(["rating", "timestamp"], descending=True)
            .head(8)["item_idx"]
            .to_numpy()
        )
        profiles[label] = {
            "user_id": uid,
            "n_foldin": int(hi - lo),
            "foldin_median_train_count": float(np.median(counts[items])),
            "foldin_mean_rating": float(foldin.data[lo:hi].mean()),
            "favourites": describe(fav, cat, counts),
        }
    recos: dict[str, dict] = {}
    for name in CONFIGS:
        ranked = ranked_lists(
            adapter(name, catalog), foldin, catalog.recommendable, zs, QUALI_LAMBDAS, QUALI_TOP
        )
        recos[name] = {
            src: {
                str(lam): {
                    label: describe(ranked[(src, lam)][j], cat, counts)
                    for j, label in enumerate(users)
                }
                for lam in QUALI_LAMBDAS
            }
            for src in zs
        }
    out = {
        "split": "test",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "selection": {
            "foldin_size_range": QUALI_FOLDIN_RANGE,
            "quantiles_of_foldin_median_train_count": QUALI_QUANTILES,
        },
        "lambdas": QUALI_LAMBDAS,
        "profiles": profiles,
        "recommendations": recos,
    }
    path = SLIDER_DIR / "qualitative_test.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"-> {path}")


def cmd_figure() -> None:
    """2 x 2: NDCG and Recall vs pop_mediane (references as points), pop_mediane and coverage vs λ.

    `hasard` (pop_mediane ~130, NDCG ~0.001) is far outside the zoomed axes: given in the caption.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    styles = {
        ("A", "ml_rating_count"): ("#1f4e79", "-", "o"),
        ("A", "tmdb_vote_count"): ("#5b9bd5", "--", "s"),
        ("B", "ml_rating_count"): ("#a93226", "-", "o"),
        ("B", "tmdb_vote_count"): ("#e59866", "--", "s"),
    }
    refs = {
        "populaire": (RESULTS_DIR / "popular_val.json", "k", "^"),
        "EASE (λ = 0)": (RESULTS_DIR / "ease" / "ease_b1_l10000_val.json", "#2e8b57", "*"),
    }
    random_val = json.loads((RESULTS_DIR / "random_val.json").read_text())["metrics"]
    sweeps = {
        key: json.loads((SLIDER_DIR / f"val_{key[0]}_{key[1]}.json").read_text())["sweep"]
        for key in styles
    }
    fig, axes = plt.subplots(2, 2, figsize=(14, 10.5))
    for ax, metric in zip(axes[0], ("ndcg@20", "recall@20"), strict=True):
        for key, (color, ls, marker) in styles.items():
            rows = sweeps[key]
            x = [r["metrics"]["pop_mediane@20"]["mean"] for r in rows]
            y = [r["metrics"][metric]["mean"] for r in rows]
            ax.plot(
                x,
                y,
                ls=ls,
                color=color,
                marker=marker,
                ms=3,
                lw=1.4,
                label=f"ALS {key[0]} · {key[1]}",
            )
            for r, xi, yi in zip(rows, x, y, strict=True):
                if r["lambda"] in (-0.5, 0.0, 1.0, 2.0):
                    ax.annotate(
                        f"λ={r['lambda']:g}",
                        (xi, yi),
                        textcoords="offset points",
                        xytext=(-4, -11),
                        fontsize=7,
                        color=color,
                        ha="right",
                    )
        for label, (path, color, marker) in refs.items():
            r = json.loads(path.read_text())["metrics"]
            ax.scatter(
                r["pop_mediane@20"]["mean"],
                r[metric]["mean"],
                color=color,
                marker=marker,
                s=140 if marker == "*" else 60,
                zorder=5,
                label=label,
            )
        ax.set_xscale("log")
        ax.set_xlim(12_000, 70_000)
        ax.invert_xaxis()  # left -> right = towards hidden gems
        ax.set_xlabel(
            "pop_mediane@20 (notes d'entraînement du film typique, log ; ← connu · pépite →)"
        )
        ax.set_ylabel(metric)
        ax.grid(True, which="both", alpha=0.3)
        ax.set_title(f"{metric} vs popularité de la liste")
    axes[0][0].legend(fontsize=8, loc="upper right")
    for ax, metric, label in (
        (axes[1][0], "pop_mediane@20", "pop_mediane@20"),
        (axes[1][1], "couverture@20", "couverture@20"),
    ):
        for key, (color, ls, marker) in styles.items():
            rows = sweeps[key]
            lams = [r["lambda"] for r in rows]
            vals = [
                r["metrics"][metric]["mean"]
                if isinstance(r["metrics"][metric], dict)
                else r["metrics"][metric]
                for r in rows
            ]
            ax.plot(
                lams,
                vals,
                ls=ls,
                color=color,
                marker=marker,
                ms=3,
                lw=1.4,
                label=f"ALS {key[0]} · {key[1]}",
            )
        ax.axvline(0, color="grey", lw=0.8)
        ax.set_xlabel("λ (curseur)")
        ax.set_ylabel(label)
        ax.grid(True, alpha=0.3)
        ax.set_title(f"{label} en fonction de λ")
    axes[1][0].legend(fontsize=8)
    fig.suptitle(
        "Étape 2 · C4 — curseur connu ↔ pépite, validation (10 000 utilisateurs), "
        "λ ∈ [−0,5 ; 2,0]\n"
        f"hors cadre : hasard (pop_mediane {random_val['pop_mediane@20']['mean']:.0f}, "
        f"NDCG@20 {random_val['ndcg@20']['mean']:.4f})",
        fontsize=11,
    )
    fig.tight_layout()
    path = FIGURES_DIR / "etape2-curseur-validation.png"
    fig.savefig(path, dpi=120)
    print(f"-> {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["sweep", "qualitative", "figure"])
    args = parser.parse_args()
    {"sweep": cmd_sweep, "qualitative": cmd_qualitative, "figure": cmd_figure}[args.cmd]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
