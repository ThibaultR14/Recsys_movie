"""Final model, int8 quantisation and export of the files the browser loads (step 2, C5, D8).

Subcommands (from `pipeline/`):
    uv run python export.py train       # config A on ALL users -> data/processed/models/
    uv run python export.py int8-check  # D8: C2 model, float32 vs int8, test, positions ∞ / 2 000
    uv run python export.py export      # -> data/processed/export/ + fixtures/foldin_cases.json
    uv run python export.py verify      # re-read the exported files, replay the fold-in cases

`export` writes to the staging folder `data/processed/export/` by default; `export --out web`
writes the same files to `web/public/data/`. The fold-in fixture (`foldin_cases.json`, raw
MovieLens ratings of 22 histories) goes to the staging folder or to `web/test-data/`: both are
ignored by git, and `web/test-data/` is not served (outside `web/public/`).

Files (little-endian):
    embeddings.bin  "PEPE", uint32 version, uint32 n_items, uint32 dims,
                    int8[n_items x dims] (row = item_idx), float32[n_items] scales
    yty.bin         float32[dims x dims], YᵀY computed from the DEQUANTISED vectors
    popularity.bin  uint32[n_items], slider popularity (popularity.py): complete ml_rating_count
                    corrected by release year, at least r * TMDB votes
    model-meta.json version, hyperparameters, confidence formula, slider, movie_id per item_idx
"""

from __future__ import annotations

import os

# Must be set before NumPy is imported (recommendation of implicit, for training).
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import argparse  # noqa: E402
import gzip  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import struct  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from datetime import UTC, datetime  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
import scipy.sparse as sp  # noqa: E402

import evaluate as ev  # noqa: E402
import popularity as popm  # noqa: E402
from config import (  # noqa: E402
    FORBIDDEN_WEB_PREFIXES,
    PROCESSED,
    REPO_ROOT,
    RESULTS_DIR,
    SEED,
    SPLIT_DIR,
    TOP_K,
    WEB_DATA,
)
from models import als  # noqa: E402
from recent_films import DISCOVER_PARQUET  # noqa: E402

FINAL_CONFIG = {"factors": 64, "regularization": 0.05, "alpha": 1.0, "beta": 1.0, "iterations": 30}
# Fold-in of the site's user (step 6c, D2): rated films with percentile < 0.3 left out, unless
# fewer than 5 films would remain. Training is unchanged.
FOLDIN_RULE = {"drop_below": 0.3, "min_kept": 5}
C2_FACTORS = PROCESSED / "models" / "als_f64_r0.05_a1_b1_i30_item_factors.npy"
FINAL_FACTORS = PROCESSED / "models" / "als_final_f64_r0.05_a1_b1_i30_item_factors.npy"
FINAL_INFO = PROCESSED / "models" / "als_final_info.json"
# movie_id per item_idx, saved WITH the vectors at training: item_idx is frozen there (CLAUDE.md)
FINAL_MOVIE_IDS = PROCESSED / "models" / "als_final_movie_ids.npy"
STAGING = PROCESSED / "export"
FIXTURE_NAME = "foldin_cases.json"
# The fixture holds raw MovieLens ratings of test users: never versioned (.gitignore), never served.
# Staging export -> data/processed/export/foldin_cases.json ; web export -> web/test-data/.
WEB_FIXTURE = REPO_ROOT / "web" / "test-data" / FIXTURE_NAME
FIXTURE = STAGING / FIXTURE_NAME  # staging copy, used by tests/test_export.py
SLIDER_POSITIONS = (None, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200)  # None = ∞
FIXTURE_POSITIONS = (None, 2_000, 500)
INT8_CHECK_POSITIONS = (None, 2_000)
N_CASES = 20
CASE_MAX_FILMS = 400
FIXTURE_TOP = 10
MAGIC = b"PEPE"
FORMAT_VERSION = 1
HEADER = struct.Struct("<4sIII")


# --- quantisation and binary files ----------------------------------------------------------------


def quantize(Y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:  # noqa: N803
    """Symmetric int8 per item: scale = max|y_i| / 127, q = round(y / scale); zero row -> 0."""
    Y = np.asarray(Y, dtype=np.float32)
    scales = (np.abs(Y).max(axis=1) / 127.0).astype(np.float32)
    safe = np.where(scales > 0, scales, 1.0).astype(np.float32)
    q = np.clip(np.rint(Y / safe[:, None]), -127, 127).astype(np.int8)
    return q, scales


def dequantize(q: np.ndarray, scales: np.ndarray) -> np.ndarray:
    return (q.astype(np.float32) * scales[:, None]).astype(np.float32)


def write_embeddings(path: Path, q: np.ndarray, scales: np.ndarray) -> None:
    n, d = q.shape
    with open(path, "wb") as fh:
        fh.write(HEADER.pack(MAGIC, FORMAT_VERSION, n, d))
        fh.write(np.ascontiguousarray(q, dtype=np.int8).tobytes())
        fh.write(np.ascontiguousarray(scales, dtype="<f4").tobytes())


def read_embeddings(path: Path) -> tuple[np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    magic, version, n, d = HEADER.unpack_from(raw, 0)
    if magic != MAGIC or version != FORMAT_VERSION:
        raise ValueError(f"bad header {magic!r} v{version}")
    off = HEADER.size
    q = np.frombuffer(raw, dtype=np.int8, count=n * d, offset=off).reshape(n, d)
    scales = np.frombuffer(raw, dtype="<f4", count=n, offset=off + n * d)
    if len(raw) != off + n * d + 4 * n:
        raise ValueError("embeddings.bin: unexpected size")
    return q, scales


def read_yty(path: Path, dims: int) -> np.ndarray:
    return np.frombuffer(path.read_bytes(), dtype="<f4").reshape(dims, dims)


def read_popularity(path: Path) -> np.ndarray:
    return np.frombuffer(path.read_bytes(), dtype="<u4")


def assert_web_safe(obj, where: str = "") -> None:
    """Refuse any key or string value starting with a forbidden prefix (IMDb dataset columns)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).startswith(FORBIDDEN_WEB_PREFIXES):
                raise ValueError(f"forbidden key {k!r} in {where or 'export'}")
            assert_web_safe(v, where)
    elif isinstance(obj, list | tuple):
        for v in obj:
            assert_web_safe(v, where)
    elif isinstance(obj, str) and obj.startswith(FORBIDDEN_WEB_PREFIXES):
        raise ValueError(f"forbidden value {obj!r} in {where or 'export'}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --- slider (D5, V3) ------------------------------------------------------------------------------


def top_under_cap(
    scores: np.ndarray,
    seen: np.ndarray,
    recommendable: np.ndarray,
    popularity: np.ndarray,
    cap: int | None,
    k: int,
) -> np.ndarray:
    """Top k item indices (best first) for ONE user: recommendable, unseen, popularity <= cap."""
    cand = recommendable.copy()
    cand[seen] = False
    if cap is not None:
        cand &= popularity <= cap
    idx = np.flatnonzero(cand)
    order = np.lexsort((idx, -scores[idx]))  # score desc, item_idx asc on ties
    return idx[order[:k]]


def calibration_meta() -> dict:
    """model-meta.json `calibration` (step 6c, D1): read by the TypeScript engine."""
    import calibration as cal

    return cal.PRODUCTION | {
        "positions": list(SLIDER_POSITIONS),
        "genres": "MovieLens genres of catalog.json (genre_names order); films without genre count "
        "in neither distribution",
        "objective": "greedy: (1 - lambda) * sum(score / max score of the pool) - lambda * "
        "sum_g BernoulliKL(p_g, (1 - alpha) q_g + alpha p_g); p_g = signal-weighted share of the "
        "fold-in films with genre g, q_g = share of the listed films with genre g",
    }


def kept_signal(signal: sp.csr_matrix, kept: np.ndarray) -> sp.csr_matrix:
    """One-user signal restricted to the films kept in the fold-in (step 6c, D2)."""
    s = signal.tocsr().copy()
    s.data = np.where(kept, s.data, 0).astype(s.data.dtype)
    s.eliminate_zeros()
    return s


def calibrated_lists(
    scores: np.ndarray,
    seen: np.ndarray,
    recommendable: np.ndarray,
    popularity: np.ndarray,
    kept_items: np.ndarray,
    kept_signal: np.ndarray,
    genres: list[list[int]],
    calibration: dict,
) -> dict[str, list[int]]:
    """Calibrated lists at the 8 slider positions (step 6c, D1, share mode, λ per position)."""
    import calibration as cal

    n_genres = 1 + max(g for gs in genres for g in gs)
    prof = cal.share_profile_one(genres, n_genres, kept_items, kept_signal)
    out = {}
    for pos, lam in zip(SLIDER_POSITIONS, calibration["lambda_by_position"], strict=True):
        pool = top_under_cap(scores, seen, recommendable, popularity, pos, calibration["pool"])
        out["inf" if pos is None else str(pos)] = cal.calibrate_one(
            pool, scores[pool], prof, genres, lam, calibration["n_list"], calibration["alpha"]
        )
    return out


def version_partners(movie_ids: np.ndarray) -> dict[int, set[int]]:
    """item_idx -> the item_idx of its other cuts (`version_of` lines, both ways; step 6c, D3)."""
    from build_catalog import load_manual_overrides

    idx = {int(m): i for i, m in enumerate(movie_ids)}
    out: dict[int, set[int]] = {}
    lines = load_manual_overrides().filter(pl.col("action") == "version_of")
    for m, t in lines.select("movie_id", "target_movie_id").iter_rows():
        a, b = idx[m], idx[t]
        out.setdefault(a, set()).add(b)
        out.setdefault(b, set()).add(a)
    return out


def seen_mask(n_items: int, items: np.ndarray, partners: dict[int, set[int]]) -> np.ndarray:
    """Seen films plus the other cuts of the seen films (never recommended)."""
    seen = np.zeros(n_items, dtype=bool)
    seen[items] = True
    for i in items:
        for j in partners.get(int(i), ()):
            seen[j] = True
    return seen


# --- train ----------------------------------------------------------------------------------------


def all_ratings(catalog: ev.Catalog) -> sp.csr_matrix:
    """(all users x items) ratings, users in userId order (ratings_filtered.parquet)."""
    df = pl.read_parquet(
        PROCESSED / "ratings_filtered.parquet", columns=["userId", "movieId", "rating"]
    )
    df = df.join(ev.item_index(catalog).select("movieId", "item_idx"), on="movieId")
    rows = df["userId"].rank("dense").cast(pl.Int32).to_numpy() - 1
    m = sp.csr_matrix(
        (df["rating"].to_numpy(), (rows, df["item_idx"].to_numpy())),
        shape=(int(rows.max()) + 1, catalog.n_items),
        dtype=np.float32,
    )
    m.sort_indices()
    return m


def cmd_train() -> None:
    catalog = ev.load_catalog()
    ratings = all_ratings(catalog)
    cfg = FINAL_CONFIG
    signal = als.signal_values(ratings, cfg["beta"])
    t0 = time.perf_counter()
    model = als.train(
        signal,
        factors=cfg["factors"],
        regularization=cfg["regularization"],
        alpha=cfg["alpha"],
        iterations=cfg["iterations"],
    )
    elapsed = time.perf_counter() - t0
    Y = np.asarray(model.item_factors, dtype=np.float32)
    FINAL_FACTORS.parent.mkdir(parents=True, exist_ok=True)
    np.save(FINAL_FACTORS, Y)
    np.save(FINAL_MOVIE_IDS, catalog.movie_ids.astype(np.int64))
    info = {
        "config": cfg,
        "seed": SEED,
        "n_users": int(ratings.shape[0]),
        "n_items": int(ratings.shape[1]),
        "n_ratings": int(ratings.nnz),
        "train_seconds": round(elapsed, 1),
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "ratings_sha256": sha256_file(PROCESSED / "ratings_filtered.parquet"),
        "catalog_sha256": sha256_file(ev.CATALOG_PARQUET),
        "zero_item_vectors": int((np.abs(Y).max(axis=1) == 0).sum()),
    }
    FINAL_INFO.write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps(info, indent=2))


# --- int8 check (D8) ------------------------------------------------------------------------------


def evaluate_positions(Y: np.ndarray, split: str, positions) -> dict:
    """ALS A fold-in with item vectors Y; V3 positions on training counts (as in C4)."""
    catalog = ev.load_catalog()
    eval_set = ev.load_eval_set(split, catalog)
    counts = ev.train_counts(catalog)
    cfg = FINAL_CONFIG
    model = als.ALSModel(
        Y, regularization=cfg["regularization"], alpha=cfg["alpha"], beta=cfg["beta"]
    )
    out = {}
    for pos in positions:
        cand = catalog.recommendable & (counts <= (math.inf if pos is None else pos))
        ranked = []
        for start in range(0, len(eval_set.user_ids), ev.BATCH_SIZE):
            batch = eval_set.foldin[start : start + ev.BATCH_SIZE]
            ranked.append(ev.top_k(model.scores(batch), batch, cand, TOP_K))
        ranked = np.vstack(ranked)
        out["inf" if pos is None else str(pos)] = {
            "metrics": ev.compute_metrics(ranked, eval_set, counts, catalog.recommendable),
            "ranked_sha256": hashlib.sha256(ranked.tobytes()).hexdigest(),
        }
    return out


def cmd_int8_check() -> None:
    Y = np.load(C2_FACTORS)
    q, scales = quantize(Y)
    Yq = dequantize(q, scales)
    res = {"float32": evaluate_positions(Y, "test", INT8_CHECK_POSITIONS)}
    res["int8"] = evaluate_positions(Yq, "test", INT8_CHECK_POSITIONS)
    rows, passed = [], True
    for pos in res["float32"]:
        for metric in ("ndcg@20", "recall@20"):
            a = res["float32"][pos]["metrics"][metric]["mean"]
            b = res["int8"][pos]["metrics"][metric]["mean"]
            loss = (a - b) / a
            passed &= loss < 0.01
            rows.append(
                {"position": pos, "metric": metric, "float32": a, "int8": b, "rel_loss": loss}
            )
    rel_err = np.linalg.norm(Y - Yq, axis=1) / np.maximum(np.linalg.norm(Y, axis=1), 1e-12)
    out = {
        "model": "C2 config A (training users only)",
        "split": "test",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "vector_rel_l2_error": {"mean": float(rel_err.mean()), "max": float(rel_err.max())},
        "rows": rows,
        "same_top20_lists": {
            pos: res["float32"][pos]["ranked_sha256"] == res["int8"][pos]["ranked_sha256"]
            for pos in res["float32"]
        },
        "passed": bool(passed),
        "full": res,
    }
    path = RESULTS_DIR / "int8_check.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    for r in rows:
        print(r)
    print("passed:", passed, "->", path)


# --- export ---------------------------------------------------------------------------------------


def fixture_cases(
    Y: np.ndarray,  # noqa: N803
    yty: np.ndarray,
    recommendable: np.ndarray,
    popularity: np.ndarray,
    movie_ids: np.ndarray,
) -> list[dict]:
    """20 real test histories (random, SEED) + 2 synthetic edge cases, from the exported data."""
    catalog = ev.load_catalog()
    eval_set = ev.load_eval_set("test", catalog)
    sizes = np.diff(eval_set.foldin.indptr)
    pool = np.flatnonzero(sizes <= CASE_MAX_FILMS)
    rows = np.sort(np.random.default_rng(SEED).choice(pool, N_CASES, replace=False))
    histories = []
    for i, r in enumerate(rows):
        lo, hi = eval_set.foldin.indptr[r], eval_set.foldin.indptr[r + 1]
        histories.append(
            (f"test_{i + 1:02d}", eval_set.foldin.indices[lo:hi], eval_set.foldin.data[lo:hi])
        )
    # synthetic: one film only (p = 0.5); all ratings equal (ties -> average rank -> p = 0.5)
    first = np.flatnonzero(recommendable)[:5]
    histories.append(("single_film", first[:1], np.array([4.0], dtype=np.float32)))
    histories.append(("all_ties", first, np.full(5, 3.5, dtype=np.float32)))
    # step 6c (D2): ties around the threshold (p = 0.05 x2 and 0.2 dropped, p = 0.3 exactly kept)
    # and the guard (dropping 2 of 6 films would leave 4 < 5: every film kept)
    eleven = np.flatnonzero(recommendable)[5:16]
    histories.append(
        (
            "ties_at_threshold",
            eleven,
            np.array([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=np.float32),
        )
    )
    six = np.flatnonzero(recommendable)[16:22]
    histories.append(("guard_small", six, np.arange(1, 7, dtype=np.float32)))
    # step 6c (D3): a history with one cut of a film (the other cut must never be recommended)
    partners = version_partners(movie_ids)
    if partners:
        a = min(partners)
        histories.append(
            ("version_seen", np.array([a, *first[:4]]), np.array([5, 4, 3, 2, 1], dtype=np.float32))
        )
    import calibration as cal

    genres = cal.genre_lists()
    cfg = FINAL_CONFIG
    cases = []
    for name, items, ratings in histories:
        order = np.argsort(items)
        items, ratings = items[order], ratings[order]
        R = sp.csr_matrix(  # noqa: N806
            (ratings.astype(np.float32), (np.zeros(len(items), dtype=np.int32), items)),
            shape=(1, len(Y)),
        )
        p = als.percentile_values(R).data
        signal = als.signal_values(R, cfg["beta"])
        kept = als.kept_for_foldin(p, None, **FOLDIN_RULE)
        x = als.fold_in(
            Y,
            kept_signal(signal, kept),
            regularization=cfg["regularization"],
            alpha=cfg["alpha"],
            yty=yty,
        )[0]
        scores = Y.astype(np.float64) @ x
        seen = seen_mask(len(Y), items, partners)
        tops = {}
        for pos in FIXTURE_POSITIONS:
            top = top_under_cap(scores, seen, recommendable, popularity, pos, FIXTURE_TOP)
            tops["inf" if pos is None else str(pos)] = {
                "item_idx": top.tolist(),
                "movie_id": movie_ids[top].tolist(),
                "score": scores[top].tolist(),
            }
        cases.append(
            {
                "name": name,
                "item_idx": items.tolist(),
                "movie_id": movie_ids[items].tolist(),
                "rating": ratings.astype(float).tolist(),
                "percentile": p.astype(float).tolist(),
                "signal": signal.data.astype(float).tolist(),
                "kept": kept.tolist(),
                "user_vector": x.tolist(),
                "calibrated": calibrated_lists(
                    scores,
                    seen,
                    recommendable,
                    popularity,
                    items[kept],
                    signal.data[kept],
                    genres,
                    cal.PRODUCTION,
                ),
                "excluded_versions": sorted(
                    int(i) for i in np.flatnonzero(seen) if i not in set(items)
                ),
                "top10": tops,
            }
        )
    return cases


def file_sizes(folder: Path) -> dict:
    out = {}
    for path in sorted(folder.iterdir()):
        if path.name in (FIXTURE_NAME, ".gitkeep"):
            continue
        raw = path.read_bytes()
        out[path.name] = {"bytes": len(raw), "gzip_bytes": len(gzip.compress(raw, compresslevel=9))}
    return out


def trained_movie_ids(catalog: ev.Catalog) -> np.ndarray:
    """item_idx -> movie_id order saved at training; refuse to export if the catalogue moved."""
    if not FINAL_MOVIE_IDS.exists():
        raise SystemExit(f"{FINAL_MOVIE_IDS.name} missing: run `export.py train` again")
    movie_ids = np.load(FINAL_MOVIE_IDS)
    if not np.array_equal(movie_ids, catalog.movie_ids):
        raise SystemExit("catalogue item order differs from the one saved at training: retrain")
    return movie_ids


def fixture_path(out_dir: Path) -> Path:
    return WEB_FIXTURE if out_dir == WEB_DATA else out_dir / FIXTURE_NAME


def cmd_export(out_dir: Path) -> None:
    if out_dir == WEB_DATA:
        print("writing to web/public/data/ (explicit request)")
    catalog = ev.load_catalog()
    movie_ids = trained_movie_ids(catalog)
    year_pop, pop_info = popm.production_popularity_v8(ev.CATALOG_PARQUET, DISCOVER_PARQUET)
    assert year_pop.max() < 2**32
    popularity = year_pop.astype(np.uint32)
    Y = np.load(FINAL_FACTORS)
    info = json.loads(FINAL_INFO.read_text())
    q, scales = quantize(Y)
    Yq = dequantize(q, scales)
    yty32 = (Yq.astype(np.float64).T @ Yq.astype(np.float64)).astype("<f4")

    out_dir.mkdir(parents=True, exist_ok=True)
    write_embeddings(out_dir / "embeddings.bin", q, scales)
    (out_dir / "yty.bin").write_bytes(yty32.tobytes())
    (out_dir / "popularity.bin").write_bytes(popularity.astype("<u4").tobytes())
    cfg = FINAL_CONFIG
    meta = {
        "format_version": FORMAT_VERSION,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "model": "ALS (implicit 0.7.3), configuration A, trained on all MovieLens users",
        "n_items": int(len(Y)),
        "dims": int(Y.shape[1]),
        "factors": cfg["factors"],
        "regularization": cfg["regularization"],
        "alpha": cfg["alpha"],
        "beta": cfg["beta"],
        "iterations": cfg["iterations"],
        "foldin_drop_below": FOLDIN_RULE["drop_below"],
        "foldin_min_kept": FOLDIN_RULE["min_kept"],
        "calibration": calibration_meta(),
        "foldin_rule": "step 6c (D2): rated films with p < foldin_drop_below are left out of the "
        "fold-in (still seen, never recommended); unrated films never; if fewer than "
        "foldin_min_kept films remain, every film is kept",
        "signal": "r_ui = 1 + beta * p_ui, p_ui = (average_rank - 1) / (n - 1) of the rating "
        "in the user's history (0.5 if one rating or no rating)",
        "confidence": "C_ui = alpha * r_ui on watched movies (P_ui = 1), C = 1 and P = 0 elsewhere",
        "foldin": "x_u = solve(YtY + reg * I + sum_i (C_ui - 1) y_i y_i^T, sum_i C_ui y_i), "
        "Y = dequantised vectors, YtY from yty.bin",
        "embeddings": "embeddings.bin: 'PEPE', uint32 version, uint32 n_items, uint32 dims, "
        "int8[n_items x dims], float32[n_items] scales; y = int8 * scale (little-endian)",
        "popularity": {
            "file": "popularity.bin",
            "formula": "max(round(ml_rating_count * f_year), round(r * tmdb_vote_count)), "
            "f_year = max(1, r / r_year); missing TMDB votes count as 0",
            "ml_rating_count": "complete (all MovieLens users)",
            "r": pop_info["r_ref"],
            "r_definition": "median of ml_rating_count / tmdb_vote_count over movies released "
            f"{popm.REFERENCE_YEARS[0]}-{popm.REFERENCE_YEARS[1]}",
            "r_year_definition": "median of ml_rating_count / tmdb_vote_count over the movies of "
            f"the release year; fewer than {popm.MIN_FILMS_PER_YEAR} movies -> previous year",
            "year_factors": pop_info["factors"],
            "year_factors_note": "release years not listed: f = 1",
            "rank_rule": {
                "first_year": pop_info["rank_first_year"],
                "reference_years": pop_info["rank_reference_years"],
                "rule": "step 8 (R3d): for movies released from first_year on, MovieLens "
                "under-counts even the hits; the movie ranked r by TMDB votes within its "
                "release year (TMDB /discover, >= 50 votes) gets the median over the reference "
                "years of the r-th highest popularity of the year; never below the formula above",
                "table_head": pop_info["rank_table_head"],
                "table_len": pop_info["rank_table_len"],
            },
            "why": "MovieLens stops in 2023 and its users rate mostly the movies of their time: "
            "recent movies have few ratings because they are recent. f >= 1 and the max only "
            "ever raise popularity",
            "dtype": "uint32 per item_idx",
        },
        "slider": {
            "variant": "popularity cap (D5): unseen recommendable movies with popularity <= cap, "
            "ranked by model score",
            "positions": list(SLIDER_POSITIONS),
        },
        "movie_ids": movie_ids.tolist(),
        "non_recommendable_item_idx": np.flatnonzero(~catalog.recommendable).tolist(),
        "data_version": {
            "catalog_sha256": info["catalog_sha256"],
            "ratings_sha256": info["ratings_sha256"],
            "split_manifest_sha256": sha256_file(SPLIT_DIR / "manifest.json"),
        },
        "embeddings_sha256": sha256_file(out_dir / "embeddings.bin"),
    }
    assert_web_safe(meta, "model-meta.json")
    # newline="\n": identical bytes on every OS (no CRLF on Windows)
    (out_dir / "model-meta.json").write_text(
        json.dumps(meta, separators=(",", ":")) + "\n", newline="\n"
    )
    for path in out_dir.iterdir():
        assert_web_safe(path.name, "file names")

    # fixtures, computed from what was just written (read back)
    q2, s2 = read_embeddings(out_dir / "embeddings.bin")
    Yr = dequantize(q2, s2)
    yty = read_yty(out_dir / "yty.bin", Y.shape[1]).astype(np.float64)
    cases = fixture_cases(
        Yr, yty, catalog.recommendable, read_popularity(out_dir / "popularity.bin"), movie_ids
    )
    fixture = {
        "description": "Fold-in reference cases for the TypeScript implementation (step 4). "
        "Computed in float64 from the exported files "
        "(dequantised vectors, yty.bin, popularity.bin).",
        "created_at": meta["created_at"],
        "embeddings_sha256": meta["embeddings_sha256"],
        "config": cfg | FOLDIN_RULE,
        "calibration": calibration_meta(),
        "positions": [None if p is None else p for p in FIXTURE_POSITIONS],
        "top": FIXTURE_TOP,
        "cases": cases,
    }
    fixture_file = fixture_path(out_dir)
    fixture_file.parent.mkdir(parents=True, exist_ok=True)
    fixture_file.write_text(json.dumps(fixture, indent=1) + "\n", newline="\n")
    sizes = file_sizes(out_dir)
    report = {
        "out_dir": str(out_dir),
        "sizes": sizes,
        "fixture": str(fixture_file),
        "fixture_bytes": fixture_file.stat().st_size,
    }
    (RESULTS_DIR / "export_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def cmd_verify(out_dir: Path) -> dict:
    """Read-back and replay checks (C5 criteria). Raises on failure."""
    meta = json.loads((out_dir / "model-meta.json").read_text())
    assert_web_safe(meta, "model-meta.json")
    q, scales = read_embeddings(out_dir / "embeddings.bin")
    Y = np.load(FINAL_FACTORS)
    q0, s0 = quantize(Y)
    assert np.array_equal(q, q0) and np.array_equal(scales, s0), "embeddings.bin != quantised model"
    Yq = dequantize(q, scales)
    assert np.array_equal(Yq, dequantize(q0, s0)), "read-back vectors differ"
    yty = read_yty(out_dir / "yty.bin", meta["dims"])
    expected = (Yq.astype(np.float64).T @ Yq.astype(np.float64)).astype("<f4")
    assert np.array_equal(yty, expected), "yty.bin != YᵀY of the dequantised vectors"
    pop = read_popularity(out_dir / "popularity.bin")
    assert len(pop) == meta["n_items"] == len(meta["movie_ids"]) == len(Y)
    expected_pop, pop_info = popm.production_popularity_v8(ev.CATALOG_PARQUET, DISCOVER_PARQUET)
    assert np.array_equal(pop, expected_pop.astype(np.uint32)), "popularity.bin != formula"
    assert meta["popularity"]["r"] == pop_info["r_ref"]
    assert meta["popularity"]["year_factors"] == pop_info["factors"]
    assert meta["popularity"]["rank_rule"]["first_year"] == pop_info["rank_first_year"]
    fixture = json.loads(fixture_path(out_dir).read_text())
    assert fixture["embeddings_sha256"] == sha256_file(out_dir / "embeddings.bin"), "stale fixture"
    rec = np.ones(meta["n_items"], dtype=bool)
    rec[meta["non_recommendable_item_idx"]] = False
    cfg = fixture["config"]
    partners = version_partners(np.array(meta["movie_ids"]))
    import calibration as cal

    genres = cal.genre_lists()
    assert meta["calibration"] == calibration_meta(), "model-meta.json calibration"
    max_vec_err, n_tops, n_cal = 0.0, 0, 0
    for case in fixture["cases"]:
        items = np.array(case["item_idx"], dtype=np.int32)
        R = sp.csr_matrix(  # noqa: N806
            (
                np.array(case["rating"], dtype=np.float32),
                (np.zeros(len(items), dtype=np.int32), items),
            ),
            shape=(1, meta["n_items"]),
        )
        signal = als.signal_values(R, cfg["beta"])
        assert np.allclose(signal.data, case["signal"]), case["name"]
        p = als.percentile_values(R).data
        kept = als.kept_for_foldin(p, None, drop_below=cfg["drop_below"], min_kept=cfg["min_kept"])
        assert kept.tolist() == case["kept"], case["name"]
        x = als.fold_in(
            Yq,
            kept_signal(signal, kept),
            regularization=cfg["regularization"],
            alpha=cfg["alpha"],
            yty=yty.astype(np.float64),
        )[0]
        max_vec_err = max(max_vec_err, float(np.abs(x - np.array(case["user_vector"])).max()))
        scores = Yq.astype(np.float64) @ x
        seen = seen_mask(meta["n_items"], items, partners)
        for pos_key, top in case["top10"].items():
            cap = None if pos_key == "inf" else int(pos_key)
            got = top_under_cap(scores, seen, rec, pop, cap, fixture["top"])
            assert got.tolist() == top["item_idx"], (case["name"], pos_key)
            n_tops += 1
        sig = als.signal_values(R, cfg["beta"]).data
        cal_lists = calibrated_lists(
            scores, seen, rec, pop, items[kept], sig[kept], genres, meta["calibration"]
        )
        assert cal_lists == case["calibrated"], case["name"]
        n_cal += len(cal_lists)
    out = {
        "cases": len(fixture["cases"]),
        "top_lists_identical": n_tops,
        "calibrated_lists_identical": n_cal,
        "max_user_vector_abs_diff": max_vec_err,
    }
    print(json.dumps(out, indent=2))
    return out


CATALOG_FILES = ("catalog.json", "title-index.json")
WEB_DATA_GZIP_BUDGET = 5 * 1024 * 1024  # step 3 criterion: all of web/public/data <= 5 MB gzip


def write_compact_json(path: Path, obj) -> None:
    assert_web_safe(obj, path.name)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


SPLIT_FILES = ("train", "val_foldin", "val_heldout", "test_foldin", "test_heldout")


def catalog_divisive(cat: pl.DataFrame) -> list[int]:
    """« ça divise » films (step 6c, Q6): the union of the split files is exactly the catalogue's
    MovieLens ratings (merged ids); checked against ml_rating_count."""
    import site_catalog as sc

    ratings = pl.concat([pl.scan_parquet(ev.SPLIT_DIR / f"{f}.parquet") for f in SPLIT_FILES])
    disp = cat.select("item_idx", "movie_id", "ml_rating_count").join(
        sc.rating_dispersion(ratings), left_on="movie_id", right_on="movieId", how="left"
    )
    disp = disp.sort("item_idx")
    assert (disp["n"] == disp["ml_rating_count"]).all(), "split ratings != catalogue counts"
    return sc.divisive_items(disp["std"].to_numpy(), disp["n"].to_numpy())


def cmd_catalog(out_dir: Path) -> dict:
    """catalog.json + title-index.json (step 3, D2/D3), in the item order saved at training, with
    the manual display titles (`title` action of manual_overrides.csv, step 5 D7)."""
    import site_catalog as sc
    from build_catalog import load_manual_overrides

    catalog = ev.load_catalog()
    trained_movie_ids(catalog)  # refuses a catalogue whose item order moved since training
    cat = sc.load_catalog_frame(ev.CATALOG_PARQUET)
    overrides = load_manual_overrides()
    manual = sc.title_overrides(cat, overrides)
    versions = sc.version_pairs(cat, overrides)
    divisive = catalog_divisive(cat)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_compact_json(
        out_dir / "catalog.json", sc.build_catalog_json(cat, manual, versions, divisive)
    )
    write_compact_json(out_dir / "title-index.json", sc.build_title_index(cat, manual))
    sizes = file_sizes(out_dir)
    total = sum(v["gzip_bytes"] for v in sizes.values())
    report = {
        "out_dir": str(out_dir),
        "sizes": sizes,
        "total_bytes": sum(v["bytes"] for v in sizes.values()),
        "total_gzip_bytes": total,
        "within_5mb_gzip": total <= WEB_DATA_GZIP_BUDGET,
        "manual_titles": len(manual),
        "divisive": len(divisive),
    }
    (RESULTS_DIR / "catalog_export_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return report


def cmd_catalog_verify(out_dir: Path) -> dict:
    """Re-read catalog.json / title-index.json: shapes, item references, every title findable,
    manual display titles shown and indexed as source 0."""
    import site_catalog as sc
    from build_catalog import load_manual_overrides
    from titles import normalize_title

    cat_json = json.loads((out_dir / "catalog.json").read_text(encoding="utf-8"))
    index = json.loads((out_dir / "title-index.json").read_text(encoding="utf-8"))
    n = cat_json["n"]
    meta = json.loads((out_dir / "model-meta.json").read_text())
    assert n == meta["n_items"]
    cols = ("title", "year", "tmdb_id", "imdb_id", "directors", "poster_path", "genres")
    for col in (*cols, "ml_mean", "ml_count"):
        assert len(cat_json[col]) == n, col
    assert cat_json["v"] == sc.CATALOG_JSON_VERSION
    assert all(isinstance(m, int) and 5 <= m <= 50 for m in cat_json["ml_mean"]), "ml_mean"
    assert all(isinstance(c, int) and c >= 1 for c in cat_json["ml_count"]), "ml_count"
    assert index["keys"] == sorted(set(index["keys"])) and len(index["keys"]) == len(index["post"])
    where: dict[int, dict[str, int]] = {}
    for key, post in zip(index["keys"], index["post"], strict=True):
        for code in post:
            assert 0 <= code // 4 < n
            where.setdefault(code // 4, {})[key] = code % 4
    cat = sc.load_catalog_frame(ev.CATALOG_PARQUET)
    missing = 0
    for r in cat.iter_rows(named=True):
        key = normalize_title(r["tmdb_title"]) if r["tmdb_title"] else None
        if key and where.get(r["item_idx"], {}).get(key) != sc.SRC_TMDB:
            missing += 1
    overrides = load_manual_overrides()
    manual = sc.title_overrides(cat, overrides)
    assert cat_json["version_of"] == sc.version_pairs(cat, overrides), "version_of"
    assert all(0 <= i < n for pair in cat_json["version_of"] for i in pair), "version_of"
    assert cat_json["divisive"] == catalog_divisive(cat), "divisive"
    assert abs(len(cat_json["divisive"]) - sc.DIVISIVE_TOP_SHARE * n) <= 0.01 * n, "divisive share"
    manual_bad = [
        i
        for i, t in manual.items()
        if cat_json["title"][i] != t or where.get(i, {}).get(normalize_title(t)) != sc.SRC_TMDB
    ]
    films_without_key = n - len(where)
    out = {
        "n": n,
        "keys": len(index["keys"]),
        "films_without_key": films_without_key,
        "tmdb_title_not_indexed_as_source_0": missing,
        "manual_titles": len(manual),
        "manual_titles_not_applied": manual_bad,
        "version_pairs": len(cat_json["version_of"]),
        "divisive": len(cat_json["divisive"]),
    }
    assert films_without_key == 0 and missing == 0 and not manual_bad, out
    print(json.dumps(out, indent=2))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "cmd", choices=["train", "int8-check", "export", "verify", "catalog", "catalog-verify"]
    )
    parser.add_argument("--out", default="staging", help="'staging' (default) or 'web'")
    args = parser.parse_args()
    out_dir = WEB_DATA if args.out == "web" else STAGING
    if args.cmd == "train":
        cmd_train()
    elif args.cmd == "int8-check":
        cmd_int8_check()
    elif args.cmd == "export":
        cmd_export(out_dir)
    elif args.cmd == "catalog":
        cmd_catalog(out_dir)
    elif args.cmd == "catalog-verify":
        cmd_catalog_verify(out_dir)
    else:
        cmd_verify(out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
