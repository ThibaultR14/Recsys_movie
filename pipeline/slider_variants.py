"""C4 complement: three slider variants, configs A and B, popularity = ml_rating_count.

Validation only (the test split is only used to show titles for 3 users).

    V1  D5 as is (s standardised over all candidates, score = s - lam * z), lam >= 0, extended.
    V2  re-rank the model's top K candidates: s standardised inside the top K, score = s - lam * z
        (z = standardised log(1 + pop) over recommendable movies, as in D5); K = 500, 200, 1000.
    V3  popularity cap: candidates with count <= cap, ranked by model score.

Popularity = training-user ml_rating_count (no leakage, D3), for the slider and for the metrics.
Extra metric: regularity = interquartile range, across users, of their list's median popularity.

Subcommands (from `pipeline/`):
    uv run python slider_variants.py sweep        # -> results/slider/variants_val_<config>.json
    uv run python slider_variants.py composition  # -> results/slider/variants_composition_val.json
    uv run python slider_variants.py qualitative  # -> results/slider/variants_qualitative_test.json
    uv run python slider_variants.py figure       # -> docs/figures/etape2-curseur-variantes.png
    uv run python slider_variants.py test         # A + V3 on test (once) -> results/slider/v3_A_*
    uv run python slider_variants.py test-figure  # -> docs/figures/etape2-curseur-test.png
    uv run python slider_variants.py popularity-check  # hybrid popularity, validation
    uv run python slider_variants.py annex        # -> docs/etape-2-curseur-qualitatif.md
"""

from __future__ import annotations

import os

os.environ["OPENBLAS_NUM_THREADS"] = "1"  # before NumPy (implicit, if B must be retrained)
os.environ["MKL_NUM_THREADS"] = "1"

import argparse  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from datetime import UTC, datetime  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402

import evaluate as ev  # noqa: E402
import slider  # noqa: E402
import sweep_slider as sw  # noqa: E402
from config import REPO_ROOT, RESULTS_DIR, SPLIT_DIR, TOP_K  # noqa: E402

V1_LAMBDAS = (0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30)
V2_LAMBDAS = (0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 30)
V2_POOLS = (200, 500, 1000)
V2_MAIN_POOL = 500
V3_CAPS = (math.inf, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200)
STOP_POP = 1_000  # sweeps are reported up to the first setting with pop_mediane@20 < 1 000
QUALI_TARGETS = (10_000, 2_000, 500)
QUALI_JSON = sw.SLIDER_DIR / "variants_qualitative_test.json"
ANNEX = REPO_ROOT / "docs" / "etape-2-curseur-qualitatif.md"


def settings() -> list[dict]:
    """All (variant, parameter) settings, in report order."""
    out = [{"variant": "V1", "lambda": lam} for lam in V1_LAMBDAS]
    out += [{"variant": "V2", "K": k, "lambda": lam} for k in V2_POOLS for lam in V2_LAMBDAS]
    out += [{"variant": "V3", "cap": cap} for cap in V3_CAPS]
    return out


def setting_label(st: dict) -> str:
    if st["variant"] == "V1":
        return f"V1 λ={st['lambda']:g}"
    if st["variant"] == "V2":
        return f"V2 K={st['K']} λ={st['lambda']:g}"
    return f"V3 plafond={'∞' if math.isinf(st['cap']) else f'{st["cap"]:g}'}"


def rank_all(model, foldin, recommendable, counts, z, sts, k) -> list[np.ndarray]:
    """Top k per user (foldin row order) for every setting in `sts`."""
    parts: list[list[np.ndarray]] = [[] for _ in sts]
    for start in range(0, foldin.shape[0], ev.BATCH_SIZE):
        batch = foldin[start : start + ev.BATCH_SIZE]
        scores = model.scores(batch)
        mask = slider.candidate_mask(batch, recommendable)
        std_all = None
        pools: dict[int, tuple[np.ndarray, np.ndarray]] = {}
        for i, st in enumerate(sts):
            if st["variant"] == "V1":
                if std_all is None:
                    std_all = slider.standardize_rows(scores, mask)
                ranked = ev.top_k(slider.rerank(std_all, z, st["lambda"]), batch, recommendable, k)
            elif st["variant"] == "V2":
                if st["K"] not in pools:
                    idx, sc = slider.top_pool(scores, mask, st["K"])
                    pools[st["K"]] = (idx, slider.standardize_pool(sc))
                idx, s = pools[st["K"]]
                ranked = slider.rerank_pool(idx, s, z, st["lambda"], k)
            else:
                cand = recommendable & (counts <= st["cap"])
                ranked = ev.top_k(scores.copy(), batch, cand, k)
            parts[i].append(ranked)
    return [np.vstack(p) for p in parts]


def cmd_sweep() -> None:
    sw.SLIDER_DIR.mkdir(parents=True, exist_ok=True)
    catalog = ev.load_catalog()
    eval_set = ev.load_eval_set("val", catalog)
    counts = ev.train_counts(catalog)
    z = slider.popularity_z(counts.astype(np.float64), catalog.recommendable)
    manifest = json.loads((SPLIT_DIR / "manifest.json").read_text())
    sts = settings()
    for name, cfg in sw.CONFIGS.items():
        t0 = time.perf_counter()
        ranked = rank_all(
            sw.adapter(name, catalog), eval_set.foldin, catalog.recommendable, counts, z, sts, TOP_K
        )
        print(f"{name}: {len(sts)} settings ranked in {time.perf_counter() - t0:.0f}s", flush=True)
        rows = []
        for st, r in zip(sts, ranked, strict=True):
            metrics = ev.compute_metrics(r, eval_set, counts, catalog.recommendable)
            metrics["regularite_pop@20"] = slider.popularity_iqr(r, counts, TOP_K)
            rows.append({**json_setting(st), "metrics": metrics})
            m = metrics
            print(
                f"  {setting_label(st):<22} ndcg {m['ndcg@20']['mean']:.5f} "
                f"popmed {m['pop_mediane@20']['mean']:>8.0f} "
                f"iqr {m['regularite_pop@20']['iqr']:>8.0f}",
                flush=True,
            )
        out = {
            "config_name": name,
            "config": cfg,
            "split": "val",
            "k": TOP_K,
            "popularity": "ml_rating_count (training users only), slider and metrics",
            "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "split_sha256": manifest["sha256"],
            "n_users": len(eval_set.user_ids),
            "settings": rows,
        }
        path = sweep_path(name)
        path.write_text(json.dumps(out, indent=2) + "\n")
        print(f"-> {path}", flush=True)


def sweep_path(name: str):
    return sw.SLIDER_DIR / f"variants_val_{name}.json"


def json_setting(st: dict) -> dict:
    """JSON-safe copy of a setting (cap = infinity -> null)."""
    return {k: (None if isinstance(v, float) and math.isinf(v) else v) for k, v in st.items()}


def load_sweep(name: str) -> list[dict]:
    rows = json.loads(sweep_path(name).read_text())["settings"]
    for r in rows:
        if r["variant"] == "V3" and r.get("cap") is None:
            r["cap"] = math.inf
    return rows


def curve(rows: list[dict], variant: str, pool: int | None = None) -> list[dict]:
    """Rows of one curve, in sweep order (λ sweeps cut after the first pop < STOP_POP)."""
    out = []
    for r in rows:
        if r["variant"] != variant or (variant == "V2" and r["K"] != pool):
            continue
        out.append(r)
        # λ sweeps stop at the first setting below STOP_POP; V3 shows its whole list of caps
        if variant != "V3" and r["metrics"]["pop_mediane@20"]["mean"] < STOP_POP:
            break
    return out


def pick_for_targets(rows: list[dict]) -> dict[int, dict]:
    """Setting whose validation pop_mediane@20 is closest (log scale) to each target."""
    out = {}
    for target in QUALI_TARGETS:
        out[target] = min(
            rows, key=lambda r: abs(math.log(r["metrics"]["pop_mediane@20"]["mean"] / target))
        )
    return out


def chosen_settings(name: str) -> list[tuple[str, int, dict, float]]:
    """(variant, target, setting, validation pop_mediane@20) for V1, V2 (K = 500) and V3."""
    sweep = load_sweep(name)
    chosen = []
    for variant, pool in (("V1", None), ("V2", V2_MAIN_POOL), ("V3", None)):
        rows_v = [r for r in sweep if r["variant"] == variant and (pool is None or r["K"] == pool)]
        for target, r in pick_for_targets(rows_v).items():
            st = {key: r[key] for key in ("variant", "lambda", "K", "cap") if key in r}
            if st.get("cap", 0) is None:
                st["cap"] = math.inf
            chosen.append((variant, target, st, r["metrics"]["pop_mediane@20"]["mean"]))
    return chosen


COMPOSITION_BINS = {"part_plus_de_10000": (10_000, math.inf), "part_1001_10000": (1_000, 10_000)}
COMPOSITION_BINS |= {"part_201_1000": (200, 1_000), "part_200_ou_moins": (-1, 200)}


def cmd_composition() -> None:
    """Composition of the top-20 lists (share of movies per popularity band) at the chosen settings.

    pop_mediane@20 hides mixed lists (a few very popular movies + many obscure ones): this shows
    them. Validation, training-user counts.
    """
    catalog = ev.load_catalog()
    eval_set = ev.load_eval_set("val", catalog)
    counts = ev.train_counts(catalog)
    z = slider.popularity_z(counts.astype(np.float64), catalog.recommendable)
    out = {"split": "val", "created_at": datetime.now(UTC).isoformat(timespec="seconds")}
    for name in sw.CONFIGS:
        chosen = chosen_settings(name)
        ranked = rank_all(
            sw.adapter(name, catalog),
            eval_set.foldin,
            catalog.recommendable,
            counts,
            z,
            [c[2] for c in chosen],
            TOP_K,
        )
        out[name] = []
        for (variant, target, st, val_pop), r in zip(chosen, ranked, strict=True):
            c = counts[r]
            row = {"variant": variant, "target": target, "label": setting_label(st)}
            row |= {"pop_mediane@20": val_pop, "setting": json_setting(st)}
            for key, (lo, hi) in COMPOSITION_BINS.items():
                row[key] = float(((c > lo) & (c <= hi)).mean())
            row["n_listes_identiques_max"] = int(np.unique(r, axis=0, return_counts=True)[1].max())
            out[name].append(row)
            print(
                name,
                row["label"],
                {k: round(v, 3) for k, v in row.items() if "part" in k},
                "max identical lists:",
                row["n_listes_identiques_max"],
                flush=True,
            )
    path = sw.SLIDER_DIR / "variants_composition_val.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"-> {path}")


def cmd_qualitative() -> None:
    catalog = ev.load_catalog()
    cat = sw.catalog_frame()
    eval_set = ev.load_eval_set("test", catalog)
    counts = ev.train_counts(catalog)
    z = slider.popularity_z(counts.astype(np.float64), catalog.recommendable)
    users = sw.pick_users(eval_set, counts)  # same 3 users as the first C4 check
    rows = np.array(list(users.values()))
    foldin = eval_set.foldin[rows]
    out = {
        "split": "test",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "targets": QUALI_TARGETS,
        "users": {label: int(eval_set.user_ids[r]) for label, r in users.items()},
        "lists": {},
    }
    for name in sw.CONFIGS:
        chosen = chosen_settings(name)
        ranked = rank_all(
            sw.adapter(name, catalog),
            foldin,
            catalog.recommendable,
            counts,
            z,
            [c[2] for c in chosen],
            sw.QUALI_TOP,
        )
        out["lists"][name] = [
            {
                "variant": variant,
                "target": target,
                "setting": json_setting(st),
                "label": setting_label(st),
                "val_pop_mediane@20": val_pop,
                "users": {label: sw.describe(r[j], cat, counts) for j, label in enumerate(users)},
            }
            for (variant, target, st, val_pop), r in zip(chosen, ranked, strict=True)
        ]
    QUALI_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"-> {QUALI_JSON}")


def cmd_figure() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    colors = {"A": "#1f4e79", "B": "#a93226"}
    lines = {"V1": ("-", "o"), "V2": ("--", "s"), "V3": (":", "^")}
    names = {"V1": "V1 (D5 prolongé)", "V2": f"V2 (top {V2_MAIN_POOL})", "V3": "V3 (plafond)"}
    refs = {
        "populaire": (RESULTS_DIR / "popular_val.json", "k", "^"),
        "hasard": (RESULTS_DIR / "random_val.json", "grey", "v"),
        "EASE (λ = 0)": (RESULTS_DIR / "ease" / "ease_b1_l10000_val.json", "#2e8b57", "*"),
    }
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6.2))
    for name in sw.CONFIGS:
        rows = load_sweep(name)
        for v, (ls, marker) in lines.items():
            c = curve(rows, v, V2_MAIN_POOL if v == "V2" else None)
            x = [r["metrics"]["pop_mediane@20"]["mean"] for r in c]
            ax1.plot(
                x,
                [r["metrics"]["ndcg@20"]["mean"] for r in c],
                ls=ls,
                marker=marker,
                ms=4,
                lw=1.5,
                color=colors[name],
                label=f"ALS {name} · {names[v]}",
            )
            ax2.plot(
                x,
                # IQR = 0 (V1, high λ: same obscure movies for everyone) cannot be shown on log y
                [r["metrics"]["regularite_pop@20"]["iqr"] or math.nan for r in c],
                ls=ls,
                marker=marker,
                ms=4,
                lw=1.5,
                color=colors[name],
                label=f"ALS {name} · {names[v]}",
            )
    for label, (path, color, marker) in refs.items():
        r = json.loads(path.read_text())["metrics"]
        ax1.scatter(
            r["pop_mediane@20"]["mean"],
            r["ndcg@20"]["mean"],
            color=color,
            marker=marker,
            s=140 if marker == "*" else 60,
            zorder=5,
            label=label,
        )
    for ax in (ax1, ax2):
        ax.set_xscale("log")
        ax.invert_xaxis()
        ax.grid(True, which="both", alpha=0.3)
        ax.set_xlabel("pop_mediane@20 (notes d'entraînement, log ; ← connu · pépite →)")
        for t in QUALI_TARGETS:
            ax.axvline(t, color="grey", lw=0.6, ls="-.")
    ax1.set_ylabel("NDCG@20")
    ax1.set_title("NDCG@20 vs popularité de la liste (comparer à popularité égale)")
    ax2.set_yscale("log")
    ax2.set_ylabel("écart interquartile entre utilisateurs de la pop. médiane de leur liste")
    ax2.set_title("Régularité (plus bas = même effet pour tous)")
    ax2.text(
        0.02,
        0.02,
        "V1 : écart interquartile = 0 dès λ ≥ 5 (A) / λ ≥ 4 (B), non affiché :\n"
        "la moitié basse des listes = les mêmes films à ~15 notes pour tous.\n"
        "V3 : régulier par construction (plafond dur).",
        transform=ax2.transAxes,
        fontsize=8,
        va="bottom",
    )
    ax1.legend(fontsize=7.5, loc="upper right")
    fig.suptitle(
        "Étape 2 · C4 complément — trois variantes du curseur, validation (10 000 utilisateurs), "
        "popularité ml_rating_count ; traits verticaux : 10 000 / 2 000 / 500 notes",
        fontsize=10.5,
    )
    fig.tight_layout()
    path = sw.FIGURES_DIR / "etape2-curseur-variantes.png"
    fig.savefig(path, dpi=120)
    print(f"-> {path}")


def cmd_annex() -> None:
    q = json.loads(QUALI_JSON.read_text(encoding="utf-8"))
    old = json.loads((sw.SLIDER_DIR / "qualitative_test.json").read_text(encoding="utf-8"))
    profiles = old["profiles"]
    labels = {
        "pointu": "Profil 1 — le plus « pointu » (10e centile)",
        "median": "Profil 2 — médian (50e centile)",
        "grand_public": "Profil 3 — grand public (90e centile)",
    }

    def num(v):
        return f"{v:,.0f}".replace(",", " ")

    def fmt(f):
        return f"{f['title']} ({f['year']}, {num(f['ml_rating_count'])})"

    lines = [
        "# Étape 2 · C4 — contrôle qualitatif du curseur (version 2 : variantes V1 / V2 / V3)\n",
        "> Annexe de `docs/etape-2-modele.md` (section 5, C4 — complément). Générée par "
        "`uv run python slider_variants.py qualitative` puis `annex`, depuis "
        "`pipeline/data/processed/results/slider/variants_qualitative_test.json`. "
        "La version 1 (curseur D5 sur [−0,5 ; 2], deux sources) est dans l'historique git.\n",
        "**Utilisateurs** : les 3 mêmes utilisateurs de **test** que la version 1 (40 à 400 films "
        "en fold-in, les plus proches du 10e / 50e / 90e centile de la popularité médiane de leur "
        "fold-in), pour A et B. Affichage uniquement, aucune métrique.\n",
        "**Réglages** : pour chaque variante et chaque configuration, le réglage dont la "
        "`pop_mediane@20` de **validation** est la plus proche (échelle log) de 10 000, 2 000 et "
        "500 notes. Popularité = `ml_rating_count` des utilisateurs d'entraînement. Chaque film : "
        "titre TMDB, année, nombre total de notes MovieLens.\n",
    ]
    lines.append("\n## Réglages retenus\n")
    lines.append("| Config | Variante | ≈ 10 000 | ≈ 2 000 | ≈ 500 |")
    lines.append("|---|---|---|---|---|")
    for name, lists in q["lists"].items():
        for v in ("V1", "V2", "V3"):
            cells = [
                f"{x['label']} ({num(x['val_pop_mediane@20'])})" for x in lists if x["variant"] == v
            ]
            lines.append(f"| {name} | {v} | " + " | ".join(cells) + " |")
    lines.append("\nEntre parenthèses : `pop_mediane@20` obtenue sur la validation.\n")
    for label, title in labels.items():
        p = profiles[label]
        lines.append(f"\n## {title}\n")
        lines.append(
            f"`userId` {p['user_id']} · {p['n_foldin']} films en fold-in · popularité médiane du "
            f"fold-in : {num(p['foldin_median_train_count'])} notes\n"
        )
        lines.append(
            "Ses films les mieux notés : " + " ; ".join(fmt(f) for f in p["favourites"]) + "\n"
        )
        for v in ("V1", "V2", "V3"):
            lines.append(f"\n**{v}**\n")
            cols = [
                (name, x) for name, lists in q["lists"].items() for x in lists if x["variant"] == v
            ]
            lines.append(
                "| # | " + " | ".join(f"{n} · ≈ {num(x['target'])}" for n, x in cols) + " |"
            )
            lines.append("|---|" + "---|" * len(cols))
            for i in range(sw.QUALI_TOP):
                lines.append(
                    f"| {i + 1} | " + " | ".join(fmt(x["users"][label][i]) for _, x in cols) + " |"
                )
    ANNEX.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"-> {ANNEX}")


# --- Retained slider (D5 revised): A + V3, evaluated once on the test split -----------------------

V3_TEST_JSON = sw.SLIDER_DIR / "v3_A_test.json"
V3_DRIFT_JSON = sw.SLIDER_DIR / "v3_A_drift_{}.json"
TERCILES = ("pointu", "intermediaire", "grand_public")
TERCILE_NAMES = {
    "pointu": "« pointu »",
    "intermediaire": "intermédiaire",
    "grand_public": "« grand public »",
}


def v3_lists(model, foldin, recommendable, counts, full_counts, caps, k):
    """Per cap: top k (training-count cap), raw model scores of the list, candidate counts.

    Returns {cap: (ranked, list_scores, n_cand_train, n_cand_full)}; ranked entries past the
    number of candidates point to -inf scores (lists shorter than k are flagged by n_cand).
    """
    out = {cap: ([], [], [], []) for cap in caps}
    for start in range(0, foldin.shape[0], ev.BATCH_SIZE):
        batch = foldin[start : start + ev.BATCH_SIZE]
        scores = model.scores(batch)
        seen = slider.candidate_mask(batch, np.ones_like(recommendable))  # False on fold-in
        for cap in caps:
            cand = recommendable & (counts <= cap)
            ranked = ev.top_k(scores.copy(), batch, cand, k)
            out[cap][0].append(ranked)
            out[cap][1].append(np.take_along_axis(scores, ranked, axis=1))
            out[cap][2].append((seen & cand).sum(axis=1))
            full = recommendable & (full_counts <= cap)
            out[cap][3].append((seen & full).sum(axis=1))
    return {cap: tuple(np.concatenate(p) for p in parts) for cap, parts in out.items()}


def user_terciles(eval_set: ev.EvalSet, counts: np.ndarray) -> np.ndarray:
    """0/1/2 = tercile of the median training popularity of the user's fold-in (0 = most niche)."""
    fi = eval_set.foldin
    med = np.array(
        [np.median(counts[fi.indices[fi.indptr[u] : fi.indptr[u + 1]]]) for u in range(fi.shape[0])]
    )
    cuts = np.quantile(med, [1 / 3, 2 / 3])
    return np.searchsorted(cuts, med, side="right")


def drift_stats(lists: dict, terciles: np.ndarray, k: int) -> list[dict]:
    """Per cap: short lists and mean model score of the list relative to the ∞ position."""
    base = lists[math.inf][1].mean(axis=1)  # mean raw score of the top k at ∞, per user
    rows = []
    for cap, (_ranked, sc, n_train, n_full) in lists.items():
        valid = np.isfinite(sc)
        mean_sc = np.where(valid, sc, 0).sum(axis=1) / np.maximum(valid.sum(axis=1), 1)
        ratio = mean_sc / base
        top1 = sc[:, 0] / lists[math.inf][1][:, 0]
        row = {
            "cap": None if math.isinf(cap) else cap,
            "share_short_lists_train_counts": float((n_train < k).mean()),
            "share_short_lists_full_counts": float((n_full < k).mean()),
            "min_candidates_train_counts": int(n_train.min()),
            "min_candidates_full_counts": int(n_full.min()),
            "score_ratio_mean": float(ratio.mean()),
            "score_ratio_p10": float(np.percentile(ratio, 10)),
            "score_ratio_median": float(np.median(ratio)),
            "top1_score_ratio_median": float(np.median(top1)),
            "score_ratio_mean_by_tercile": {
                TERCILES[t]: float(ratio[terciles == t].mean()) for t in range(3)
            },
            "share_users_ratio_below_0.5": float((ratio < 0.5).mean()),
        }
        rows.append(row)
    return rows


def cmd_test() -> None:
    """A + V3 at the 8 positions: test metrics (once), drift measures on validation and test."""
    if V3_TEST_JSON.exists():
        raise SystemExit(f"{V3_TEST_JSON.name} exists: the test split is evaluated once")
    catalog = ev.load_catalog()
    counts = ev.train_counts(catalog)
    full_counts = sw.catalog_frame()["ml_rating_count"].to_numpy().astype(np.int64)
    model = sw.adapter("A", catalog)
    manifest = json.loads((SPLIT_DIR / "manifest.json").read_text())
    for split in ("val", "test"):
        eval_set = ev.load_eval_set(split, catalog)
        lists = v3_lists(
            model, eval_set.foldin, catalog.recommendable, counts, full_counts, V3_CAPS, TOP_K
        )
        terciles = user_terciles(eval_set, counts)
        drift = drift_stats(lists, terciles, TOP_K)
        sw.SLIDER_DIR.mkdir(parents=True, exist_ok=True)
        meta = {
            "config_name": "A",
            "config": sw.CONFIGS["A"],
            "split": split,
            "k": TOP_K,
            "slider": "V3 popularity cap on training-user ml_rating_count",
            "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "split_sha256": manifest["sha256"],
            "n_users": len(eval_set.user_ids),
            "tercile_sizes": [int((terciles == t).sum()) for t in range(3)],
        }
        path = Path(str(V3_DRIFT_JSON).format(split))
        path.write_text(json.dumps(meta | {"positions": drift}, indent=2) + "\n")
        print(f"-> {path}", flush=True)
        if split == "test":
            rows = []
            for cap, (ranked, *_rest) in lists.items():
                metrics = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
                metrics["regularite_pop@20"] = slider.popularity_iqr(ranked, counts, TOP_K)
                rows.append({"cap": None if math.isinf(cap) else cap, "metrics": metrics})
                print(
                    f"  cap {cap:>8} ndcg {metrics['ndcg@20']['mean']:.5f} "
                    f"popmed {metrics['pop_mediane@20']['mean']:.0f}",
                    flush=True,
                )
            V3_TEST_JSON.write_text(json.dumps(meta | {"positions": rows}, indent=2) + "\n")
            print(f"-> {V3_TEST_JSON}", flush=True)


def cmd_test_figure() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    test = json.loads(V3_TEST_JSON.read_text())["positions"]
    val = [r for r in load_sweep("A") if r["variant"] == "V3"]
    drift = json.loads(Path(str(V3_DRIFT_JSON).format("test")).read_text())["positions"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))
    for rows, label, color, ls in (
        (val, "validation", "#5b9bd5", "--"),
        (test, "test", "#1f4e79", "-"),
    ):
        x = [r["metrics"]["pop_mediane@20"]["mean"] for r in rows]
        y = [r["metrics"]["ndcg@20"]["mean"] for r in rows]
        e = [r["metrics"]["ndcg@20"]["ci95"] for r in rows]
        ax1.errorbar(
            x,
            y,
            yerr=e,
            ls=ls,
            marker="o",
            ms=4,
            color=color,
            capsize=3,
            label=f"ALS A + plafond (V3) · {label}",
        )
    for r, xi, yi in zip(
        test,
        [r["metrics"]["pop_mediane@20"]["mean"] for r in test],
        [r["metrics"]["ndcg@20"]["mean"] for r in test],
        strict=True,
    ):
        cap = "∞" if r["cap"] is None else f"{r['cap']:,}".replace(",", " ")
        ax1.annotate(cap, (xi, yi), textcoords="offset points", xytext=(5, 6), fontsize=8)
    refs = {
        "populaire (test)": (RESULTS_DIR / "popular_test.json", "k", "^"),
        "hasard (test)": (RESULTS_DIR / "random_test.json", "grey", "v"),
        "EASE (test)": (RESULTS_DIR / "ease_b1_l10000_test.json", "#2e8b57", "*"),
    }
    for label, (path, color, marker) in refs.items():
        m = json.loads(path.read_text())["metrics"]
        ax1.scatter(
            m["pop_mediane@20"]["mean"],
            m["ndcg@20"]["mean"],
            color=color,
            marker=marker,
            s=140 if marker == "*" else 60,
            zorder=5,
            label=label,
        )
    ax1.set_xscale("log")
    ax1.invert_xaxis()
    ax1.set_xlabel("pop_mediane@20 (notes d'entraînement, log ; ← connu · pépite →)")
    ax1.set_ylabel("NDCG@20 (± IC 95 %)")
    ax1.set_title("NDCG@20 aux 8 positions du curseur (étiquettes = plafond)")
    ax1.grid(True, which="both", alpha=0.3)
    ax1.legend(fontsize=8)
    pos = ["∞" if r["cap"] is None else f"{r['cap']:,}".replace(",", " ") for r in drift]
    for t, color in zip(TERCILES, ("#1f4e79", "#7f7f7f", "#a93226"), strict=True):
        ax2.plot(
            pos,
            [r["score_ratio_mean_by_tercile"][t] for r in drift],
            marker="o",
            color=color,
            label=f"tiers {TERCILE_NAMES[t]} des utilisateurs",
        )
    ax2.plot(
        pos, [r["score_ratio_p10"] for r in drift], ls=":", color="k", label="10e centile (tous)"
    )
    ax2.axhline(1, color="grey", lw=0.8)
    ax2.set_xlabel("position du curseur (plafond de notes)")
    ax2.set_ylabel("score moyen du modèle de la liste / score à la position ∞")
    ax2.set_title("Éloignement du goût : score des films proposés vs position ∞ (test)")
    ax2.grid(True, alpha=0.3)
    ax2.legend(fontsize=8)
    fig.suptitle(
        "Étape 2 · C4 — curseur retenu (ALS A + plafond de popularité), test, 10 000 utilisateurs",
        fontsize=11,
    )
    fig.tight_layout()
    path = sw.FIGURES_DIR / "etape2-curseur-test.png"
    fig.savefig(path, dpi=120)
    print(f"-> {path}")


# --- Hybrid popularity (MovieLens + TMDB for recent movies): validation check ---

POPULARITY_CHECK_JSON = sw.SLIDER_DIR / "popularity_hybrid_val.json"
CHECK_TITLES = ("Shang-Chi and the Legend of the Ten Rings", "Black Widow", "No Time to Die")
YEAR_BANDS = ((0, 1999), (2000, 2009), (2010, 2018), (2019, 2020), (2021, 2022), (2023, 2100))


def cmd_popularity_check() -> None:
    """A + V3 on validation, cap on training counts vs on hybrid training counts (no test)."""
    import popularity as popm

    catalog = ev.load_catalog()
    cols = popm.catalog_columns(ev.CATALOG_PARQUET)
    year = cols["year"]
    counts = ev.train_counts(catalog)
    r_train = popm.tmdb_ratio(counts, cols["tmdb_vote_count"], year)
    hyb_train = popm.hybrid(counts, cols["tmdb_vote_count"], r_train)
    full_ml = cols["ml_rating_count"]
    # historical check of the step-3 formula (hybrid), not the year-corrected one adopted later
    r_full = popm.tmdb_ratio(full_ml, cols["tmdb_vote_count"], year)
    full_hyb = popm.hybrid(full_ml, cols["tmdb_vote_count"], r_full)
    eval_set = ev.load_eval_set("val", catalog)
    model = sw.adapter("A", catalog)
    recent = year >= 2019
    out = {
        "split": "val",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "ratio_full_counts": r_full,
        "ratio_training_counts": r_train,
        "reference_years": popm.REFERENCE_YEARS,
        "metrics_popularity": "training-user ml_rating_count (as in C4), plus hybrid median",
    }
    for name, cap_pop in (("ml", counts), ("hybrid", hyb_train)):
        lists = v3_lists(
            model, eval_set.foldin, catalog.recommendable, cap_pop, cap_pop, V3_CAPS, TOP_K
        )
        rows = []
        for cap, (ranked, *_rest) in lists.items():
            metrics = ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable)
            metrics["regularite_pop@20"] = slider.popularity_iqr(ranked, counts, TOP_K)
            metrics["pop_mediane_hybride@20"] = float(np.median(hyb_train[ranked], axis=1).mean())
            rows.append(
                {
                    "cap": None if math.isinf(cap) else cap,
                    "share_recent_2019plus": float(recent[ranked].mean()),
                    "metrics": metrics,
                }
            )
            print(
                f"{name:<6} cap {cap:>8} ndcg {metrics['ndcg@20']['mean']:.5f} "
                f"popmed {metrics['pop_mediane@20']['mean']:>7.0f} "
                f"recent {recent[ranked].mean():.3f}",
                flush=True,
            )
        out[name] = rows
    changed = full_hyb > full_ml
    by_year = []
    for lo, hi in YEAR_BANDS:
        sel = (year >= lo) & (year <= hi)
        by_year.append(
            {
                "years": [lo, hi],
                "n_movies": int(sel.sum()),
                "n_changed": int((changed & sel).sum()),
                "n_changed_x2_or_more": int(((full_hyb >= 2 * full_ml) & sel).sum()),
                "n_leaving_cap_2000": int(((full_ml <= 2000) & (full_hyb > 2000) & sel).sum()),
                "n_leaving_cap_500": int(((full_ml <= 500) & (full_hyb > 500) & sel).sum()),
            }
        )
    no_year = np.isnan(year)
    by_year.append(
        {"years": None, "n_movies": int(no_year.sum()), "n_changed": int((changed & no_year).sum())}
    )
    out["changed_by_year_full_counts"] = by_year
    titles = pl.read_parquet(ev.CATALOG_PARQUET, columns=["item_idx", "tmdb_title"]).sort(
        "item_idx"
    )
    checks = []
    for t in CHECK_TITLES:
        idx = np.flatnonzero((titles["tmdb_title"] == t).to_numpy())
        for i in idx:
            checks.append(
                {
                    "title": t,
                    "year": None if np.isnan(year[i]) else int(year[i]),
                    "ml_rating_count": int(full_ml[i]),
                    "tmdb_vote_count": float(cols["tmdb_vote_count"][i]),
                    "hybrid": int(full_hyb[i]),
                    "under_cap_2000_before": bool(full_ml[i] <= 2000),
                    "under_cap_2000_after": bool(full_hyb[i] <= 2000),
                }
            )
    out["checks"] = checks
    POPULARITY_CHECK_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: out[k] for k in ("ratio_full_counts", "ratio_training_counts")}))
    print(json.dumps(by_year, indent=1))
    print(json.dumps(checks, indent=1, ensure_ascii=False))
    print(f"-> {POPULARITY_CHECK_JSON}")


def main() -> int:
    cmds = {
        "sweep": cmd_sweep,
        "composition": cmd_composition,
        "qualitative": cmd_qualitative,
        "figure": cmd_figure,
        "annex": cmd_annex,
        "test": cmd_test,
        "test-figure": cmd_test_figure,
        "popularity-check": cmd_popularity_check,
    }
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=list(cmds))
    args = parser.parse_args()
    cmds[args.cmd]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
