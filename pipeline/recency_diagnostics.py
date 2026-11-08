"""Recent-film bias of the slider popularity: diagnostic and candidate corrections (after step 4).

Offline, read-only: popularity.bin is NOT modified.

    uv run python recency_diagnostics.py years                # ml/tmdb ratio per release year
    uv run python recency_diagnostics.py validation           # variants on validation (2 000 / 500)
    uv run python recency_diagnostics.py user <report.json>   # a user's top lists per variant

`user` replays the site computation (fold-in on exact + probable_variant, D4 exclusions,
popularity cap) with the exported files and prints the lists to the terminal only (personal data:
never written to a file).

Variants (every one is >= the current popularity: never makes a film more niche):
    current        max(ml, round(r_ref * tmdb)), r_ref = median ml/tmdb over 2010-2018 releases
    year_2019      + ml corrected by r_ref / r_year for releases >= 2019 (when r_year < r_ref)
    year_all       + the same correction for every release year with r_year < r_ref
    tmdb_recent    releases >= 2019: max(ml, round(r_mature * tmdb)), r_mature = median 2005-2012
    adopted        popularity.year_corrected (year_all with >= 50 movies per year, adopted)
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np
import polars as pl
import scipy.sparse as sp

import popularity as popm
from config import PROCESSED, WEB_DATA

VARIANTS = ("current", "year_2019", "year_all", "tmdb_recent", "adopted")
SHOWN_CAPS = (2000, 500)
RECENT_FROM = 2019
MATURE_YEARS = (2005, 2012)


def year_ratios(ml: np.ndarray, tmdb: np.ndarray, years: np.ndarray) -> dict[int, float]:
    """Median ml / tmdb per release year (both > 0)."""
    out = {}
    ok = (tmdb > 0) & (ml > 0) & ~np.isnan(years)
    for y in np.unique(years[ok]).astype(int):
        sel = ok & (years == y)
        if sel.sum() >= 20:
            out[int(y)] = float(np.median(ml[sel] / tmdb[sel]))
    return out


def ratio_between(ml, tmdb, years, lo: int, hi: int) -> float:
    sel = (years >= lo) & (years <= hi) & (tmdb > 0) & (ml > 0)
    return float(np.median(ml[sel] / tmdb[sel]))


def variant_popularity(name: str, ml: np.ndarray, tmdb: np.ndarray, years: np.ndarray):
    """Popularity for one variant; `ml` = MovieLens counts (complete or training-only)."""
    tmdb = np.nan_to_num(tmdb, nan=0.0)
    r_ref = popm.tmdb_ratio(ml, tmdb, years)
    current = popm.hybrid(ml, tmdb, r_ref)
    if name == "current":
        return current, {"r_ref": r_ref}
    if name == "adopted":  # the formula of popularity.py (year_all, >= 50 movies per year)
        return popm.year_corrected(ml, tmdb, years, r_ref)
    if name == "tmdb_recent":
        r_mature = ratio_between(ml, tmdb, years, *MATURE_YEARS)
        recent = np.nan_to_num(years, nan=0) >= RECENT_FROM
        alt = np.maximum(ml, np.rint(r_mature * tmdb)).astype(np.int64)
        return np.where(recent, np.maximum(current, alt), current), {
            "r_ref": r_ref,
            "r_mature": r_mature,
        }
    ratios = year_ratios(ml, tmdb, years)
    factor = np.ones(len(ml))
    for y, r_y in ratios.items():
        if r_y < r_ref and (name == "year_all" or y >= RECENT_FROM):
            factor[years == y] = r_ref / r_y
    corrected = np.rint(ml * factor).astype(np.int64)
    return np.maximum(current, corrected), {
        "r_ref": r_ref,
        "factors": {
            y: round(r_ref / r, 3)
            for y, r in ratios.items()
            if r < r_ref and (name == "year_all" or y >= RECENT_FROM)
        },
    }


def catalog_arrays():
    c = popm.catalog_columns(PROCESSED / "catalog.parquet")
    return c["ml_rating_count"], c["tmdb_vote_count"], c["year"]


# ---------------------------------------------------------------------------------- years


def cmd_years() -> None:
    ml, tmdb, years = catalog_arrays()
    ratios = year_ratios(ml, np.nan_to_num(tmdb), years)
    r_ref = popm.tmdb_ratio(ml, tmdb, years)
    n = len(ml)
    print(
        f"r_ref (2010-2018) = {r_ref:.4f} ; r_mature ({MATURE_YEARS[0]}-{MATURE_YEARS[1]}) = "
        f"{ratio_between(ml, np.nan_to_num(tmdb), years, *MATURE_YEARS):.4f}"
    )
    print("année  films  % catalogue  r médian  r_ref / r")
    for y in range(2005, 2024):
        k = int((years == y).sum())
        r = ratios.get(y, math.nan)
        print(f"{y}  {k:5d}  {100 * k / n:6.2f} %    {r:.4f}    {r_ref / r:.2f}")


# ----------------------------------------------------------------------------- validation


def cmd_validation(variants=VARIANTS) -> None:
    import evaluate as ev
    import sweep_slider as sw
    from slider_variants import v3_lists

    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    _, tmdb, years = catalog_arrays()
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    recent = np.nan_to_num(years, nan=0) >= 2017
    print("variante      plafond  NDCG@20  Recall@20  pop_med(entr.)  couverture  films >= 2017")
    for name in variants:
        pop, info = variant_popularity(name, counts.astype(np.int64), tmdb, years)
        lists = v3_lists(model, eval_set.foldin, catalog.recommendable, pop, pop, SHOWN_CAPS, 20)
        for cap, (ranked, *_rest) in lists.items():
            m = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
            print(
                f"{name:<13} {cap:>7}  {m['ndcg@20']['mean']:.5f}  {m['recall@20']['mean']:.5f}"
                f"   {m['pop_mediane@20']['mean']:>10.0f}     {m['couverture@20']:.4f}"
                f"     {100 * recent[ranked].mean():5.1f} %"
            )
        print(f"   ({json.dumps(info)})")


# ----------------------------------------------------------------------------------- user


def user_lists(report_path: str):
    import export as ex
    from models import als

    report = json.loads(open(report_path, encoding="utf-8").read())
    meta = json.loads((WEB_DATA / "model-meta.json").read_text())
    q, s = ex.read_embeddings(WEB_DATA / "embeddings.bin")
    Y = ex.dequantize(q, s).astype(np.float64)
    yty = ex.read_yty(WEB_DATA / "yty.bin", meta["dims"]).astype(np.float64)
    rec = np.ones(len(Y), dtype=bool)
    rec[meta["non_recommendable_item_idx"]] = False
    used = [e for e in report["entries"] if e["status"] in ("exact", "probable_variant")]
    # one film per item (the site keeps the most recent entry; reports keep one entry per film)
    items = np.array([e["match"]["item"] for e in used])
    ratings = np.array([e["rating"] for e in used], dtype=np.float32)
    R = sp.csr_matrix((ratings, (np.zeros(len(items), dtype=int), items)), shape=(1, len(Y)))
    signal = als.signal_values(R, meta["beta"])
    x = als.fold_in(Y, signal, regularization=meta["regularization"], alpha=meta["alpha"], yty=yty)[
        0
    ]
    scores = Y @ x
    seen = np.zeros(len(Y), dtype=bool)
    seen[items] = True
    for e in report["entries"]:  # D4 exclusions
        if e["status"] == "probable_fuzzy" and e["match"]:
            seen[e["match"]["item"]] = True
        if e["status"] == "ambiguous":
            for c in e["candidates"]:
                seen[c["item"]] = True
    return scores, seen, rec


def cmd_user(report_path: str) -> None:
    import export as ex

    ml, tmdb, years = catalog_arrays()
    titles = pl.read_parquet(
        PROCESSED / "catalog.parquet", columns=["item_idx", "tmdb_title", "ml_title"]
    ).sort("item_idx")
    title = [t or m for t, m in zip(titles["tmdb_title"], titles["ml_title"], strict=True)]
    scores, seen, rec = user_lists(report_path)
    file_pop = ex.read_popularity(WEB_DATA / "popularity.bin").astype(np.int64)
    current, _ = variant_popularity("current", ml, tmdb, years)
    assert np.array_equal(current, file_pop), "current variant != popularity.bin"
    pops = {name: variant_popularity(name, ml, tmdb, years)[0] for name in VARIANTS}
    for cap in SHOWN_CAPS:
        lists = {
            name: ex.top_under_cap(scores, seen, rec, pops[name].astype(np.uint32), cap, 20)
            for name in VARIANTS
        }
        print(f"\n=== plafond {cap} : films sortis en 2017 ou après dans la liste actuelle ===")
        print("film" + " " * 41 + "année     ml   tmdb  actuelle  year_2019  year_all  tmdb_recent")
        for i in lists["current"]:
            if years[i] >= 2017:
                votes = int(np.nan_to_num(tmdb[i]))
                p = {name: pops[name][i] for name in VARIANTS}
                print(
                    f"{title[i][:44]:<44} {int(years[i])} {ml[i]:6d} {votes:6d}"
                    f"  {p['current']:8d}  {p['year_2019']:9d}  {p['year_all']:8d}"
                    f"  {p['tmdb_recent']:11d}"
                )
        for name in VARIANTS:
            items = lists[name]
            n_recent = int((years[items] >= 2017).sum())
            gone = [title[i] for i in lists["current"] if i not in set(items)]
            print(
                f"\n[{name}] {n_recent}/20 films >= 2017"
                + (
                    f" ; sortis par rapport à « current » : {', '.join(gone)}"
                    if name != "current"
                    else ""
                )
            )
            for k, i in enumerate(items, 1):
                flag = "" if i in set(lists["current"]) else "  (nouveau)"
                print(
                    f"  {k:2d}. {title[i]} ({int(years[i]) if not np.isnan(years[i]) else '?'}) · "
                    f"{pops[name][i]} · score {scores[i]:.4f}{flag}"
                )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["years", "validation", "user"])
    parser.add_argument("report", nargs="?")
    parser.add_argument("--variants", nargs="*", default=list(VARIANTS))
    args = parser.parse_args()
    if args.cmd == "years":
        cmd_years()
    elif args.cmd == "validation":
        cmd_validation(args.variants)
    else:
        cmd_user(args.report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
