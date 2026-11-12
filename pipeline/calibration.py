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

D1b (Q4b): proximity penalty to the disliked films (those D2 takes out of the fold-in), before
the calibration: s'_k = score_k / s_max − μ × max(0, max cosine of k with the disliked films). μ
is in units of the pool's best score, because raw scores shrink ~15× from cap 5 000 to cap 200.

    uv run python calibration.py sweep [--mode share]   # validation: λ grid x caps (∞, 2 000, 500)
    uv run python calibration.py penalty-sweep [--mus 0,0.5,1] [--tag _a]   # Q4b, validation
    uv run python calibration.py test   # Q5: the single evaluation of step 6c on the test split
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


# Production (step 6c, Q3, option B): share mode, λ per slider position (∞, 20 000, 10 000, 5 000,
# 2 000, 1 000, 500, 200). The -3 % NDCG@20 rule holds at ∞, where the metric measures what we want;
# at the low positions NDCG@20 (≈ 0.008) barely sees anything and the genre drift dominates.
# Written to model-meta.json by export.py (to be recalibrated with the volunteers, step 7).
PRODUCTION = {
    "mode": "share",
    "pool": POOL,
    "n_list": N_LIST,
    "alpha": ALPHA,
    "lambda_by_position": [0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9],
}


# --- one user, incremental: the reference of the TypeScript engine (calibrate.ts) -----------------


def genre_lists(path=ev.CATALOG_PARQUET) -> list[list[int]]:
    """Per item_idx: sorted indices of its MovieLens genres (same order as catalog.json)."""
    cat = pl.read_parquet(path, columns=["item_idx", "ml_genres"]).sort("item_idx")
    lists = [[g for g in (gs or []) if g != NO_GENRE] for gs in cat["ml_genres"].to_list()]
    names = sorted({g for gs in lists for g in gs})
    col = {g: j for j, g in enumerate(names)}
    return [sorted(col[g] for g in gs) for gs in lists]


def share_profile_one(genres: list[list[int]], n_genres: int, items, weights) -> list[float]:
    """p_g: weighted share of the films that have genre g (films without genre left out), summed
    in history order, as the TypeScript engine does."""
    v = [0.0] * n_genres
    total = 0.0
    for item, w in zip(items, weights, strict=True):
        gs = genres[int(item)]
        if not gs:
            continue
        w = float(w)
        total += w
        for g in gs:
            v[g] += w
    return [x / total for x in v] if total > 0 else v


def _bernoulli_term(p: float, q: float, alpha: float) -> float:
    qt = (1.0 - alpha) * q + alpha * p
    t = 0.0
    if p > 0:
        t += p * math.log(p / qt)
    if p < 1:
        t += (1.0 - p) * math.log((1.0 - p) / (1.0 - qt))
    return t


def calibrate_one(
    pool,
    scores,
    p: list[float],
    genres: list[list[int]],
    lam: float,
    n: int,
    alpha: float = ALPHA,
    penalty=None,
) -> list[int]:
    """Greedy calibrated list (share mode), incremental: at each step, with c = films with genres
    in the list + 1, base = Σ_g f(p_g, Q_g / c) and Δ_g = f(p_g, (Q_g + 1) / c) − f(p_g, Q_g / c);
    a candidate with genres scores base + Σ_{g in its genres} Δ_g (ascending g); a candidate without
    genre leaves q as is. Ties: the first film of the pool. Mirrors calibrate.ts exactly.

    `penalty` (step 6c, D1b; one value per pool film, already × μ) is subtracted from the
    normalised score: s'_k = score_k / s_max − penalty_k."""
    pool = [int(i) for i in pool]
    scores = [float(x) for x in scores]
    if not pool:
        return []
    smax = max(scores)
    s = [x / (smax if smax > 0 else 1.0) for x in scores]
    if penalty is not None:
        s = [x - float(d) for x, d in zip(s, penalty, strict=True)]
    n_g = len(p)
    sum_q = [0.0] * n_g
    n_q = 0
    sum_s = 0.0
    taken = [False] * len(pool)
    out: list[int] = []
    for _ in range(min(n, len(pool))):
        if lam != 0.0:
            c = n_q + 1
            base = 0.0
            delta = [0.0] * n_g
            for g in range(n_g):
                f0 = _bernoulli_term(p[g], sum_q[g] / c, alpha)
                base += f0
                delta[g] = _bernoulli_term(p[g], (sum_q[g] + 1.0) / c, alpha) - f0
            none = 0.0
            for g in range(n_g):
                none += _bernoulli_term(p[g], sum_q[g] / n_q if n_q else 0.0, alpha)
        best, best_obj = -1, -math.inf
        for k, item in enumerate(pool):
            if taken[k]:
                continue
            if lam == 0.0:
                obj = s[k]
            else:
                gs = genres[item]
                if gs:
                    div = base
                    for g in gs:
                        div += delta[g]
                else:
                    div = none
                obj = (1.0 - lam) * (sum_s + s[k]) - lam * div
            if obj > best_obj:
                best, best_obj = k, obj
        if best < 0:
            break
        taken[best] = True
        out.append(pool[best])
        sum_s += s[best]
        gs = genres[pool[best]]
        for g in gs:
            sum_q[g] += 1.0
        if gs:
            n_q += 1
    return out


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
    penalty: np.ndarray | None = None,
) -> np.ndarray:
    """(B, n) picked item_idx in pick order (-1 when the pool runs out). `penalty` (B, P), already
    × μ, is subtracted from the normalised scores (D1b, as in `calibrate_one`)."""
    B, Pn = pools.shape  # noqa: N806
    valid = pools >= 0
    smax = np.where(valid, scores, -np.inf).max(axis=1, keepdims=True)
    s = np.where(valid, scores / np.where(smax > 0, smax, 1.0), -np.inf)
    if penalty is not None:
        s = np.where(valid, s - penalty, -np.inf)
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


def unit_rows(Y: np.ndarray) -> np.ndarray:  # noqa: N803
    """Item vectors scaled to unit length (zero vectors stay zero), float64."""
    Y = Y.astype(np.float64)  # noqa: N806
    norm = np.linalg.norm(Y, axis=1, keepdims=True)
    return Y / np.where(norm > 0, norm, 1.0)


def proximity(pool, disliked, unit: np.ndarray) -> np.ndarray:
    """D1b: max(0, max cosine) of each pool film with the disliked films (the films that D2 takes
    out of the fold-in); 0 everywhere without disliked film. Pool entries < 0 (no candidate): 0."""
    pool = np.asarray(pool)
    out = np.zeros(len(pool))
    disliked = np.asarray(disliked, dtype=np.int64)
    ok = pool >= 0
    if len(disliked) == 0 or not ok.any():
        return out
    out[ok] = np.maximum((unit[pool[ok]] @ unit[disliked].T).max(axis=1), 0.0)
    return out


def disliked_near(lists: np.ndarray, foldins: list, disliked: list, unit: np.ndarray, k=16, near=2):
    """Per user: how many of the first k films of the list have a disliked film among their `near`
    closest fold-in films (cosine), the measure of `quality-report` (Q2, Q4)."""
    out = np.zeros(len(lists))
    for u, (row, hist, bad) in enumerate(zip(lists, foldins, disliked, strict=True)):
        top = row[:k][row[:k] >= 0]
        if len(bad) == 0 or len(top) == 0 or len(hist) < near:
            continue
        cos = unit[top] @ unit[hist].T
        nearest = np.argpartition(-cos, near - 1, axis=1)[:, :near]
        out[u] = np.isin(hist[nearest], bad).any(axis=1).sum()
    return out


PENALTY_MUS = (0.0, 0.1, 0.25, 0.5, 1.0, 2.0)
PENALTY_OUT = RESULTS_DIR / "quality" / "penalty_val{}.json"


def cmd_penalty_sweep(mus: tuple[float, ...] = PENALTY_MUS, tag: str = "") -> dict:
    """Q4b (D1b): D2 + D1 (share, λ of PRODUCTION per cap) + proximity penalty μ, validation, caps
    ∞, 2 000, 500 (the penalty applies at every cap here; at ∞ it measures the « all positions »
    option, the production option leaves ∞ as μ = 0)."""
    from export import SLIDER_POSITIONS

    lam_of = dict(zip(SLIDER_POSITIONS, PRODUCTION["lambda_by_position"], strict=True))
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    unit = unit_rows(model.Y)
    Gs = {k: genre_matrix(mode=k)[0] for k in MODES}  # noqa: N806
    G = Gs["share"]  # noqa: N806
    lists = {(mu, cap): [] for mu in mus for cap in CAPS}
    profiles = {k: [] for k in MODES}
    foldins, disliked, smax_by_cap = [], [], {cap: [] for cap in CAPS}
    for start in range(0, len(eval_set.user_ids), ev.BATCH_SIZE):
        batch = eval_set.foldin[start : start + ev.BATCH_SIZE]
        scores, Ps = user_inputs(model, batch, Gs)  # noqa: N806
        for k in MODES:
            profiles[k].append(Ps[k])
        p_all = als.percentile_values(batch)
        bad_batch = []
        for u in range(batch.shape[0]):
            lo, hi = batch.indptr[u], batch.indptr[u + 1]
            keep = als.kept_for_foldin(p_all.data[lo:hi], None, **FOLDIN_RULE)
            foldins.append(batch.indices[lo:hi].astype(np.int64))
            bad_batch.append(batch.indices[lo:hi][~keep].astype(np.int64))
        disliked.extend(bad_batch)
        for cap in CAPS:
            cand = catalog.recommendable & (counts <= cap)
            pools = ev.top_k(scores.copy(), batch, cand, POOL)
            pool_scores = np.take_along_axis(scores, pools, axis=1)
            pools = np.where(np.isfinite(pool_scores), pools, -1)
            smax_by_cap[cap].append(np.where(pools >= 0, pool_scores, -np.inf).max(axis=1))
            near = np.vstack([proximity(pools[u], bad_batch[u], unit) for u in range(len(pools))])
            lam = lam_of[None if math.isinf(cap) else cap]
            for mu in mus:
                pen = None if mu == 0 else mu * near
                lists[(mu, cap)].append(
                    calibrate_batch(pools, pool_scores, Ps["share"], G, lam, N_LIST, "share", pen)
                )
        print(f"  {start + batch.shape[0]} utilisateurs", flush=True)
    P_mass, P_share = np.vstack(profiles["mass"]), np.vstack(profiles["share"])  # noqa: N806
    rows = []
    for mu in mus:
        for cap in CAPS:
            L = np.vstack(lists[(mu, cap)])  # noqa: N806
            ranked = np.where(L[:, :TOP_K] >= 0, L[:, :TOP_K], 0)
            met = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
            row = {
                "mu": mu,
                "cap": None if math.isinf(cap) else cap,
                "lambda": lam_of[None if math.isinf(cap) else cap],
                "ndcg@20": met["ndcg@20"],
                "recall@20": met["recall@20"],
                "c_kl@20": m.mean_ci(list_kl(L, P_mass, Gs["mass"], TOP_K).tolist()),
                "overshoot_row8": m.mean_ci(row_overshoot(L, P_share, Gs["share"]).tolist()),
                "disliked_near2_of16": m.mean_ci(
                    disliked_near(L, foldins, disliked, unit).tolist()
                ),
            }
            rows.append(row)
            print(
                f"μ {mu:<4} · cran {row['cap']!s:>5} · NDCG@20 {met['ndcg@20']['mean']:.4f} · "
                f"Recall@20 {met['recall@20']['mean']:.4f} · "
                f"C_KL@20 {row['c_kl@20']['mean']:.3f} · "
                f"excès {row['overshoot_row8']['mean']:.3f} · "
                f"voisins mal notés {row['disliked_near2_of16']['mean']:.2f}/16",
                flush=True,
            )
    out = {
        "split": "val",
        "config": "A + D2 + D1 (share, λ per cap) + D1b proximity penalty μ",
        "penalty": "s' = score / s_max - μ × max(0, max cos with the films out of the fold-in)",
        "pool": POOL,
        "n_list": N_LIST,
        "alpha": ALPHA,
        "pool_smax_median": {
            ("inf" if math.isinf(c) else str(c)): float(np.median(np.concatenate(v)))
            for c, v in smax_by_cap.items()
        },
        "users_with_disliked": float(np.mean([len(b) > 0 for b in disliked])),
        "rows": rows,
    }
    path = Path(str(PENALTY_OUT).format(tag))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2) + "\n")
    print("->", path)
    return out


TEST_OUT = RESULTS_DIR / "quality" / "test_6c.json"


def cmd_test() -> dict:
    """Q5: the single evaluation of step 6c on the **test** split, retained configuration D2 + D1
    (share, λ of PRODUCTION per cap), next to the step 2 reference (A, no D2) and D2 alone; caps on
    training-user counts, as on the validation. Run once; nothing is tuned on it."""
    from export import SLIDER_POSITIONS

    lam_of = dict(zip(SLIDER_POSITIONS, PRODUCTION["lambda_by_position"], strict=True))
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("test", catalog)
    model = sw.adapter("A", catalog)
    unit = unit_rows(model.Y)
    Gs = {k: genre_matrix(mode=k)[0] for k in MODES}  # noqa: N806
    configs = ("A (étape 2)", "A + D2", "A + D2 + D1")
    lists = {(c, cap): [] for c in configs for cap in CAPS}
    profiles = {k: [] for k in MODES}
    foldins, disliked = [], []
    for start in range(0, len(eval_set.user_ids), ev.BATCH_SIZE):
        batch = eval_set.foldin[start : start + ev.BATCH_SIZE]
        scores, Ps = user_inputs(model, batch, Gs)  # noqa: N806  (D2 fold-in)
        p_all = als.percentile_values(batch)
        full = p_all.copy()
        full.data = (1.0 + model.beta * p_all.data).astype(np.float32)
        x = als.fold_in(
            model.Y, full, regularization=model.regularization, alpha=model.alpha, yty=model.yty
        )
        scores_ref = (x.astype(np.float32) @ model.Y.T).astype(np.float64)  # step 2 (no D2)
        for k in MODES:
            profiles[k].append(Ps[k])
        for u in range(batch.shape[0]):
            lo, hi = batch.indptr[u], batch.indptr[u + 1]
            keep = als.kept_for_foldin(p_all.data[lo:hi], None, **FOLDIN_RULE)
            foldins.append(batch.indices[lo:hi].astype(np.int64))
            disliked.append(batch.indices[lo:hi][~keep].astype(np.int64))
        for cap in CAPS:
            cand = catalog.recommendable & (counts <= cap)
            lists[(configs[0], cap)].append(ev.top_k(scores_ref.copy(), batch, cand, N_LIST))
            pools = ev.top_k(scores.copy(), batch, cand, POOL)
            pool_scores = np.take_along_axis(scores, pools, axis=1)
            pools = np.where(np.isfinite(pool_scores), pools, -1)
            lists[(configs[1], cap)].append(pools[:, :N_LIST])
            lam = lam_of[None if math.isinf(cap) else cap]
            lists[(configs[2], cap)].append(
                calibrate_batch(pools, pool_scores, Ps["share"], Gs["share"], lam, N_LIST, "share")
            )
        print(f"  {start + batch.shape[0]} utilisateurs", flush=True)
    P_mass, P_share = np.vstack(profiles["mass"]), np.vstack(profiles["share"])  # noqa: N806
    rows = []
    for c in configs:
        for cap in CAPS:
            L = np.vstack(lists[(c, cap)])  # noqa: N806
            ranked = np.where(L[:, :TOP_K] >= 0, L[:, :TOP_K], 0)
            met = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
            rows.append(
                {
                    "config": c,
                    "cap": None if math.isinf(cap) else cap,
                    "lambda": lam_of[None if math.isinf(cap) else cap] if c == configs[2] else 0,
                    "ndcg@20": met["ndcg@20"],
                    "recall@20": met["recall@20"],
                    "recall_all@20": met["recall_all@20"],
                    "c_kl@20": m.mean_ci(list_kl(L, P_mass, Gs["mass"], TOP_K).tolist()),
                    "overshoot_row8": m.mean_ci(row_overshoot(L, P_share, Gs["share"]).tolist()),
                    "disliked_near2_of16": m.mean_ci(
                        disliked_near(L, foldins, disliked, unit).tolist()
                    ),
                }
            )
    out = {
        "split": "test",
        "configs": list(configs),
        "calibration": PRODUCTION,
        "foldin_rule": FOLDIN_RULE,
        "caps": "training-user ml_rating_count",
        "rows": rows,
    }
    TEST_OUT.parent.mkdir(parents=True, exist_ok=True)
    TEST_OUT.write_text(json.dumps(out, indent=2) + "\n")  # written before any print
    for r in rows:
        print(
            f"{r['config']:<12} · cran {r['cap']!s:>5} · NDCG@20 {r['ndcg@20']['mean']:.4f} "
            f"± {r['ndcg@20']['ci95']:.4f} · Recall@20 {r['recall@20']['mean']:.4f} · "
            f"Recall_all@20 {r['recall_all@20']['mean']:.4f} · "
            f"C_KL@20 {r['c_kl@20']['mean']:.3f} · excès {r['overshoot_row8']['mean']:.3f} · "
            f"voisins mal notés {r['disliked_near2_of16']['mean']:.2f}/16",
            flush=True,
        )
    print("->", TEST_OUT)
    return out


def cmd_sweep(mode: str, lambdas: tuple[float, ...] = LAMBDAS, tag: str = "") -> dict:
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    Gs = {k: genre_matrix(mode=k)[0] for k in MODES}  # noqa: N806
    G, names = Gs[mode], genre_matrix()[1]  # noqa: N806
    lists = {(lam, cap): [] for lam in lambdas for cap in CAPS}
    profiles = {k: [] for k in MODES}
    t_cal = {lam: 0.0 for lam in lambdas}
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
            for lam in lambdas:
                t0 = time.perf_counter()
                lists[(lam, cap)].append(
                    calibrate_batch(pools, pool_scores, P, G, lam, N_LIST, mode)
                )
                t_cal[lam] += time.perf_counter() - t0
        print(f"  {start + len(batch.indptr) - 1} utilisateurs", flush=True)
    P_mass, P_share = np.vstack(profiles["mass"]), np.vstack(profiles["share"])  # noqa: N806
    rows = []
    for lam in lambdas:
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
    path = Path(str(OUT).format(mode + tag))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2) + "\n")
    print("->", path)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["sweep", "penalty-sweep", "test"])
    parser.add_argument("--mode", choices=MODES, default="mass")
    parser.add_argument("--lambdas", help="comma-separated λ (default: the main grid)")
    parser.add_argument("--mus", help="comma-separated μ of penalty-sweep (default: PENALTY_MUS)")
    parser.add_argument("--tag", default="", help="suffix of the result file")
    args = parser.parse_args()
    # λ and μ in the output: a redirected stdout is cp1252 on Windows
    sys.stdout.reconfigure(encoding="utf-8")
    if args.cmd == "test":
        cmd_test()
        return 0
    if args.cmd == "penalty-sweep":
        mus = tuple(float(x) for x in args.mus.split(",")) if args.mus else PENALTY_MUS
        cmd_penalty_sweep(mus, args.tag)
        return 0
    lambdas = tuple(float(x) for x in args.lambdas.split(",")) if args.lambdas else LAMBDAS
    cmd_sweep(args.mode, lambdas, args.tag)
    return 0


if __name__ == "__main__":
    sys.exit(main())
