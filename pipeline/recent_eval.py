"""Step 8, R3: false cold start on the 2022-2023 films of the catalogue (D5 of
docs/etape-8-films-recents.md). Validation split only; the test is evaluated once, at closing.

    uv run python recent_eval.py retrain    # ALS config A on the training users, base films removed
    uv run python recent_eval.py run [--only "NAME;NAME"] [--tag T]   # scenarios -> results JSON

Protocol:
- base = the 463 catalogue films released in 2022-2023 (year column). They lose their vector:
  ALS (config A, same seed) is retrained on the training users WITHOUT their ratings, so YᵀY and
  every other vector ignore them (D6: YᵀY = trained films only).
- they are placed with coldstart.place (D1-D3): TMDB `recommendations` that are trained films,
  plus the base films released before them (chronological); content model fitted on the other
  catalogue films; norm = median norm of the trained films of the same TMDB vote bin (D1c).
- references: the true vectors (original config A model, ceiling), the mean direction at the
  target norm ("popularité", floor: base films ranked by votes, no taste), random neighbours.
- validation users, step 6c fold-in rule (percentile < 0.3 dropped, at least 5 films kept); base
  films of the fold-in enter it with their estimated vector and the weight omega (D6).
- metrics: Recall@20 on the relevant (well-rated) held-out base films only, by TMDB vote bin and
  MovieLens count; rank percentile of each relevant base film; NDCG@20 of the full lists at
  inf, 2 000 and 500 (caps: year_all popularity on training counts; estimated base films get the
  D7 popularity, reference 2018-2021); share of base films in the top 20.
Results in data/processed/results/recent/ (ignored by git). Counts only, no title.
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
from dataclasses import asdict, dataclass, replace  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402

import evaluate as ev  # noqa: E402
import metrics as mt  # noqa: E402
import popularity as popm  # noqa: E402
import sweep_slider as sw  # noqa: E402
from config import PROCESSED, RESULTS_DIR, SEED, TOP_K  # noqa: E402
from models import als  # noqa: E402
from models import coldstart as cs  # noqa: E402
from recent_films import DISCOVER_PARQUET, FILMS_PARQUET  # noqa: E402

BASE_YEARS = (2022, 2023)
REFERENCE_YEARS_EVAL = (2018, 2021)  # D7 reference without the base (site: 2019-2022)
DROP_BELOW, MIN_KEPT = 0.3, 5  # step 6c, D2
CAPS = (math.inf, 2_000, 500)
LAMBDAS = (10.0, 30.0, 100.0, 300.0, 1000.0, 3000.0)
BAYES_M = 200.0
OUT = RESULTS_DIR / "recent"
RETRAINED = PROCESSED / "models" / "als_coldstart_base2223_f64_r0.05_a1_b1_i30_item_factors.npy"


def content_weight(ml_counts: np.ndarray) -> np.ndarray:
    """Trust in a trained vector: films with few MovieLens ratings have noisy vectors (R0, 2.3)."""
    return np.minimum(1.0, np.asarray(ml_counts, dtype=np.float64) / 200.0)


# --- data -----------------------------------------------------------------------------------------


@dataclass
class Data:
    catalog: ev.Catalog
    cat: pl.DataFrame  # catalogue columns, item_idx order
    base: np.ndarray  # bool per item
    films: dict[int, dict]  # item_idx -> tmdb_films row (catalogue films with a full answer)
    tmdb_to_item: dict[int, int]
    counts: np.ndarray  # training-user counts
    pop: np.ndarray  # year_all popularity on training counts (caps)
    r_ref: float
    pop_rule: str = "rank"  # "rank": step 8 rule from 2019 (R3d); "old": year_all only


def load_data(pop_rule: str = "rank") -> Data:
    catalog = ev.load_catalog()
    cat = pl.read_parquet(
        ev.CATALOG_PARQUET,
        columns=["item_idx", "tmdb_id", "year", "ml_rating_count", "tmdb_vote_count"],
    ).sort("item_idx")
    base = np.isin(cat["year"].fill_null(0).to_numpy(), BASE_YEARS)
    films = {}
    if FILMS_PARQUET.exists():  # not needed by `retrain`
        films_df = pl.read_parquet(FILMS_PARQUET).filter("in_catalog")
        films = {int(r["item_idx"]): r for r in films_df.to_dicts()}
    tmdb_to_item = {int(t): i for i, t in enumerate(cat["tmdb_id"].to_list()) if t is not None}
    counts = ev.train_counts(catalog)
    years = cat["year"].cast(pl.Float64).fill_null(np.nan).to_numpy()
    votes = cat["tmdb_vote_count"].cast(pl.Float64).fill_null(np.nan).to_numpy()
    pop, info = popm.year_corrected(counts, votes, years)
    if pop_rule == "rank" and DISCOVER_PARQUET.exists():
        # R3d: rank of the TMDB votes within the year from 2019 (reference 2010-2018), as on the
        # site, on training-user counts; the base films (2022-2023) get it too.
        pop, _ = popm.rank_corrected(
            pop,
            cat["tmdb_id"].to_list(),
            years,
            votes,
            popm.discover_frame(DISCOVER_PARQUET),
            info["r_ref"],
        )
    return Data(catalog, cat, base, films, tmdb_to_item, counts, pop, info["r_ref"], pop_rule)


def cmd_retrain() -> int:
    data = load_data()
    cfg = sw.CONFIGS["A"]
    R = ev.train_ratings(data.catalog).tocsc()  # noqa: N806
    for j in np.flatnonzero(data.base):
        R.data[R.indptr[j] : R.indptr[j + 1]] = 0.0
    R = R.tocsr()  # noqa: N806
    removed = int((R.data == 0).sum())
    R.eliminate_zeros()
    t0 = time.perf_counter()
    model = als.train(
        als.signal_values(R, cfg["beta"]),
        factors=cfg["factors"],
        regularization=cfg["regularization"],
        alpha=cfg["alpha"],
        iterations=cfg["iterations"],
        seed=SEED,
    )
    Y = np.asarray(model.item_factors, dtype=np.float32)  # noqa: N806
    RETRAINED.parent.mkdir(parents=True, exist_ok=True)
    np.save(RETRAINED, Y)
    norms = np.linalg.norm(Y[data.base], axis=1)
    print(
        f"ALS sans la base : {removed} notes retirées ({int(data.base.sum())} films), "
        f"{time.perf_counter() - t0:.0f} s ; norme max des vecteurs de la base {norms.max():.2e}"
    )
    return 0


# --- placement ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Variant:
    name: str
    kind: str = "place"  # place | true | true_dir | floor | random
    params: cs.Params = cs.Params()
    omega: float = 1.0
    rho: float = 0.0  # D4
    yty_with_estimates: bool = False
    norm_by: str = "votes"  # D1c target: TMDB vote bin ("votes") or slider popularity bin
    ref_years: tuple[int, int] = REFERENCE_YEARS_EVAL  # D7 reference of the base popularity


def neighbours_of(data: Data, item: int) -> list[int]:
    f = data.films.get(item)
    if f is None:
        return []
    return [data.tmdb_to_item[t] for t in f["recommendations"] if t in data.tmdb_to_item]


class Placer:
    """Everything a variant needs that does not depend on its parameters."""

    def __init__(self, data: Data, Y: np.ndarray):  # noqa: N803
        self.data = data
        self.Y = Y
        ref = np.flatnonzero(~data.base)
        self.ref = ref
        self.mu = Y[ref].astype(np.float64).mean(0)
        self.known = {int(i): Y[i].astype(np.float64) for i in ref}
        votes = np.array([self.votes(i) for i in range(len(Y))])
        self.votes_all = votes
        self.table = cs.norm_table(votes[ref], np.linalg.norm(Y[ref], axis=1))
        self.pop_table = cs.norm_table(
            data.pop[ref], np.linalg.norm(Y[ref], axis=1), edges=cs.POPULARITY_BIN_EDGES
        )
        self.base_items = np.flatnonzero(data.base)
        self._base_pop: dict[tuple[int, int], np.ndarray] = {}
        self.content_pred, self.telling, self.lam = self.fit_content()

    def votes(self, i: int) -> float:
        f = self.data.films.get(i)
        if f is not None:
            return float(f["vote_count"] or 0)
        v = self.data.cat["tmdb_vote_count"][i]
        return float(v or 0)

    def fit_content(self):
        d = self.data
        ref = [i for i in self.ref if i in d.films]
        films = [d.films[i] for i in ref]
        T = self.Y[ref].astype(np.float64) - self.mu  # noqa: N806
        w = content_weight(d.cat["ml_rating_count"].to_numpy()[ref])
        vocab = cs.build_vocab(films)
        rng = np.random.default_rng(SEED)
        fold = rng.integers(0, 3, len(ref))
        best = None
        for lam in LAMBDAS:
            cos = []
            for k in range(3):
                tr, te = fold != k, fold == k
                m = cs.fit_content(
                    [f for f, t in zip(films, tr, strict=True) if t], T[tr], w[tr], lam, vocab
                )
                pred, _ = m.predict([f for f, t in zip(films, te, strict=True) if t])
                num = (pred * T[te]).sum(1)
                den = np.linalg.norm(pred, axis=1) * np.linalg.norm(T[te], axis=1) + 1e-12
                cos.append(float(np.average(num / den, weights=w[te])))
            score = float(np.mean(cos))
            print(f"  contenu λ = {lam:g} : cosinus centré moyen (pondéré, 3 plis) {score:.3f}")
            if best is None or score > best[1]:
                best = (lam, score)
        lam = best[0]
        model = cs.fit_content(films, T, w, lam, vocab)
        base_films = [d.films.get(int(i), {}) for i in self.base_items]
        pred, telling = model.predict(base_films)
        print(f"  contenu retenu : λ = {lam:g}, {len(vocab)} caractéristiques")
        return (
            {int(i): pred[k] for k, i in enumerate(self.base_items)},
            {int(i): int(telling[k]) for k, i in enumerate(self.base_items)},
            lam,
        )

    def base_pop(self, ref_years: tuple[int, int]) -> np.ndarray:
        """D7 popularity of the base films (rank of the votes within the year, reference years)."""
        if self.data.pop_rule == "rank":
            return self.data.pop[self.base_items]  # same rank rule as the catalogue (R3d)
        if ref_years in self._base_pop:
            return self._base_pop[ref_years]
        d = self.data
        disc = pl.read_parquet(DISCOVER_PARQUET).with_columns(
            year=pl.col("release_date").str.slice(0, 4).cast(pl.Int64, strict=False)
        )
        lo, hi = ref_years
        ref = disc.filter(pl.col("year").is_between(lo, hi))
        ref_pop = [
            d.pop[d.tmdb_to_item[t]] if t in d.tmdb_to_item else round(d.r_ref * v)
            for t, v in zip(ref["id"].to_list(), ref["vote_count"].to_list(), strict=True)
        ]
        out = np.zeros(len(self.base_items), dtype=np.int64)
        years = np.array([d.cat["year"][int(i)] for i in self.base_items])
        for year in BASE_YEARS:
            sel = np.flatnonzero(years == year)
            votes_y = disc.filter(pl.col("year") == year)["vote_count"].to_numpy().astype(float)
            v_items = self.votes_all[self.base_items[sel]]
            allv = np.concatenate([votes_y, v_items])
            pct = cs.within_year_percentile(allv, np.zeros(len(allv)))[len(votes_y) :]
            out[sel] = cs.rank_popularity(pct, ref_pop, v_items, d.r_ref)
        self._base_pop[ref_years] = out
        return out

    def targets(self, v: Variant, pop_table=None, vote_table=None) -> np.ndarray:
        """D1c target norm of each base film (order of base_items)."""
        if v.norm_by == "popularity":
            table = self.pop_table if pop_table is None else pop_table
            return cs.target_norms(self.base_pop(v.ref_years), table, cs.POPULARITY_BIN_EDGES)
        table = self.table if vote_table is None else vote_table
        return cs.target_norms(self.votes_all[self.base_items], table)

    def base_films(self, neighbours, v: Variant) -> list[dict]:
        out = []
        targets = self.targets(v)
        for k, i in enumerate(self.base_items):
            f = self.data.films.get(int(i), {})
            out.append(
                {
                    "key": int(i),
                    "release_date": f.get("release_date") or str(self.data.cat["year"][int(i)]),
                    "neighbours": neighbours(int(i)),
                    "target_norm": float(targets[k]),
                }
            )
        return out

    def vectors(self, v: Variant) -> tuple[dict[int, np.ndarray], dict[int, dict]]:
        d = self.data
        if v.kind == "floor":
            vec = {
                f["key"]: cs.popularity_floor(self.mu, f["target_norm"])
                for f in self.base_films(lambda i: [], v)
            }
            return vec, {k: {"placed": True, "depth": 0} for k in vec}
        if v.kind == "random":
            rng = np.random.default_rng(SEED)
            pool = self.ref
            films = self.base_films(
                lambda i: [int(x) for x in rng.choice(pool, 20, replace=False)], v
            )
        else:
            films = self.base_films(lambda i: neighbours_of(d, i), v)
        placed = cs.place(films, self.known, self.mu, v.params, self.content_pred, self.telling)
        return placed.vectors, placed.info


# --- evaluation -----------------------------------------------------------------------------------


def run_variant(data: Data, es: ev.EvalSet, Y_true: np.ndarray, placer: Placer, v: Variant):  # noqa: N803
    t0 = time.perf_counter()
    cfg = sw.CONFIGS["A"]
    n_items = data.catalog.n_items
    omega_item = np.ones(n_items)
    available = np.ones(n_items, dtype=bool)
    penalty = np.zeros(n_items)
    info: dict = {}
    if v.kind == "true":
        Y = Y_true.astype(np.float64)  # noqa: N806
        yty = Y.T @ Y
        pop = data.pop
    elif v.kind == "true_dir":
        # true direction (config A), D1c norm and D7 popularity: the ceiling of a placement
        Y = Y_true.astype(np.float64).copy()  # noqa: N806
        ref = placer.ref
        norms = np.linalg.norm(Y[ref], axis=1)
        t = placer.targets(
            v,
            pop_table=cs.norm_table(data.pop[ref], norms, edges=cs.POPULARITY_BIN_EDGES),
            vote_table=cs.norm_table(placer.votes_all[ref], norms),
        )
        b = placer.base_items
        Y[b] *= (t / np.linalg.norm(Y[b], axis=1))[:, None]
        yty = Y[~data.base].T @ Y[~data.base]
        pop = data.pop.copy()
        pop[b] = placer.base_pop(v.ref_years)
    else:
        vec, info = placer.vectors(v)
        Y = placer.Y.astype(np.float64).copy()  # noqa: N806
        Y[data.base] = 0.0
        for k, x in vec.items():
            Y[k] = x
        trained = ~data.base
        yty = Y[trained].T @ Y[trained]
        if v.yty_with_estimates:
            yty = Y.T @ Y
        available[data.base] = False
        available[list(vec)] = True
        omega_item[data.base] = 0.0
        omega_item[list(vec)] = v.omega
        pop = data.pop.copy()
        pop[placer.base_items] = placer.base_pop(v.ref_years)
        pop[~available & data.base] = np.iinfo(np.int64).max
        if v.rho > 0:
            bf = [data.films.get(int(i), {}) for i in placer.base_items]
            avg = np.array([f.get("vote_average") or np.nan for f in bf], dtype=np.float64)
            vts = np.array([placer.votes_all[i] for i in placer.base_items])
            c = float(np.nanmean(avg))
            rt = cs.bayes_rating(avg, vts, BAYES_M, c)
            penalty[placer.base_items] = v.rho * np.maximum(0.0, c - rt)
    Y32 = Y.astype(np.float32)  # noqa: N806
    vote_lo = np.array([placer.votes_all[i] < 500 for i in range(n_items)])
    ml_lo = data.cat["ml_rating_count"].to_numpy() < 100
    strata = {
        "tout": data.base,
        "< 500 votes": data.base & vote_lo,
        "≥ 500 votes": data.base & ~vote_lo,
        "< 100 notes ML": data.base & ml_lo,
        "≥ 100 notes ML": data.base & ~ml_lo,
    }
    recall = {s: [] for s in strata}
    pcts = {s: [] for s in strata}
    user_rec = {}  # user row -> recall on all base (paired comparison)
    user_bad = {}  # user row -> share of the top 20 = base films seen and disliked (R3b)
    ndcg = {c: [] for c in CAPS}
    share = {c: [] for c in CAPS}
    ndcg_fold = []  # users with a base film in their fold-in (D6)
    for start in range(0, len(es.user_ids), ev.BATCH_SIZE):
        batch = es.foldin[start : start + ev.BATCH_SIZE]
        p = als.percentile_values(batch)
        X = np.zeros((batch.shape[0], Y.shape[1]))  # noqa: N806
        for u in range(batch.shape[0]):
            lo, hi = p.indptr[u], p.indptr[u + 1]
            items, pu = p.indices[lo:hi], p.data[lo:hi]
            keep = als.kept_for_foldin(pu, None, drop_below=DROP_BELOW, min_kept=MIN_KEPT)
            items, pu = items[keep], pu[keep]
            om = omega_item[items]
            if om.sum() == 0:
                continue
            r = np.float32(1.0) + np.float32(cfg["beta"]) * pu
            X[u] = cs.fold_in_weighted(
                Y, items, r, om, regularization=cfg["regularization"], alpha=cfg["alpha"], yty=yty
            )
        scores = X.astype(np.float32) @ Y32.T
        if v.rho > 0:
            top = np.max(np.where(available & data.catalog.recommendable, scores, -np.inf), axis=1)
            scores -= np.outer(np.maximum(top, 0.0), penalty).astype(np.float32)
        cand = data.catalog.recommendable & available
        rows = np.repeat(np.arange(batch.shape[0]), np.diff(batch.indptr))
        seen_scores = scores.copy()
        seen_scores[:, ~cand] = -np.inf
        seen_scores[rows, batch.indices] = -np.inf
        for cap in CAPS:
            cmask = cand & (pop <= cap)
            ranked = ev.top_k(scores.copy(), batch, cmask, TOP_K)
            for u in range(batch.shape[0]):
                g = start + u
                val = mt.ndcg_at_k(ranked[u], es.relevant[g], TOP_K)
                ndcg[cap].append(val)
                share[cap].append(float(data.base[ranked[u]].mean()))
                if cap == math.inf:
                    in_fold = data.base[batch[u].indices].any()
                    if in_fold:
                        ndcg_fold.append(val)
                    rel = es.relevant[g]
                    held = es.heldout[g]
                    bad = held[~np.isin(held, rel)]  # held-out rating below the fold-in median
                    bad = bad[data.base[bad]]
                    if len(bad):
                        user_bad[g] = float(np.isin(ranked[u], bad).sum() / TOP_K)
                    for s, mask in strata.items():
                        rb = rel[mask[rel]]
                        if len(rb) == 0:
                            continue
                        hit = np.isin(ranked[u], rb).sum() / min(TOP_K, len(rb))
                        recall[s].append(float(hit))
                        if s == "tout":
                            user_rec[g] = float(hit)
                        row = seen_scores[u]
                        valid = row > -np.inf
                        nv = valid.sum()
                        for f in rb:
                            if not valid[f]:
                                pcts[s].append(0.0)  # not placed: never recommended
                                continue
                            pcts[s].append(float((valid & (row < row[f])).sum() / (nv - 1)))
    out = {
        "variant": v.name,
        "kind": v.kind,
        "params": asdict(v.params),
        "omega": v.omega,
        "rho": v.rho,
        "yty_with_estimates": v.yty_with_estimates,
        "seconds": round(time.perf_counter() - t0, 1),
        "recall_base": {s: mt.mean_ci(x) for s, x in recall.items()},
        "rank_pct_base": {s: mt.mean_ci(x) for s, x in pcts.items()},
        "ndcg": {str(c): mt.mean_ci(x) for c, x in ndcg.items()},
        "base_share_top20": {str(c): float(np.mean(x)) for c, x in share.items()},
        "ndcg_users_base_in_foldin": mt.mean_ci(ndcg_fold),
        "user_recall": user_rec,
        "user_bad_share": user_bad,
        "bad_share_top20": mt.mean_ci(user_bad.values()),
    }
    if info:
        placed = [k for k, x in info.items() if x.get("placed")]
        depth = [info[k]["depth"] for k in placed]
        out["placed"] = len(placed)
        out["depth"] = {str(d): depth.count(d) for d in sorted(set(depth))}
        out["n_neighbours_median"] = float(
            np.median([info[k].get("n_neighbours", 0) for k in placed])
        )
        if v.kind not in ("true", "true_dir"):
            pb = pop[placer.base_items]
            out["base_pop_under_cap"] = {
                str(c): float((pb <= c).mean()) for c in (20_000, 5_000, 2_000, 500, 200)
            }
    return out


# --- scenarios ------------------------------------------------------------------------------------


def variants() -> list[Variant]:
    nb = cs.Params(use_content=False)
    mix = cs.Params()
    ct = cs.Params(use_neighbours=False)
    old = (2010, 2017)
    pp = "popularity"
    out = [
        Variant("vrai vecteur", kind="true"),
        Variant("vraie direction, norme votes", kind="true_dir"),
        Variant("vraie direction, norme popularité", kind="true_dir", norm_by=pp),
        Variant("popularité", kind="floor"),
        Variant("popularité, norme popularité", kind="floor", norm_by=pp),
        Variant("hasard (voisins tirés au hasard)", kind="random", params=nb),
        Variant("voisins", params=nb),
        Variant("voisins sans chronologie", params=replace(nb, chronological=False)),
        Variant("voisins sans recalage de la norme", params=replace(nb, rescale=False)),
        Variant("voisins k = 3", params=replace(nb, k=3)),
        Variant("voisins k = 10", params=replace(nb, k=10)),
        Variant("voisins s = 0,5", params=replace(nb, s=0.5)),
        Variant("voisins s = 2", params=replace(nb, s=2.0)),
        Variant("contenu", params=ct),
        Variant("contenu sans recalage de la norme", params=replace(ct, rescale=False)),
        Variant("mélange κ = 1", params=replace(mix, kappa=1.0)),
        Variant("mélange κ = 3", params=mix),
        Variant("mélange κ = 10", params=replace(mix, kappa=10.0)),
        Variant("mélange κ = 30", params=replace(mix, kappa=30.0)),
        Variant("mélange κ = 3, YᵀY avec les estimés", params=mix, yty_with_estimates=True),
        Variant("contenu, norme popularité", params=ct, norm_by=pp),
        Variant("contenu, référence 2010-2017", params=ct, ref_years=old),
        Variant("contenu, norme popularité, réf. 2010-2017", params=ct, norm_by=pp, ref_years=old),
        Variant("mélange κ = 10, norme popularité", params=replace(mix, kappa=10.0), norm_by=pp),
    ]
    for cs_ in (1.5, 2.0, 3.0):
        out.append(
            Variant(
                f"contenu ×{cs_:g}, norme pop.", params=replace(ct, content_scale=cs_), norm_by=pp
            )
        )
    for ns in (0.8, 0.6):
        out.append(
            Variant(f"contenu, norme pop. ×{ns:g}", params=replace(ct, norm_scale=ns), norm_by=pp)
        )
    out.append(
        Variant(
            "contenu ×2, norme pop. ×0.8",
            params=replace(ct, content_scale=2.0, norm_scale=0.8),
            norm_by=pp,
        )
    )
    for om in (0.0, 0.5):
        out.append(Variant(f"contenu, ω = {om:g}", params=ct, omega=om))
        out.append(Variant(f"contenu, norme pop., ω = {om:g}", params=ct, omega=om, norm_by=pp))
    for rho in (0.05, 0.1, 0.2):
        out.append(Variant(f"contenu, ρ = {rho:g}", params=ct, rho=rho))
        out.append(Variant(f"contenu, norme pop., ρ = {rho:g}", params=ct, rho=rho, norm_by=pp))
    return out


def paired(a: dict, b: dict) -> dict:
    users = sorted(set(a) & set(b))
    return mt.mean_ci(a[u] - b[u] for u in users)


def print_table(results: list[dict]) -> None:
    def f(x, key="mean"):
        return f"{x[key]:.4f}" if x.get("n") else "—"

    print(
        "\n| variante | Recall@20 base | ± | < 500 votes | ≥ 500 votes | < 100 ML | ≥ 100 ML "
        "| rang centile | NDCG ∞ | NDCG 2 000 | NDCG 500 | part base top 20 ∞ |"
    )
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        rb = r["recall_base"]
        print(
            f"| {r['variant']} | {f(rb['tout'])} | {rb['tout'].get('ci95', 0):.4f} | "
            f"{f(rb['< 500 votes'])} | {f(rb['≥ 500 votes'])} | {f(rb['< 100 notes ML'])} | "
            f"{f(rb['≥ 100 notes ML'])} | {f(r['rank_pct_base']['tout'])} | "
            f"{f(r['ndcg']['inf'])} | {f(r['ndcg']['2000'])} | {f(r['ndcg']['500'])} | "
            f"{100 * r['base_share_top20']['inf']:.2f} % |"
        )


def print_details(results: list[dict]) -> None:
    print(
        "\n| variante | rang centile | < 500 votes | ≥ 500 votes | part de la base dans le top 20 "
        "∞ / 2 000 / 500 | NDCG@20 ∞, fold-in avec la base | base sous 2 000 / 500 |"
    )
    print("|---|---|---|---|---|---|---|")
    for r in results:
        rp, s, nf = r["rank_pct_base"], r["base_share_top20"], r["ndcg_users_base_in_foldin"]
        under = r.get("base_pop_under_cap") or {}
        u = f"{100 * under['2000']:.0f} / {100 * under['500']:.0f} %" if under else "—"
        print(
            f"| {r['variant']} | {rp['tout']['mean']:.3f} | {rp['< 500 votes']['mean']:.3f} | "
            f"{rp['≥ 500 votes']['mean']:.3f} | {100 * s['inf']:.1f} / {100 * s['2000']:.1f} / "
            f"{100 * s['500']:.1f} % | {nf['mean']:.4f} ± {nf['ci95']:.4f} | {u} |"
        )


def cmd_run(only: list[str] | None, tag: str, pop_rule: str = "rank") -> int:
    data = load_data(pop_rule)
    print(f"popularité des crans : {pop_rule}", flush=True)
    catalog = data.catalog
    es = ev.load_eval_set("val", catalog)
    Y_true = sw.load_factors(sw.CONFIGS["A"], catalog)  # noqa: N806
    Y_re = np.load(RETRAINED)  # noqa: N806
    print(f"base : {int(data.base.sum())} films ; préparation du placement…", flush=True)
    placer = Placer(data, Y_re)
    results = []
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"coldstart_val{tag}.json"
    for v in variants():
        if only and v.name not in only:
            continue
        r = run_variant(data, es, Y_true, placer, v)
        results.append(r)
        print(
            f"{v.name} : Recall@20 base {r['recall_base']['tout']['mean']:.4f} "
            f"(< 500 votes {r['recall_base']['< 500 votes'].get('mean', float('nan')):.4f}) · "
            f"NDCG∞ {r['ndcg']['inf']['mean']:.4f} · {r['seconds']} s",
            flush=True,
        )
        path.write_text(json.dumps({"lambda_content": placer.lam, "results": results}, indent=1))
    print_table(results)
    print_details(results)
    by = {r["variant"]: r for r in results}
    if "popularité" in by:
        for r in results:
            if r["kind"] != "true":
                d = paired(r["user_recall"], by["popularité"]["user_recall"])
                print(f"  {r['variant']} − popularité : {d['mean']:+.4f} ± {d['ci95']:.4f}")
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("retrain")
    r = sub.add_parser("run")
    r.add_argument("--only", default="")
    r.add_argument("--tag", default="")
    r.add_argument("--pop", choices=("rank", "old"), default="rank")
    args = p.parse_args()
    if args.cmd == "retrain":
        return cmd_retrain()
    only = [s.strip() for s in args.only.split(";") if s.strip()] or None
    return cmd_run(only, args.tag, args.pop)


if __name__ == "__main__":
    raise SystemExit(main())
