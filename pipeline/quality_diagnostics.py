"""Diagnostics of step 6c (result quality), before any decision (docs/etape-6c-qualite.md).

    uv run python quality_diagnostics.py foldin     # disliked films out of the fold-in (validation)
    uv run python quality_diagnostics.py versions   # films that are probably another cut of a film

`foldin`: the step 2 protocol (docs/etape-2-modele.md, D1-D3), **validation split only**, config A,
V3 caps on training-user rating counts (as in `slider_variants.py test`). Variants: the fold-in
films whose percentile (computed on the whole fold-in, D2) is below a threshold are removed from
the fold-in signal; they stay "seen" (never recommended). Relevance is unchanged (held-out rating
>= median of the whole fold-in).

`versions`: catalogue-only heuristics (no user data): version words in the title, or the same
director and a very close normalised title. Results in data/processed/results/quality/ (ignored).
"""

from __future__ import annotations

import os

os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import argparse  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
from difflib import SequenceMatcher  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
import scipy.sparse as sp  # noqa: E402

import evaluate as ev  # noqa: E402
import sweep_slider as sw  # noqa: E402
from config import RESULTS_DIR, TOP_K  # noqa: E402
from models import als  # noqa: E402
from titles import normalize_title  # noqa: E402

OUT_DIR = RESULTS_DIR / "quality"
CAPS = (math.inf, 2_000, 500)
THRESHOLDS = (None, 0.1, 0.2, 0.3, 0.4, 0.5)


class DroppedFoldInModel:
    """Config A, with the fold-in films of percentile < threshold left out of the signal."""

    def __init__(self, base: als.ALSModel, threshold: float | None):
        self.base = base
        self.threshold = threshold

    def scores(self, foldin: sp.csr_matrix) -> np.ndarray:
        b = self.base
        p = als.percentile_values(foldin)  # on the whole fold-in (D2)
        signal = p.copy()
        signal.data = (1.0 + b.beta * p.data).astype(np.float32)
        if self.threshold is not None:
            signal.data[p.data < self.threshold] = 0.0
            signal.eliminate_zeros()
        x = als.fold_in(b.Y, signal, regularization=b.regularization, alpha=b.alpha, yty=b.yty)
        return x.astype(np.float32) @ b.Y.T


def cmd_foldin() -> dict:
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    eval_set = ev.load_eval_set("val", catalog)
    base = sw.adapter("A", catalog)
    p_all = als.percentile_values(eval_set.foldin)
    rows = []
    for th in THRESHOLDS:
        model = DroppedFoldInModel(base, th)
        dropped = 0 if th is None else int((p_all.data < th).sum())
        lists = {cap: [] for cap in CAPS}
        for start in range(0, len(eval_set.user_ids), ev.BATCH_SIZE):
            batch = eval_set.foldin[start : start + ev.BATCH_SIZE]
            scores = model.scores(batch)
            for cap in CAPS:
                cand = catalog.recommendable & (counts <= cap)
                lists[cap].append(ev.top_k(scores.copy(), batch, cand, TOP_K))
        for cap in CAPS:
            ranked = np.vstack(lists[cap])
            met = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
            row = {
                "threshold": th,
                "cap": None if math.isinf(cap) else cap,
                "foldin_ratings_dropped": dropped,
                "foldin_ratings_total": int(eval_set.foldin.nnz),
                "ndcg@20": met["ndcg@20"],
                "recall@20": met["recall@20"],
                "recall_all@20": met["recall_all@20"],
                "pop_mediane@20": met["pop_mediane@20"]["mean"],
            }
            rows.append(row)
            print(
                f"seuil {th!s:>4} · cran {row['cap']!s:>5} · "
                f"NDCG@20 {met['ndcg@20']['mean']:.4f} ± {met['ndcg@20']['ci95']:.4f} · "
                f"Recall@20 {met['recall@20']['mean']:.4f} ± {met['recall@20']['ci95']:.4f} · "
                f"Recall_all@20 {met['recall_all@20']['mean']:.4f} · "
                f"retirées {dropped}/{eval_set.foldin.nnz}",
                flush=True,
            )
    out = {"split": "val", "config": "A", "caps": "training-user ml_rating_count", "rows": rows}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "foldin_dropped_val.json").write_text(json.dumps(out, indent=2) + "\n")
    return out


VERSION_WORDS = re.compile(
    r"director'?s'? cut|extended|redux|whole bloody affair|version longue|final cut|"
    r"theatrical|uncut|unrated|special edition|remaster|restored|re-?edit|recut|"
    r"international (?:version|cut)|ultimate (?:edition|cut)|integral|intégrale|"
    r"long version|alternate|producer'?s cut|television version|tv version",
    re.I,
)


# suffix words of a sequel (after the shorter title), and of an alternate cut
SEQUEL = re.compile(
    r"\b(?:[2-9]|1[0-9]|ii|iii|iv|v|vi|part|chapter|episode|vol|volume|returns|again|"
    r"revenge|strikes|rises|begins|reloaded|resurrection|next|new|too|to|deux|la suite)\b"
)
VERSION_SUFFIX = re.compile(r"\b(?:cut|version|edition|redux|affair)\b")


def cmd_versions() -> dict:
    cat = pl.read_parquet(
        ev.CATALOG_PARQUET,
        columns=["item_idx", "tmdb_title", "ml_title", "year", "tmdb_directors", "ml_rating_count"],
    ).sort("item_idx")
    rows = cat.to_dicts()

    # 1. version words in the TMDB or MovieLens title
    by_word = [
        r for r in rows if VERSION_WORDS.search(f"{r['tmdb_title'] or ''} | {r['ml_title'] or ''}")
    ]

    # 2. same director, very close normalised title (one contains the other, or ratio >= 0.85)
    def key(r):
        t = r["tmdb_title"] or r["ml_title"] or ""
        t = re.sub(r"\s*\(\d{4}\)\s*$", "", t)
        return normalize_title(t)

    by_director: dict[str, list[dict]] = {}
    for r in rows:
        for d in r["tmdb_directors"] or []:
            by_director.setdefault(d, []).append(r)
    pairs = set()
    for films in by_director.values():
        if len(films) < 2 or len(films) > 80:
            continue
        keys = [key(f) for f in films]
        for i in range(len(films)):
            for j in range(i + 1, len(films)):
                a, b = keys[i], keys[j]
                if len(a) < 4 or len(b) < 4:
                    continue
                close = a == b or a.startswith(b + " ") or b.startswith(a + " ")
                if not close and SequenceMatcher(None, a, b).ratio() >= 0.85:
                    close = True
                if close:
                    lo, hi = sorted((films[i]["item_idx"], films[j]["item_idx"]))
                    pairs.add((lo, hi))
    title = {r["item_idx"]: (r["tmdb_title"] or r["ml_title"], r["year"]) for r in rows}
    nkey = {r["item_idx"]: key(r) for r in rows}

    def classify(pair: tuple[int, int]) -> str:
        a, b = sorted(pair, key=lambda i: len(nkey[i]))
        short, long_ = nkey[a], nkey[b]
        if short == long_:
            return "same_title"
        if not long_.startswith(short + " "):
            return "similar"
        suffix = long_[len(short) + 1 :]
        if SEQUEL.search(suffix):
            return "sequel"
        if VERSION_WORDS.search(title[b][0] or "") or VERSION_SUFFIX.search(suffix):
            return "version"
        return "other_suffix"

    classes: dict[str, list[tuple[int, int]]] = {}
    for p in sorted(pairs):
        classes.setdefault(classify(p), []).append(p)

    def show(p):
        a, b = p
        return f"{title[a][0]} ({title[a][1]}) ~ {title[b][0]} ({title[b][1]})"

    out = {
        "n_catalog": len(rows),
        "version_words_in_title": {
            "n": len(by_word),
            "films": [f"{r['tmdb_title'] or r['ml_title']} ({r['year']})" for r in by_word],
        },
        "same_director_close_title": {
            "n_pairs": len(pairs),
            "by_class": {k: len(v) for k, v in sorted(classes.items())},
            "examples": {k: [show(p) for p in v[:12]] for k, v in sorted(classes.items())},
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "versions.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["foldin", "versions"])
    args = parser.parse_args()
    {"foldin": cmd_foldin, "versions": cmd_versions}[args.cmd]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
