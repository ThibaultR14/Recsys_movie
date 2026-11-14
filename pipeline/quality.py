"""Quality term of the site (step 8, R6b; docs/etape-8-films-recents.md, D4 v0.6).

At each notch, before the pool and the genre calibration:

    score' = score / s_max + gamma * q

s_max = best model score among the user's candidates under the cap (1 if <= 0); pool = the 150
best candidates by score' (ties: item_idx), then the calibration on score' (as before on the
score). gamma = 0.1, chosen on the validation (`quality_term.py sweep`): the strongest value with
no measurable loss on the well-rated held-out films; the held-out measures « what one watches »,
not « what one loves », so it favours gamma = 0 by construction.

q, centred Bayesian mean, one value per item (catalog.json `quality`, int = round(1000 q)):
- trained films: q = (n m + K C) / (n + K) - C, n and m = number and mean of the MovieLens ratings
  (all users), C = mean of all the ratings of the catalogue, K = 50;
- estimated films (no MovieLens rating): q = a * t + b, t = TMDB Bayesian rating
  (v R + M R0) / (v + M), M = 200 votes, R0 = mean TMDB rating of the catalogue films with >= 50
  votes; (a, b) = least squares of q on t over the catalogue films with >= 50 TMDB votes and
  >= 20 MovieLens ratings **released from RECENT_FIT_FROM (2019) on** (step 8, R6e): the TMDB
  rating of a recent, much-voted film is inflated at release (about 0.28 star too high at 2 000+
  votes, docs/etape-8-analyse-reglages.md § 5a); the line of the recent films halves that gap and
  keeps every estimated film under the classics threshold. The catalogue-wide line (R6b) stays in
  model-meta (`tmdb.catalog_line`), for the dev switch and the analysis. A badly received recent
  film gets a low q (replaces the penalty rho).

Classics bonus (step 8, R6e; product judgement: a film that almost everyone loved is a good
recommendation even far from one's habits), added to score' for the trained films only (their q
is a MovieLens consensus; an estimated film's q is a TMDB estimate):

    score' += classics_gamma * max(0, q - q_99)

q_99 = percentile CLASSICS_PERCENTILE of q (nearest rank) over the trained recommendable films.
γc = 0.5: 12 Angry Men 42nd -> 1st (export A), NDCG@20 at ∞ -1.0 % on the validation (criterion
<= -2 %). Set to 0 if the « les classiques qui te manquent » row is built (step 9).
"""

from __future__ import annotations

import numpy as np
import polars as pl

GAMMA = 0.1
SHRINK = 50  # fictitious ratings K
SCALE = 1000  # catalog.json stores round(SCALE * q)
TMDB_PRIOR_VOTES = 200
FIT_MIN_TMDB_VOTES = 50
FIT_MIN_ML_RATINGS = 20
RECENT_FIT_FROM = 2019  # the estimated films' line: catalogue films released from this year on
CLASSICS_GAMMA = 0.5
CLASSICS_PERCENTILE = 99


def catalog_quality(counts, means, shrink: float = SHRINK) -> tuple[np.ndarray, float]:
    n = np.asarray(counts, dtype=np.float64)
    mean = np.nan_to_num(np.asarray(means, dtype=np.float64), nan=0.0)
    c = float((n * mean).sum() / n.sum())
    return (n * mean + shrink * c) / (n + shrink) - c, c


def tmdb_bayes(average, votes, prior: float, m: float = TMDB_PRIOR_VOTES) -> np.ndarray:
    r = np.nan_to_num(np.asarray(average, dtype=np.float64), nan=prior)
    v = np.asarray(votes, dtype=np.float64)
    return (v * r + m * prior) / (v + m)


def site_quality(
    ml_counts: np.ndarray,
    ml_means: np.ndarray,
    cat_tmdb_avg: np.ndarray,
    cat_tmdb_votes: np.ndarray,
    est_tmdb_avg: np.ndarray,
    est_tmdb_votes: np.ndarray,
    cat_years: np.ndarray | None = None,
) -> tuple[np.ndarray, dict]:
    """int quality per item (trained films, then estimated films) and the parameters.
    `cat_years`: release year of the catalogue films (None: catalogue-wide line, R6b)."""
    q_cat, c = catalog_quality(ml_counts, ml_means)
    avg = np.asarray(cat_tmdb_avg, dtype=np.float64)
    votes = np.nan_to_num(np.asarray(cat_tmdb_votes, dtype=np.float64), nan=0.0)
    known = np.isfinite(avg) & (votes >= FIT_MIN_TMDB_VOTES)
    prior = float(avg[known].mean())
    t_cat = tmdb_bayes(avg, votes, prior)
    ok = known & (np.asarray(ml_counts) >= FIT_MIN_ML_RATINGS)
    a0, b0 = np.polyfit(t_cat[ok], q_cat[ok], 1)  # catalogue-wide line (R6b)
    fit = ok
    if cat_years is not None:
        years = np.nan_to_num(np.asarray(cat_years, dtype=np.float64), nan=0.0)
        fit = ok & (years >= RECENT_FIT_FROM)
    a, b = np.polyfit(t_cat[fit], q_cat[fit], 1)
    corr = float(np.corrcoef(t_cat[fit], q_cat[fit])[0, 1])
    t_est = tmdb_bayes(est_tmdb_avg, est_tmdb_votes, prior)
    q_est = a * t_est + b
    q = np.concatenate([q_cat, q_est])
    ints = np.rint(SCALE * q).astype(np.int64)
    info = {
        "gamma": GAMMA,
        "shrink": SHRINK,
        "scale": SCALE,
        "C": round(c, 6),
        "tmdb": {
            "prior_votes": TMDB_PRIOR_VOTES,
            "prior_rating": round(prior, 6),
            "slope": round(float(a), 6),
            "intercept": round(float(b), 6),
            "corr": round(corr, 4),
            "fit_films": int(fit.sum()),
            "fit_from_year": None if cat_years is None else RECENT_FIT_FROM,
            "catalog_line": {"slope": round(float(a0), 6), "intercept": round(float(b0), 6)},
        },
        "q_range": [int(ints.min()), int(ints.max())],
    }
    return ints, info


def classics_threshold(
    quality_int: np.ndarray, recommendable: np.ndarray, n_trained: int, percentile: float
) -> float:
    """q at `percentile` (nearest rank) over the trained recommendable films; same as the
    TypeScript `qualityPercentile`."""
    v = np.sort(quality_int[:n_trained][recommendable[:n_trained]].astype(np.float64) / SCALE)
    k = int(np.ceil(percentile / 100 * len(v))) - 1
    return float(v[min(len(v) - 1, max(0, k))])


def classics_info(quality_int: np.ndarray, recommendable: np.ndarray, n_trained: int) -> dict:
    """model-meta.json `quality.classics` (production)."""
    thr = classics_threshold(quality_int, recommendable, n_trained, CLASSICS_PERCENTILE)
    above = quality_int[:n_trained][recommendable[:n_trained]] / SCALE > thr
    return {
        "gamma": CLASSICS_GAMMA,
        "percentile": CLASSICS_PERCENTILE,
        "threshold": thr,
        "films_above": int(above.sum()),
        "trained_only": True,
        "rule": "score' += gamma * max(0, q - threshold) for the trained films (item_idx < "
        "n_trained) only; threshold = q at `percentile` (nearest rank) over the trained "
        "recommendable films",
        "why": "product judgement (step 8, R6e): a film almost everyone loved is a good "
        "recommendation even far from one's habits; NDCG@20 at the top notch -1.0 % on the "
        "validation (criterion <= -2 %); set gamma to 0 if a « classics » row is built",
    }


def adjusted_scores(
    scores: np.ndarray,
    smax: float,
    quality_int: np.ndarray,
    gamma: float,
    classics: dict | None = None,
    items: np.ndarray | None = None,
):
    """score / s_max + gamma * q (+ the classics bonus of the items < classics["max_item"]),
    q = quality_int / SCALE; same operations as the TypeScript."""
    d = smax if smax > 0 else 1.0
    q = quality_int.astype(np.float64) / SCALE
    adj = scores / d + gamma * q
    if classics is not None and classics["gamma"] != 0:
        bonus = classics["gamma"] * np.maximum(0.0, q - classics["threshold"])
        adj = adj + np.where(np.asarray(items) < classics["max_item"], bonus, 0.0)
    return adj


def quality_meta(info: dict, classics: dict | None = None) -> dict:
    extra = {} if classics is None else {"classics": classics}
    return (
        info
        | extra
        | {
            "formula": "score' = score / s_max + gamma * q at each notch, before the pool and the "
            "calibration; s_max = best score among the candidates under the cap (1 if <= 0); "
            "q = catalog.json quality / scale",
            "q_trained": "(n m + shrink C) / (n + shrink) - C, MovieLens ratings of all users",
            "q_estimated": "slope * t + intercept, t = (v R + prior_votes prior_rating) / "
            "(v + prior_votes), TMDB rating R and votes v; line fitted on the catalogue films "
            "released from fit_from_year on (their TMDB rating is inflated at release); "
            "catalog_line = the catalogue-wide line (R6b), kept for comparison",
            "why": "the held-out measures what one watches, not what one loves, so it favours "
            "gamma = 0; gamma = strongest value with no measurable loss on the well-rated films",
        }
    )


def site_quality_from_files(cat: pl.DataFrame, films: pl.DataFrame, est: pl.DataFrame | None):
    """cat: catalogue frame in item order (ml_rating_count, ml_mean_rating, tmdb_id);
    films: tmdb_films.parquet; est: estimated_films.parquet (or None)."""
    fiche = films.filter("in_catalog").select("item_idx", "year", "vote_average", "vote_count")
    joined = (
        cat.select("item_idx", "ml_rating_count", "ml_mean_rating")
        .join(fiche, on="item_idx", how="left")
        .sort("item_idx")
    )
    e_avg = np.array([], dtype=np.float64) if est is None else est["vote_average"].to_numpy()
    e_votes = np.array([], dtype=np.float64) if est is None else est["vote_count"].to_numpy()
    return site_quality(
        joined["ml_rating_count"].to_numpy(),
        joined["ml_mean_rating"].to_numpy(),
        joined["vote_average"].cast(pl.Float64).to_numpy(),
        joined["vote_count"].cast(pl.Float64).to_numpy(),
        e_avg.astype(np.float64),
        e_votes.astype(np.float64),
        joined["year"].cast(pl.Float64).to_numpy(),
    )
