"""Step 8, visual stop: analysis of the settings (docs/etape-8-analyse-reglages.md). Measures only,
nothing changes the site.

    uv run python tuning_analysis.py sweep [--tag T]   # validation, ~1 h 30
    uv run python tuning_analysis.py tmdb-age          # TMDB rating vs MovieLens quality by age

`sweep`: protocol of `quality_term.py` (validation users, fold-in D2, caps on training-user
counts, q = Bayesian mean of the training ratings, K = 50, pool of 150, share calibration).
Variants:
- question 1 (all notches): current (gamma 0.1, lambda table of production), no calibration,
  lambda 0.3 / 0.5 / 0.7 at the notches <= 5 000 (the others unchanged), no quality term;
- question 3 (notches ∞, 2 000, 500): gamma 0.2 and 0.3; targeted classics bonus
  score' += gc * max(0, q - q_thr), q_thr = percentile 95 / 98 / 99 of q over the recommendable
  films, gc in {0.2, 0.5, 1}.
Metrics on the top 20 of the 48: NDCG@20 and Recall@20 on the well-rated held-out films and on
all of them, paired differences with the current setting (95 % CI), share of animation in the
lists against the profile, median popularity. Results: data/processed/results/quality/
tuning_val*.json (ignored).

`tmdb-age`: residual of the MovieLens quality against the TMDB line (model-meta `quality.tmdb`)
by release year and TMDB votes, and the q of the estimated films against the catalogue.
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
from config import RESULTS_DIR, TOP_K, WEB_DATA  # noqa: E402
from quality_term import bayes_quality, train_rating_stats  # noqa: E402

OUT_DIR = RESULTS_DIR / "quality"
ALL_CAPS = (math.inf, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200)
LOW_CAPS = (5_000, 2_000, 1_000, 500, 200)
CLASSIC_CAPS = (math.inf, 2_000, 500)
PERCENTILES = (95, 98, 99)
CLASSIC_GAMMAS = (0.2, 0.5, 1.0)
GAMMA = 0.1
K = 50


def production_lambda() -> dict[float, float]:
    return dict(
        zip(
            [math.inf if c is None else c for c in ALL_PROD_POSITIONS],
            cal.PRODUCTION["lambda_by_position"],
            strict=True,
        )
    )


ALL_PROD_POSITIONS = (None, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200)


def variants(q_thr: dict[int, float]) -> list[dict]:
    """name, gamma, lambda per cap, classics (gc, thr) and the caps where the variant differs."""
    prod = production_lambda()
    out = [
        {"name": "actuel", "gamma": GAMMA, "lam": prod, "caps": ALL_CAPS},
        {"name": "sans calibration", "gamma": GAMMA, "lam": dict.fromkeys(ALL_CAPS, 0.0)},
        {"name": "sans qualité", "gamma": 0.0, "lam": prod, "caps": ALL_CAPS},
    ]
    out[1]["caps"] = ALL_CAPS
    for lam in (0.3, 0.5, 0.7):
        out.append(
            {
                "name": f"λ {lam:g} (≤ 5 000)",
                "gamma": GAMMA,
                "lam": prod | dict.fromkeys(LOW_CAPS, lam),
                "caps": LOW_CAPS,
            }
        )
    for g in (0.2, 0.3):
        out.append({"name": f"γ {g:g}", "gamma": g, "lam": prod, "caps": CLASSIC_CAPS})
    for p in PERCENTILES:
        for gc in CLASSIC_GAMMAS:
            out.append(
                {
                    "name": f"classiques c{p} γc {gc:g}",
                    "gamma": GAMMA,
                    "lam": prod,
                    "classics": (gc, q_thr[p]),
                    "caps": CLASSIC_CAPS,
                }
            )
    return out


def lists_for(scores, batch, cand, bonus, P, G, lam):  # noqa: N803
    """(B, 48): pool of 150 on score / s_max + bonus, then the calibration (none if lam = 0)."""
    masked = scores.copy()
    masked[:, ~cand] = -np.inf
    rows = np.repeat(np.arange(batch.shape[0]), np.diff(batch.indptr))
    masked[rows, batch.indices] = -np.inf
    smax = masked.max(axis=1, keepdims=True)
    smax = np.where(np.isfinite(smax) & (smax > 0), smax, 1.0)
    adj = scores / smax + bonus[None, :]
    pools = ev.top_k(adj.copy(), batch, cand, cal.POOL)
    finite = np.isfinite(np.take_along_axis(masked, pools, axis=1))
    pools = np.where(finite, pools, -1)
    if lam == 0.0:
        return pools[:, : cal.N_LIST]
    pool_scores = np.take_along_axis(adj, pools, axis=1)
    return cal.calibrate_batch(pools, pool_scores, P, G, lam, cal.N_LIST, "share")


def cmd_sweep(tag: str, users: int = 0) -> dict:
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    G, names = cal.genre_matrix(mode="share")  # noqa: N806
    anim = names.index("Animation")
    n_tr, s_tr, c = train_rating_stats(catalog)
    q = bayes_quality(s_tr, n_tr, K, c)
    rec_q = q[catalog.recommendable]
    q_thr = {p: float(np.percentile(rec_q, p)) for p in PERCENTILES}
    above = {p: int((rec_q > q_thr[p]).sum()) for p in PERCENTILES}
    vs = variants(q_thr)
    bonuses = {}
    for v in vs:
        b = v["gamma"] * q
        if "classics" in v:
            gc, thr = v["classics"]
            b = b + gc * np.maximum(0.0, q - thr)
        bonuses[v["name"]] = b
    lists = {(v["name"], cap): [] for v in vs for cap in v["caps"]}
    profiles = []
    t0 = time.time()
    n_users = min(users, len(eval_set.user_ids)) if users else len(eval_set.user_ids)
    for start in range(0, n_users, ev.BATCH_SIZE):
        batch = eval_set.foldin[start : min(start + ev.BATCH_SIZE, n_users)]
        scores, Ps = cal.user_inputs(model, batch, {"share": G})  # noqa: N806
        profiles.append(Ps["share"][:, anim])
        for cap in ALL_CAPS:
            cand = catalog.recommendable & (counts <= cap)
            for v in vs:
                if cap not in v["caps"]:
                    continue
                lists[(v["name"], cap)].append(
                    lists_for(
                        scores, batch, cand, bonuses[v["name"]], Ps["share"], G, v["lam"][cap]
                    )
                )
        print(f"  {start + batch.shape[0]} utilisateurs ({time.time() - t0:.0f} s)", flush=True)
    p_anim = np.concatenate(profiles)
    rows, per_user = [], {}
    for v in vs:
        for cap in v["caps"]:
            L = np.vstack(lists[(v["name"], cap)])  # noqa: N806
            valid = L[:, :TOP_K] >= 0
            ranked = np.where(valid, L[:, :TOP_K], 0)
            n_rel = [m.ndcg_at_k(ranked[u], eval_set.relevant[u], TOP_K) for u in range(len(L))]
            r_rel = [m.recall_at_k(ranked[u], eval_set.relevant[u], TOP_K) for u in range(len(L))]
            n_all = [m.ndcg_at_k(ranked[u], eval_set.heldout[u], TOP_K) for u in range(len(L))]
            r_all = [m.recall_at_k(ranked[u], eval_set.heldout[u], TOP_K) for u in range(len(L))]
            per_user[(v["name"], cap)] = (n_rel, r_rel, n_all, r_all)
            v48 = L >= 0
            anim48 = (G[np.where(v48, L, 0), anim] * v48).sum(axis=1) / np.maximum(v48.sum(1), 1)
            pops = counts[ranked]
            rows.append(
                {
                    "variant": v["name"],
                    "cap": None if math.isinf(cap) else cap,
                    "lambda": v["lam"][cap],
                    "gamma": v["gamma"],
                    "classics": v.get("classics"),
                    "ndcg_rel@20": m.mean_ci(n_rel),
                    "recall_rel@20": m.mean_ci(r_rel),
                    "ndcg_all@20": m.mean_ci(n_all),
                    "recall_all@20": m.mean_ci(r_all),
                    "anim_share@48": float(anim48.mean()),
                    "anim_profile": float(p_anim.mean()),
                    "anim_excess@48": float((anim48 - p_anim).mean()),
                    "pop_median@20": float(np.median(np.median(np.where(valid, pops, 0), axis=1))),
                    "q_mean@20": float(q[ranked][valid].mean()),
                }
            )
    for r in rows:
        cap = math.inf if r["cap"] is None else r["cap"]
        a = per_user[(r["variant"], cap)]
        b = per_user[("actuel", cap)]
        for j, name in enumerate(("ndcg_rel@20", "recall_rel@20", "ndcg_all@20", "recall_all@20")):
            d = [x - y for x, y in zip(a[j], b[j], strict=True) if x is not None and y is not None]
            r[f"delta_{name}"] = m.mean_ci(d)
    out = {
        "split": "val",
        "gamma": GAMMA,
        "shrink": K,
        "C": c,
        "q_thresholds": q_thr,
        "above_threshold": above,
        "n_recommendable": int(catalog.recommendable.sum()),
        "rows": rows,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"tuning_val{tag}.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print_rows(out)
    print("->", path)
    return out


def print_rows(out: dict) -> None:
    print("seuils q :", {p: round(t, 3) for p, t in out["q_thresholds"].items()})
    print("films au-dessus :", out["above_threshold"])
    print(
        "\n| variante | cran | NDCG@20 bien notés | Δ | Recall@20 bien notés | Δ | NDCG@20 tous "
        "| Δ | Recall@20 tous | Δ | animation 48 (profil) | pop. médiane |"
    )
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")

    def d(r, name):
        x = r[f"delta_{name}"]
        return "—" if r["variant"] == "actuel" else f"{x['mean']:+.4f} ± {x['ci95']:.4f}"

    for r in out["rows"]:
        cap = "∞" if r["cap"] is None else r["cap"]
        print(
            f"| {r['variant']} | {cap} | {r['ndcg_rel@20']['mean']:.4f} | {d(r, 'ndcg_rel@20')} | "
            f"{r['recall_rel@20']['mean']:.4f} | {d(r, 'recall_rel@20')} | "
            f"{r['ndcg_all@20']['mean']:.4f} | {d(r, 'ndcg_all@20')} | "
            f"{r['recall_all@20']['mean']:.4f} | {d(r, 'recall_all@20')} | "
            f"{100 * r['anim_share@48']:.1f} % ({100 * r['anim_profile']:.1f} %) | "
            f"{r['pop_median@20']:.0f} |"
        )


# --- TMDB rating at release ----------------------------------------------------------------------

YEAR_BINS = ((0, 1999), (2000, 2009), (2010, 2014), (2015, 2018), (2019, 2020), (2021, 2021),
             (2022, 2022), (2023, 2023))  # fmt: skip
VOTE_BINS = ((50, 499), (500, 1_999), (2_000, 9_999), (10_000, 10**9))


def cmd_tmdb_age() -> dict:
    from config import PROCESSED
    from quality import catalog_quality, tmdb_bayes

    meta = json.loads((WEB_DATA / "model-meta.json").read_text(encoding="utf-8"))["quality"]
    t = meta["tmdb"]
    t = t | t.get("catalog_line", {})  # the R6b line (catalogue-wide), the reference of § 5a
    cat = pl.read_parquet(
        ev.CATALOG_PARQUET, columns=["item_idx", "ml_rating_count", "ml_mean_rating"]
    ).sort("item_idx")
    q_cat, _ = catalog_quality(cat["ml_rating_count"].to_numpy(), cat["ml_mean_rating"].to_numpy())
    films = pl.read_parquet(PROCESSED / "tmdb_films.parquet")
    fiche = films.filter("in_catalog").select("item_idx", "year", "vote_average", "vote_count")
    j = cat.join(fiche, on="item_idx", how="inner").sort("item_idx")
    idx = j["item_idx"].to_numpy()
    votes = j["vote_count"].cast(pl.Float64).to_numpy()
    avg = j["vote_average"].cast(pl.Float64).to_numpy()
    year = j["year"].fill_null(0).to_numpy()
    n_ml = j["ml_rating_count"].to_numpy()
    tb = tmdb_bayes(avg, votes, t["prior_rating"], t["prior_votes"])
    pred = t["slope"] * tb + t["intercept"]
    resid = q_cat[idx] - pred
    ok = np.isfinite(avg) & (votes >= 50) & (n_ml >= 20)
    out: dict = {"line": t, "by_year": [], "by_votes_recent": [], "estimated": {}}
    print("résidu q MovieLens − droite TMDB (négatif = TMDB surestime), films du catalogue :")
    print("| années | films | résidu moyen | médian | note TMDB moy. | q moy. |")
    print("|---|---|---|---|---|---|")
    for lo, hi in YEAR_BINS:
        s = ok & (year >= lo) & (year <= hi)
        row = {
            "years": [lo, hi],
            "films": int(s.sum()),
            "resid_mean": float(resid[s].mean()),
            "resid_median": float(np.median(resid[s])),
            "tmdb_mean": float(avg[s].mean()),
            "q_mean": float(q_cat[idx][s].mean()),
        }
        out["by_year"].append(row)
        print(
            f"| {lo}-{hi} | {row['films']} | {row['resid_mean']:+.3f} | "
            f"{row['resid_median']:+.3f} | {row['tmdb_mean']:.2f} | {row['q_mean']:+.3f} |"
        )
    print("\npar votes TMDB, 2019-2023 contre 2010-2018 :")
    print("| votes | films 2019-23 | résidu | films 2010-18 | résidu |")
    print("|---|---|---|---|---|")
    for lo, hi in VOTE_BINS:
        sv = ok & (votes >= lo) & (votes <= hi)
        a = sv & (year >= 2019)
        b = sv & (year >= 2010) & (year <= 2018)
        row = {
            "votes": [lo, hi],
            "recent_films": int(a.sum()),
            "recent_resid": float(resid[a].mean()) if a.any() else None,
            "older_films": int(b.sum()),
            "older_resid": float(resid[b].mean()) if b.any() else None,
        }
        out["by_votes_recent"].append(row)
        print(
            f"| {lo}-{hi} | {row['recent_films']} | {row['recent_resid']:+.3f} | "
            f"{row['older_films']} | {row['older_resid']:+.3f} |"
        )
    # estimated films: TMDB rating and q against the catalogue films of the same votes
    est = pl.read_parquet(PROCESSED / "estimated_films.parquet")
    e_votes = est["vote_count"].cast(pl.Float64).to_numpy()
    e_avg = est["vote_average"].cast(pl.Float64).to_numpy()
    e_q = (
        t["slope"] * tmdb_bayes(e_avg, e_votes, t["prior_rating"], t["prior_votes"])
        + t["intercept"]
    )
    e_rec = e_votes >= 500
    rec_cat = q_cat  # all trained films (percentiles of the site's q)
    thr = {p: float(np.percentile(rec_cat, p)) for p in (95, 98, 99)}
    out["estimated"] = {
        "n": int(len(e_q)),
        "recommendable": int(e_rec.sum()),
        "q_thresholds_site": thr,
        "above": {p: int((e_q[e_rec] > thr[p]).sum()) for p in thr},
        "tmdb_mean_recommendable": float(e_avg[e_rec].mean()),
        "q_mean_recommendable": float(e_q[e_rec].mean()),
    }
    print("\nfilms estimés recommandables :", out["estimated"])
    print("| votes | estimés : note TMDB moy. | catalogue 2010-2018 : note TMDB moy. |")
    print("|---|---|---|")
    for lo, hi in VOTE_BINS[1:]:
        se = e_rec & (e_votes >= lo) & (e_votes <= hi)
        sc = ok & (votes >= lo) & (votes <= hi) & (year >= 2010) & (year <= 2018)
        print(
            f"| {lo}-{hi} | {e_avg[se].mean() if se.any() else float('nan'):.2f} ({int(se.sum())})"
            f" | {avg[sc].mean():.2f} ({int(sc.sum())}) |"
        )
    # stronger shrinkage of the estimated films' q (candidates)
    recent = ok & (year >= 2019)
    a2, b2 = np.polyfit(tb[recent], q_cat[idx][recent], 1)
    off = {}
    for lo, hi in VOTE_BINS:
        sv = recent & (votes >= lo) & (votes <= hi)
        off[(lo, hi)] = float(resid[sv].mean()) if sv.sum() >= 20 else 0.0

    def offset(v):
        o = np.zeros_like(v)
        for (lo, hi), d in off.items():
            o[(v >= lo) & (v <= hi)] = min(d, 0.0)
        return o

    alts = {
        "actuelle": e_q,
        "prior 1 000 votes": t["slope"] * tmdb_bayes(e_avg, e_votes, t["prior_rating"], 1000)
        + t["intercept"],
        "droite 2019-2023": a2 * tmdb_bayes(e_avg, e_votes, t["prior_rating"], t["prior_votes"])
        + b2,
        "décalage par votes (2019-2023)": e_q + offset(e_votes),
    }
    # check of each alternative on the 2019-2023 catalogue films (they have a true q)
    out["alternatives"] = {}
    print(
        "\n| q des estimés | moyenne (recommandables) | > c95 | > c98 | > c99 | "
        "résidu sur le catalogue 2019-23 (≥ 2 000 votes) |"
    )
    print("|---|---|---|---|---|---|")
    big = recent & (votes >= 2000)
    for name, qe in alts.items():
        if name == "actuelle":
            qc = pred
        elif name == "prior 1 000 votes":
            qc = t["slope"] * tmdb_bayes(avg, votes, t["prior_rating"], 1000) + t["intercept"]
        elif name == "droite 2019-2023":
            qc = a2 * tb + b2
        else:
            qc = pred + offset(votes)
        r = {
            "q_mean": float(qe[e_rec].mean()),
            "above": {p: int((qe[e_rec] > thr[p]).sum()) for p in thr},
            "resid_recent_big": float((q_cat[idx] - qc)[big].mean()),
        }
        out["alternatives"][name] = r
        print(
            f"| {name} | {r['q_mean']:+.3f} | {r['above'][95]} | {r['above'][98]} | "
            f"{r['above'][99]} | {r['resid_recent_big']:+.3f} |"
        )
    out["offsets"] = {f"{lo}-{hi}": d for (lo, hi), d in off.items()}
    out["line_recent"] = {"slope": float(a2), "intercept": float(b2)}
    print("décalages :", out["offsets"], "droite 2019-2023 :", out["line_recent"])
    path = OUT_DIR / "tmdb_age.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print("->", path)
    # the alternatives per tmdb_id, for web/scripts/tuning-report.ts (ignored folder)
    tmdb_ids = est["tmdb_id"].to_list()
    dump = {
        name: {str(k): round(float(v), 4) for k, v in zip(tmdb_ids, qe, strict=True)}
        for name, qe in alts.items()
    }
    alt_path = WEB_DATA.parent.parent / "test-data" / "estimated_q_alternatives.json"
    alt_path.write_text(json.dumps(dump, ensure_ascii=False), encoding="utf-8")
    print("->", alt_path)
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sweep")
    s.add_argument("--tag", default="")
    s.add_argument("--users", type=int, default=0, help="first N users only (quick check)")
    sub.add_parser("tmdb-age")
    args = p.parse_args()
    if args.cmd == "sweep":
        cmd_sweep(args.tag, args.users)
    else:
        cmd_tmdb_age()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
