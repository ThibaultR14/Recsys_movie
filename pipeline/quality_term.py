"""Quality term before the calibration (step 8, before closing): measured offline only.

    uv run python quality_term.py sweep [--tag T]   # validation, ~40 min
    uv run python quality_term.py tmdb-fit   # TMDB rating -> MovieLens quality (estimated films)

score' = score / s_max + gamma x q, on the candidates of each notch (s_max = best score among the
user's candidates under the cap), then the pool of 150 and the production calibration (share, λ
per notch), as on the site. q = Bayesian MovieLens mean, centred:
    q_i = (n_i m_i + K C) / (n_i + K) - C
with n_i, m_i the number and mean of the ratings of film i by the TRAINING users only (no leak),
C the mean of all training ratings, K the fictitious ratings (shrinkage). Protocol of step 6c:
validation users, fold-in D2, caps on training-user counts.

Metrics (top 20 of the shown list): NDCG@20 and Recall@20 on the well-rated held-out films (rating
>= fold-in median, step 2), NDCG@20 on all the held-out films, mean log popularity and median
popularity of the recommendations, share of films released before 1970; paired differences with
gamma = 0. Results in data/processed/results/quality/quality_term_val*.json (ignored).
"""

from __future__ import annotations

import os

os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import argparse  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402

import calibration as cal  # noqa: E402
import evaluate as ev  # noqa: E402
import metrics as m  # noqa: E402
import sweep_slider as sw  # noqa: E402
from config import RESULTS_DIR, SPLIT_DIR, TOP_K  # noqa: E402

GAMMAS = (0.0, 0.05, 0.1, 0.2, 0.3)
SHRINKS = (50, 200)
CAPS = (math.inf, 2_000, 500)
OLD_YEAR = 1970
OUT_DIR = RESULTS_DIR / "quality"


def bayes_quality(sums: np.ndarray, counts: np.ndarray, k: float, c: float) -> np.ndarray:
    """(sum + k c) / (n + k) - c, i.e. (n m + k c) / (n + k) - c; 0 for a film without rating."""
    return (sums + k * c) / (counts + k) - c


def train_rating_stats(catalog: ev.Catalog) -> tuple[np.ndarray, np.ndarray, float]:
    """Per item_idx: number and sum of the training ratings; C = mean of all training ratings."""
    per = (
        pl.scan_parquet(SPLIT_DIR / "train.parquet")
        .group_by("movieId")
        .agg(n=pl.len(), s=pl.col("rating").sum())
        .collect()
    )
    t = ev.item_index(catalog).join(per, on="movieId", how="left").sort("item_idx")
    n = t["n"].fill_null(0).to_numpy().astype(np.float64)
    s = t["s"].fill_null(0.0).to_numpy().astype(np.float64)
    return n, s, float(s.sum() / n.sum())


def quality_lists(
    scores: np.ndarray,
    batch,
    cand: np.ndarray,
    q: np.ndarray,
    gamma: float,
    P,  # noqa: N803
    G,  # noqa: N803
    lam: float,
) -> np.ndarray:
    """(B, 48) calibrated lists with score' = score / s_max + gamma q."""
    masked = scores.copy()
    masked[:, ~cand] = -np.inf
    rows = np.repeat(np.arange(batch.shape[0]), np.diff(batch.indptr))
    masked[rows, batch.indices] = -np.inf
    smax = masked.max(axis=1, keepdims=True)
    smax = np.where(np.isfinite(smax) & (smax > 0), smax, 1.0)
    adj = scores / smax + gamma * q[None, :]
    pools = ev.top_k(adj.copy(), batch, cand, cal.POOL)
    pool_scores = np.take_along_axis(adj, pools, axis=1)
    finite = np.isfinite(np.take_along_axis(masked, pools, axis=1))
    pools = np.where(finite, pools, -1)
    return cal.calibrate_batch(pools, pool_scores, P, G, lam, cal.N_LIST, "share")


def cmd_sweep(tag: str) -> dict:
    from export import SLIDER_POSITIONS

    lam_of = dict(zip(SLIDER_POSITIONS, cal.PRODUCTION["lambda_by_position"], strict=True))
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    G = cal.genre_matrix(mode="share")[0]  # noqa: N806
    n_tr, s_tr, c = train_rating_stats(catalog)
    years = (
        pl.read_parquet(ev.CATALOG_PARQUET, columns=["item_idx", "year"])
        .sort("item_idx")["year"]
        .fill_null(9999)
        .to_numpy()
    )
    old = years < OLD_YEAR
    configs = [(0.0, None)] + [(g, k) for k in SHRINKS for g in GAMMAS if g > 0]
    qs = {k: bayes_quality(s_tr, n_tr, k, c) for k in SHRINKS}
    q0 = np.zeros(len(counts))
    lists = {(g, k, cap): [] for g, k in configs for cap in CAPS}
    t0 = time.time()
    for start in range(0, len(eval_set.user_ids), ev.BATCH_SIZE):
        batch = eval_set.foldin[start : start + ev.BATCH_SIZE]
        scores, Ps = cal.user_inputs(model, batch, {"share": G})  # noqa: N806
        for cap in CAPS:
            cand = catalog.recommendable & (counts <= cap)
            lam = lam_of[None if math.isinf(cap) else cap]
            for g, k in configs:
                q = qs[k] if k is not None else q0
                lists[(g, k, cap)].append(
                    quality_lists(scores, batch, cand, q, g, Ps["share"], G, lam)
                )
        print(f"  {start + batch.shape[0]} utilisateurs ({time.time() - t0:.0f} s)", flush=True)
    rows = []
    per_user = {}
    for g, k in configs:
        for cap in CAPS:
            L = np.vstack(lists[(g, k, cap)])  # noqa: N806
            ranked = np.where(L[:, :TOP_K] >= 0, L[:, :TOP_K], 0)
            valid = L[:, :TOP_K] >= 0
            ndcg_rel = [m.ndcg_at_k(ranked[u], eval_set.relevant[u], TOP_K) for u in range(len(L))]
            rec_rel = [m.recall_at_k(ranked[u], eval_set.relevant[u], TOP_K) for u in range(len(L))]
            ndcg_all = [m.ndcg_at_k(ranked[u], eval_set.heldout[u], TOP_K) for u in range(len(L))]
            per_user[(g, k, cap)] = (ndcg_rel, rec_rel, ndcg_all)
            pops = counts[ranked]
            rows.append(
                {
                    "gamma": g,
                    "shrink": k,
                    "cap": None if math.isinf(cap) else cap,
                    "ndcg_rel@20": m.mean_ci(ndcg_rel),
                    "recall_rel@20": m.mean_ci(rec_rel),
                    "ndcg_all@20": m.mean_ci(ndcg_all),
                    "pop_log_mean@20": float(np.log1p(pops[valid]).mean()),
                    "pop_median@20": float(np.median(np.median(np.where(valid, pops, 0), axis=1))),
                    "share_before_1970": float(old[ranked][valid].mean()),
                }
            )
    # paired differences with gamma = 0
    for r in rows:
        if r["gamma"] == 0.0:
            continue
        cap = math.inf if r["cap"] is None else r["cap"]
        a = per_user[(r["gamma"], r["shrink"], cap)]
        b = per_user[(0.0, None, cap)]
        for j, name in enumerate(("ndcg_rel@20", "recall_rel@20", "ndcg_all@20")):
            d = [x - y for x, y in zip(a[j], b[j], strict=True) if x is not None and y is not None]
            r[f"delta_{name}"] = m.mean_ci(d)
    out = {
        "split": "val",
        "formula": "score' = score / s_max + gamma * q, q = (n m + K C)/(n + K) - C (training)",
        "C": c,
        "calibration": cal.PRODUCTION,
        "caps": "training-user ml_rating_count",
        "rows": rows,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"quality_term_val{tag}.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print_rows(rows)
    print("->", path)
    return out


def print_rows(rows: list[dict]) -> None:
    print(
        "\n| cran | γ | K | NDCG@20 bien notés | Δ | Recall@20 bien notés | Δ | NDCG@20 tous | Δ | "
        "log pop. moy. | pop. médiane | avant 1970 |"
    )
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda r: (r["cap"] is not None, r["cap"] or 0, r["shrink"] or 0)):

        def d(name, r=r):
            x = r.get(f"delta_{name}")
            return "—" if x is None else f"{x['mean']:+.4f} ± {x['ci95']:.4f}"

        cap = "∞" if r["cap"] is None else r["cap"]
        print(
            f"| {cap} | {r['gamma']:g} | {r['shrink'] or '—'} | {r['ndcg_rel@20']['mean']:.4f} | "
            f"{d('ndcg_rel@20')} | {r['recall_rel@20']['mean']:.4f} | {d('recall_rel@20')} | "
            f"{r['ndcg_all@20']['mean']:.4f} | {d('ndcg_all@20')} | {r['pop_log_mean@20']:.2f} | "
            f"{r['pop_median@20']:.0f} | {100 * r['share_before_1970']:.1f} % |"
        )


def cmd_tmdb_fit() -> dict:
    """Estimated films have no MovieLens mean: how well does the TMDB rating predict q?"""
    from recent_films import FILMS_PARQUET

    catalog = ev.load_catalog()
    n_tr, s_tr, c = train_rating_stats(catalog)
    films = pl.read_parquet(FILMS_PARQUET).filter("in_catalog").sort("item_idx")
    idx = films["item_idx"].to_numpy()
    avg = films["vote_average"].to_numpy().astype(np.float64)
    votes = films["vote_count"].to_numpy().astype(np.float64)
    out = {}
    for k in SHRINKS:
        q = bayes_quality(s_tr, n_tr, k, c)[idx]
        ok = (votes >= 50) & np.isfinite(avg) & (n_tr[idx] >= 20)
        t_bayes = (votes * avg + 200 * 6.5) / (votes + 200)
        a, b = np.polyfit(t_bayes[ok], q[ok], 1)
        r = float(np.corrcoef(t_bayes[ok], q[ok])[0, 1])
        out[k] = {"films": int(ok.sum()), "corr": r, "slope": a, "intercept": b}
        print(
            f"K = {k} : corrélation note TMDB bayésienne (m = 200) / q MovieLens = {r:.3f} "
            f"sur {int(ok.sum())} films ; q ≈ {a:.3f} × note TMDB {b:+.3f}"
        )
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sweep")
    s.add_argument("--tag", default="")
    sub.add_parser("tmdb-fit")
    args = p.parse_args()
    if args.cmd == "sweep":
        cmd_sweep(args.tag)
    else:
        cmd_tmdb_fit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
