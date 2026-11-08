"""Calibration by genres (Steck, *Calibrated Recommendations*, RecSys 2018), step 6c D1.

Reference implementation (the TypeScript `web/src/reco/calibrate.ts` must give the same lists) and
the offline evaluation of Q3 on the **validation** split.

At each slider position, the 48 films are picked one by one from a pool of the POOL best films
under the cap (model score order; ties by item_idx), maximising

    (1 - λ) × Σ_{i in list} s_i / s_max  −  λ × KL(p ‖ q̃(list)),     q̃ = (1 − α) q + α p

- p(g): genre distribution of the user's fold-in films (D2: the films kept in the fold-in), a film
  with k genres giving 1/k to each, weighted by its signal 1 + β·percentile;
- q(g): the same for the list (uniform weights), over the listed films that have genres;
- films without genre count in neither distribution (Q1 of the spec): picking one leaves q as is.
- ties of the greedy objective: the first film of the pool (best score, then smallest item_idx).

Mode `share` (Q3 variant): a genre is yes/no per film; p_g and q_g are the (weighted) shares of
films that have genre g, and the divergence is Σ_g of the Bernoulli KL of p_g against q̃_g. It
targets the share of, e.g., animation films directly (with `mass`, a film with 4 genres only
weighs 1/4 in Animation).

    uv run python calibration.py sweep [--mode share]   # validation: λ grid x caps (∞, 2 000, 500)
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
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
import scipy.sparse as sp  # noqa: E402

import evaluate as ev  # noqa: E402
import metrics as m  # noqa: E402
import sweep_slider as sw  # noqa: E402
from config import RESULTS_DIR, TOP_K  # noqa: E402
from export import FOLDIN_RULE  # noqa: E402
from models import als  # noqa: E402

POOL = 150
N_LIST = 48
ALPHA = 0.01
NO_GENRE = "(no genres listed)"
LAMBDAS = (0.0, 0.5, 0.8, 0.9, 0.95, 0.98, 0.99)
CAPS = (math.inf, 2_000, 500)
ROW = 8
OUT = RESULTS_DIR / "quality" / "calibration_val_{}.json"
MODES = ("mass", "share")


def genre_matrix(path=ev.CATALOG_PARQUET, mode: str = "mass") -> tuple[np.ndarray, list[str]]:
    """(n_items, n_genres) float64: 1/k (mass) or 1 (share) on each of the k MovieLens genres of a
    film, 0 if none."""
    cat = pl.read_parquet(path, columns=["item_idx", "ml_genres"]).sort("item_idx")
    lists = [[g for g in (gs or []) if g != NO_GENRE] for gs in cat["ml_genres"].to_list()]
    names = sorted({g for gs in lists for g in gs})
    col = {g: j for j, g in enumerate(names)}
    G = np.zeros((len(lists), len(names)))  # noqa: N806
    for i, gs in enumerate(lists):
        for g in gs:
            G[i, col[g]] = 1.0 / len(gs) if mode == "mass" else 1.0
    return G, names


def profile(
    G: np.ndarray,  # noqa: N803
    items: np.ndarray,
    weights: np.ndarray,
    mode: str = "mass",
) -> np.ndarray:
    """p(g) of the history (films without genre left out): a distribution (mass) or the weighted
    share of the films that have each genre (share)."""
    has = G[items].sum(axis=1) > 0
    if not has.any():
        return np.zeros(G.shape[1])
    v = (G[items[has]] * weights[has, None]).sum(axis=0)
    return v / (v.sum() if mode == "mass" else weights[has].sum())


def kl(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """KL(p ‖ (1 − α) q + α p) along the last axis; 0·log 0 = 0."""
    qt = (1.0 - ALPHA) * q + ALPHA * p
    with np.errstate(divide="ignore", invalid="ignore"):
        terms = np.where(p > 0, p * np.log(p / qt), 0.0)
    return terms.sum(axis=-1)


def bernoulli(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """Σ_g Bernoulli KL(p_g ‖ q̃_g), q̃ = (1 − α) q + α p, along the last axis (share mode)."""
    qt = (1.0 - ALPHA) * q + ALPHA * p
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(p > 0, p * np.log(p / qt), 0.0)
        b = np.where(p < 1, (1 - p) * np.log((1 - p) / (1 - qt)), 0.0)
    return (a + b).sum(axis=-1)


def divergence(p: np.ndarray, q: np.ndarray, mode: str) -> np.ndarray:
    return kl(p, q) if mode == "mass" else bernoulli(p, q)


def calibrate_batch(
    pools: np.ndarray,  # (B, P) item_idx, best first; -1 = no candidate
    scores: np.ndarray,  # (B, P) model scores of the pool
    P: np.ndarray,  # noqa: N803  (B, n_genres) target distributions
    G: np.ndarray,  # noqa: N803
    lam: float,
    n: int = N_LIST,
    mode: str = "mass",
) -> np.ndarray:
    """(B, n) picked item_idx in pick order (-1 when the pool runs out)."""
    B, Pn = pools.shape  # noqa: N806
    valid = pools >= 0
    smax = np.where(valid, scores, -np.inf).max(axis=1, keepdims=True)
    s = np.where(valid, scores / np.where(smax > 0, smax, 1.0), -np.inf)
    Gp = G[np.where(valid, pools, 0)] * valid[..., None]  # (B, P, genres)  # noqa: N806
    has = Gp.sum(axis=2) > 0  # (B, P)
    sum_q = np.zeros((B, G.shape[1]))
    n_q = np.zeros((B, 1))
    sum_s = np.zeros((B, 1))
    taken = ~valid
    out = np.full((B, n), -1, dtype=np.int64)
    rows = np.arange(B)
    for step in range(n):
        if lam == 0.0:
            obj = np.where(taken, -np.inf, s)
        else:
            cnt = n_q + has  # (B, P)
            q = (sum_q[:, None, :] + Gp) / np.where(cnt > 0, cnt, 1.0)[..., None]
            q = np.where((cnt > 0)[..., None], q, 0.0)
            obj = (1.0 - lam) * (sum_s + s) - lam * divergence(P[:, None, :], q, mode)
            obj = np.where(taken, -np.inf, obj)
        best = np.argmax(obj, axis=1)  # first max = best score, then smallest item_idx
        ok = np.isfinite(obj[rows, best])
        out[ok, step] = pools[rows[ok], best[ok]]
        sum_q[ok] += Gp[rows[ok], best[ok]]
        n_q[ok, 0] += has[rows[ok], best[ok]]
        sum_s[ok, 0] += s[rows[ok], best[ok]]
        taken[rows[ok], best[ok]] = True
    return out


def list_kl(lists: np.ndarray, P: np.ndarray, G: np.ndarray, k: int) -> np.ndarray:  # noqa: N803
    """Miscalibration C_KL (mass) of the first k films of each list (films without genre left
    out); G and P in mass mode, whatever the calibration mode, so that rows compare."""
    L = lists[:, :k]  # noqa: N806
    Gl = G[np.where(L >= 0, L, 0)] * (L >= 0)[..., None]  # noqa: N806
    cnt = (Gl.sum(axis=2) > 0).sum(axis=1, keepdims=True)
    q = Gl.sum(axis=1) / np.where(cnt > 0, cnt, 1)
    return kl(P, q)


def row_overshoot(lists: np.ndarray, P: np.ndarray, G: np.ndarray) -> np.ndarray:  # noqa: N803
    """Largest excess of the share of films of a genre in the first row of 8 over that share in the
    profile (G and P in share mode, whatever the calibration mode)."""
    L = lists[:, :ROW]  # noqa: N806
    Gl = G[np.where(L >= 0, L, 0)] * (L >= 0)[..., None]  # noqa: N806
    cnt = (Gl.sum(axis=2) > 0).sum(axis=1, keepdims=True)
    q = Gl.sum(axis=1) / np.where(cnt > 0, cnt, 1)
    return (q - P).max(axis=1)


def user_inputs(model: als.ALSModel, foldin: sp.csr_matrix, Gs: dict):  # noqa: N803
    """Scores with the D2 fold-in, and the genre profiles (per mode), for a batch of users."""
    p_all = als.percentile_values(foldin)
    signal = p_all.copy()
    signal.data = (1.0 + model.beta * p_all.data).astype(np.float32)
    profiles = {k: np.zeros((foldin.shape[0], G.shape[1])) for k, G in Gs.items()}  # noqa: N806
    for u in range(foldin.shape[0]):
        lo, hi = foldin.indptr[u], foldin.indptr[u + 1]
        keep = als.kept_for_foldin(p_all.data[lo:hi], None, **FOLDIN_RULE)
        signal.data[lo:hi][~keep] = 0.0
        for k, G in Gs.items():  # noqa: N806
            profiles[k][u] = profile(G, foldin.indices[lo:hi][keep], signal.data[lo:hi][keep], k)
    signal.eliminate_zeros()
    x = als.fold_in(
        model.Y, signal, regularization=model.regularization, alpha=model.alpha, yty=model.yty
    )
    return (x.astype(np.float32) @ model.Y.T).astype(np.float64), profiles


def cmd_sweep(mode: str) -> dict:
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    Gs = {k: genre_matrix(mode=k)[0] for k in MODES}  # noqa: N806
    G, names = Gs[mode], genre_matrix()[1]  # noqa: N806
    lists = {(lam, cap): [] for lam in LAMBDAS for cap in CAPS}
    profiles = {k: [] for k in MODES}
    t_cal = {lam: 0.0 for lam in LAMBDAS}
    for start in range(0, len(eval_set.user_ids), ev.BATCH_SIZE):
        batch = eval_set.foldin[start : start + ev.BATCH_SIZE]
        scores, Ps = user_inputs(model, batch, Gs)  # noqa: N806
        for k in MODES:
            profiles[k].append(Ps[k])
        P = Ps[mode]  # noqa: N806
        for cap in CAPS:
            cand = catalog.recommendable & (counts <= cap)
            pools = ev.top_k(scores.copy(), batch, cand, POOL)
            pool_scores = np.take_along_axis(scores, pools, axis=1)
            pools = np.where(np.isfinite(pool_scores), pools, -1)
            for lam in LAMBDAS:
                t0 = time.perf_counter()
                lists[(lam, cap)].append(
                    calibrate_batch(pools, pool_scores, P, G, lam, N_LIST, mode)
                )
                t_cal[lam] += time.perf_counter() - t0
        print(f"  {start + len(batch.indptr) - 1} utilisateurs", flush=True)
    P_mass, P_share = np.vstack(profiles["mass"]), np.vstack(profiles["share"])  # noqa: N806
    rows = []
    for lam in LAMBDAS:
        for cap in CAPS:
            L = np.vstack(lists[(lam, cap)])  # noqa: N806
            ranked = np.where(L[:, :TOP_K] >= 0, L[:, :TOP_K], 0)
            met = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
            row = {
                "lambda": lam,
                "cap": None if math.isinf(cap) else cap,
                "ndcg@20": met["ndcg@20"],
                "recall@20": met["recall@20"],
                "c_kl@20": m.mean_ci(list_kl(L, P_mass, Gs["mass"], TOP_K).tolist()),
                "overshoot_row8": m.mean_ci(row_overshoot(L, P_share, Gs["share"]).tolist()),
                "calibration_seconds_10k_users_x3_caps": round(t_cal[lam], 1),
            }
            rows.append(row)
            print(
                f"λ {lam:<4} · cran {row['cap']!s:>5} · NDCG@20 {met['ndcg@20']['mean']:.4f} · "
                f"Recall@20 {met['recall@20']['mean']:.4f} · "
                f"C_KL@20 {row['c_kl@20']['mean']:.3f} · "
                f"excès max rangée {row['overshoot_row8']['mean']:.3f}",
                flush=True,
            )
    out = {
        "split": "val",
        "config": "A + D2 (fold-in without p < 0.3)",
        "mode": mode,
        "pool": POOL,
        "n_list": N_LIST,
        "alpha": ALPHA,
        "genres": names,
        "rows": rows,
    }
    path = Path(str(OUT).format(mode))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2) + "\n")
    print("->", path)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["sweep"])
    parser.add_argument("--mode", choices=MODES, default="mass")
    args = parser.parse_args()
    cmd_sweep(args.mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
