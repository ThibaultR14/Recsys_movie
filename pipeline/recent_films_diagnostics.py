"""Step 8 diagnostic: films released after MovieLens 32M (docs/etape-8-films-recents.md, R0).

Counts only, nothing written to web/public/data, catalogue untouched.

    uv run python recent_films_diagnostics.py discover   # TMDB /discover, 2022 -> today
    uv run python recent_films_diagnostics.py fetch      # one /movie call per film
    uv run python recent_films_diagnostics.py stats      # neighbours in the catalogue
    uv run python recent_films_diagnostics.py preview    # neighbour means vs true vectors
    uv run python recent_films_diagnostics.py exports <report.json>...   # point 4, counts only

TMDB calls go through `enrich_tmdb.Tmdb` (rate limit, retries, never logs a URL). Raw answers are
slimmed and cached in `data/cache/tmdb/{discover,recent}/` (ignored by git, same 6-month rule).
Results: `data/processed/results/recent/*.json` (ignored by git).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import polars as pl
from tqdm import tqdm

from build_catalog import CATALOG_PARQUET
from config import PROCESSED, RESULTS_DIR
from enrich_tmdb import TMDB_CACHE, WORKERS, Tmdb
from titles import normalize_title

CUTOFF = date(2023, 10, 13)  # first day after the last MovieLens 32M rating (2023-10-12)
DISCOVER_FROM = date(2022, 1, 1)
MIN_VOTES = 50
VOTE_THRESHOLDS = (50, 100, 200, 500)
NEIGHBOUR_THRESHOLDS = (1, 3, 5, 10)
GENRE_DOCUMENTARY = 99
GENRE_TV_MOVIE = 10770
DISCOVER_MAX_PAGES = 500  # TMDB caps /discover at page 500
OUT = RESULTS_DIR / "recent"
MODELS = PROCESSED / "models"


# --- TMDB ---------------------------------------------------------------------------------------


def month_windows(start: date, end: date) -> list[tuple[date, date]]:
    out, cur = [], start
    while cur <= end:
        nxt = date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
        out.append((cur, min(end, nxt - timedelta(days=1))))
        cur = nxt
    return out


def slim_discover(r: dict) -> dict:
    return {
        "id": r.get("id"),
        "release_date": r.get("release_date") or None,
        "vote_count": r.get("vote_count") or 0,
        "genre_ids": r.get("genre_ids") or [],
    }


def discover_window(api: Tmdb, gte: date, lte: date) -> tuple[list[dict], int, int]:
    """All films of one window with >= MIN_VOTES votes. Returns (films, total_results, pages)."""
    films, page, total, pages = [], 1, 0, 1
    while page <= pages:
        key = f"{gte.isoformat()}_{lte.isoformat()}_v{MIN_VOTES}_p{page}"

        def fetch(page=page):
            raw = api._get(
                "/discover/movie",
                {
                    "primary_release_date.gte": gte.isoformat(),
                    "primary_release_date.lte": lte.isoformat(),
                    "vote_count.gte": MIN_VOTES,
                    "include_adult": "false",
                    "include_video": "false",
                    "sort_by": "vote_count.desc",
                    "page": page,
                },
            )
            raw = raw or {}
            return {
                "total_results": raw.get("total_results", 0),
                "total_pages": raw.get("total_pages", 0),
                "results": [slim_discover(r) for r in raw.get("results") or []],
            }

        data = api._cached("discover", key, fetch)
        total, pages = data["total_results"], min(data["total_pages"], DISCOVER_MAX_PAGES)
        films.extend(data["results"])
        page += 1
    return films, total, pages


def cmd_discover(_args) -> int:
    api = Tmdb()
    t0 = time.monotonic()
    films, capped = {}, []
    for gte, lte in tqdm(month_windows(DISCOVER_FROM, date.today()), unit="mois"):
        got, total, _ = discover_window(api, gte, lte)
        if total > DISCOVER_MAX_PAGES * 20:
            capped.append(gte.isoformat())
        for f in got:
            films[f["id"]] = f
    OUT.mkdir(parents=True, exist_ok=True)
    rows = sorted(films.values(), key=lambda f: (f["release_date"] or "", f["id"]))
    (OUT / "discover.json").write_text(json.dumps(rows), encoding="utf-8")
    print(
        f"{len(rows)} films (>= {MIN_VOTES} votes, {DISCOVER_FROM} -> {date.today()}) ; "
        f"appels HTTP {api.stats['http']}, cache {api.stats['cache_hits']}, "
        f"{time.monotonic() - t0:.0f} s ; fenêtres plafonnées : {capped or 'aucune'}"
    )
    return 0


def slim_full(raw: dict) -> dict:
    """What step 8 may use from /movie/{id} (+ credits, keywords, recommendations, similar)."""
    credits = raw.get("credits") or {}
    directors = []
    for p in credits.get("crew") or []:
        if p.get("job") == "Director" and p.get("id") not in [d["id"] for d in directors]:
            directors.append({"id": p.get("id"), "name": p.get("name")})
    cast = sorted(credits.get("cast") or [], key=lambda p: p.get("order", 999))[:10]

    def ids(block: str) -> dict:
        b = raw.get(block) or {}
        return {
            "ids": [r.get("id") for r in b.get("results") or [] if r.get("id") is not None],
            "total": b.get("total_results", 0),
        }

    return {
        "id": raw.get("id"),
        "imdb_id": raw.get("imdb_id") or None,
        "title": raw.get("title") or None,
        "original_title": raw.get("original_title") or None,
        "release_date": raw.get("release_date") or None,
        "runtime": raw.get("runtime"),
        "genres": [g.get("id") for g in raw.get("genres") or []],
        "vote_count": raw.get("vote_count") or 0,
        "vote_average": raw.get("vote_average"),
        "original_language": raw.get("original_language") or None,
        "origin_country": raw.get("origin_country") or [],
        "poster_path": raw.get("poster_path") or None,
        "overview_len": len(raw.get("overview") or ""),
        "directors": directors,
        "cast": [p.get("id") for p in cast],
        "keywords": [k.get("id") for k in (raw.get("keywords") or {}).get("keywords") or []],
        "recommendations": ids("recommendations"),
        "similar": ids("similar"),
    }


def fetch_full(api: Tmdb, tmdb_id: int) -> dict | None:
    def fetch():
        raw = api._get(
            f"/movie/{tmdb_id}",
            {"append_to_response": "credits,keywords,recommendations,similar"},
        )
        return None if raw is None else slim_full(raw)

    return api._cached("recent", str(tmdb_id), fetch)


def load_catalog() -> pl.DataFrame:
    return pl.read_parquet(CATALOG_PARQUET).select(
        "item_idx", "movie_id", "tmdb_id", "year", "ml_rating_count", "recommendable"
    )


def target_ids(discovered: list[dict], cat: pl.DataFrame) -> list[int]:
    """Every discovered film not in the catalogue (2022 -> today), plus the 2022-2023 base."""
    cat_tmdb = set(cat["tmdb_id"].drop_nulls().to_list())
    recent = [f["id"] for f in discovered if f["id"] not in cat_tmdb]
    base = cat.filter(pl.col("year").is_in([2022, 2023]) & pl.col("tmdb_id").is_not_null())
    return sorted(set(recent) | set(base["tmdb_id"].to_list()))


def cmd_fetch(_args) -> int:
    discovered = json.loads((OUT / "discover.json").read_text(encoding="utf-8"))
    ids = target_ids(discovered, load_catalog())
    api = Tmdb()
    t0 = time.monotonic()
    with ThreadPoolExecutor(WORKERS) as pool:
        got = list(tqdm(pool.map(lambda i: fetch_full(api, i), ids), total=len(ids), unit="film"))
    missing = sum(g is None for g in got)
    print(
        f"{len(ids)} fiches ({missing} absentes) ; appels HTTP {api.stats['http']}, "
        f"cache {api.stats['cache_hits']}, nouveaux essais {api.stats['retries']}, "
        f"{time.monotonic() - t0:.0f} s"
    )
    return 0


def load_details(ids: list[int]) -> dict[int, dict]:
    """Cached /movie answers (cache reader only: no credentials, no HTTP)."""
    out = {}
    for i in ids:
        f = TMDB_CACHE / "recent" / f"{i}.json"
        if f.exists():
            data = json.loads(f.read_text(encoding="utf-8"))["data"]
            if data is not None:
                out[i] = data
    return out


# --- Stats ----------------------------------------------------------------------------------------


def share(n: int, d: int) -> str:
    return f"{100 * n / d:.1f} %" if d else "—"


def neighbour_counts(films: list[dict], placed: set[int], earlier: dict[int, str] | None, field):
    """Neighbours of each film found in `placed` (plus films of `earlier` released before it)."""
    out = []
    for f in films:
        ids = field(f)
        rd = f["release_date"] or ""
        n = 0
        for i in ids:
            if i in placed or (earlier is not None and i in earlier and earlier[i] < rd):
                n += 1
        out.append(n)
    return out


def table(films: list[dict], placed: set[int], pool: dict[int, str], label: str) -> dict:
    fields = {
        "recommendations": lambda f: f["recommendations"]["ids"],
        "similar": lambda f: f["similar"]["ids"],
        "union": lambda f: list(dict.fromkeys(f["recommendations"]["ids"] + f["similar"]["ids"])),
    }
    modes = {
        "catalogue": None,
        "chronologique": pool,
        "tous": {i: "" for i in pool},  # "" sorts before every date: all pool films count
    }
    res = {}
    n = len(films)
    print(f"\n### {label} ({n} films)")
    print(
        "| voisins | mode | médiane | " + " | ".join(f"≥ {k}" for k in NEIGHBOUR_THRESHOLDS) + " |"
    )
    print("|---|---|---|" + "---|" * len(NEIGHBOUR_THRESHOLDS))
    for fname, field in fields.items():
        for mname, earlier in modes.items():
            counts = neighbour_counts(films, placed, earlier, field)
            med = float(np.median(counts)) if counts else 0.0
            shares = {k: sum(c >= k for c in counts) for k in NEIGHBOUR_THRESHOLDS}
            res[f"{fname}/{mname}"] = {"median": med, **{f"ge{k}": v for k, v in shares.items()}}
            print(
                f"| {fname} | {mname} | {med:g} | "
                + " | ".join(share(v, n) for v in shares.values())
                + " |"
            )
    return res


def cmd_stats(_args) -> int:
    cat = load_catalog()
    discovered = json.loads((OUT / "discover.json").read_text(encoding="utf-8"))
    details = load_details(target_ids(discovered, cat))
    cat_tmdb = set(cat["tmdb_id"].drop_nulls().to_list())
    report: dict = {}

    # Point 1: counts after the cutoff, by vote threshold.
    recent_disc = [f for f in discovered if (f["release_date"] or "") >= CUTOFF.isoformat()]
    print(f"## 1. Films TMDB sortis à partir du {CUTOFF} (discover, {date.today()})")
    print("| votes | tous | sans documentaires | sans doc. ni téléfilms | déjà au catalogue |")
    print("|---|---|---|---|---|")
    report["counts"] = {}
    for v in VOTE_THRESHOLDS:
        a = [f for f in recent_disc if f["vote_count"] >= v]
        b = [f for f in a if GENRE_DOCUMENTARY not in f["genre_ids"]]
        c = [f for f in b if GENRE_TV_MOVIE not in f["genre_ids"]]
        in_cat = sum(f["id"] in cat_tmdb for f in a)
        report["counts"][v] = {
            "all": len(a),
            "no_doc": len(b),
            "no_doc_tv": len(c),
            "in_cat": in_cat,
        }
        print(f"| ≥ {v} | {len(a)} | {len(b)} | {len(c)} | {in_cat} |")
    by_year: dict[str, int] = {}
    for f in recent_disc:
        by_year[(f["release_date"] or "?")[:4]] = by_year.get((f["release_date"] or "?")[:4], 0) + 1
    print(f"par année (≥ {MIN_VOTES} votes) : {by_year}")

    # Gap before the cutoff: 2022-2023 films with >= 50 votes not in the catalogue.
    pre = [f for f in discovered if (f["release_date"] or "") < CUTOFF.isoformat()]
    for y in ("2022", "2023"):
        ys = [f for f in pre if (f["release_date"] or "").startswith(y)]
        miss = [f for f in ys if f["id"] not in cat_tmdb]
        miss100 = [f for f in miss if f["vote_count"] >= 100]
        print(
            f"{y} (avant le {CUTOFF}) : {len(ys)} films TMDB ≥ {MIN_VOTES} votes, "
            f"{len(miss)} absents du catalogue (dont {len(miss100)} ≥ 100 votes)"
        )
        report[f"gap_{y}"] = {"tmdb": len(ys), "missing": len(miss), "missing_ge100": len(miss100)}

    # Point 2: recent films (>= 50 votes, no documentaries), neighbours in the catalogue.
    recent = [
        details[f["id"]]
        for f in recent_disc
        if f["id"] in details
        and f["id"] not in cat_tmdb
        and GENRE_DOCUMENTARY not in f["genre_ids"]
    ]
    pool = {f["id"]: f["release_date"] or "" for f in recent}
    print("\n## 2. Voisins TMDB des films récents (hors catalogue, sans documentaires)")
    no_rec = sum(not f["recommendations"]["ids"] for f in recent)
    print(f"sans aucune « recommendation » TMDB : {share(no_rec, len(recent))}")
    report["recent"] = {}
    for v in VOTE_THRESHOLDS:
        sub = [f for f in recent if f["vote_count"] >= v]
        report["recent"][v] = table(sub, cat_tmdb, pool, f"films récents, ≥ {v} votes")

    # Films of 2022 -> cutoff missing from the catalogue (< 20 MovieLens ratings): same gap.
    gap = [
        details[f["id"]]
        for f in pre
        if f["id"] in details
        and f["id"] not in cat_tmdb
        and GENRE_DOCUMENTARY not in f["genre_ids"]
    ]
    gap_pool = {**pool, **{f["id"]: f["release_date"] or "" for f in gap}}
    report["gap"] = table(gap, cat_tmdb, gap_pool, "films 2022 → 12/10/2023 absents, ≥ 50 votes")

    # Where do the neighbours of recent films come from?
    tot = in_cat = in_pool = 0
    for f in recent:
        for i in f["recommendations"]["ids"]:
            tot += 1
            in_cat += i in cat_tmdb
            in_pool += i in pool
    print(
        f"\n« recommendations » des films récents : {share(in_cat, tot)} au catalogue, "
        f"{share(in_pool, tot)} parmi les films récents placés, "
        f"{share(tot - in_cat - in_pool, tot)} ailleurs"
    )

    # Point 3: catalogue films 2022-2023 (false cold start), neighbours before 2022.
    base_cat = cat.filter(pl.col("year").is_in([2022, 2023]) & pl.col("tmdb_id").is_not_null())
    base = [details[i] for i in base_cat["tmdb_id"].to_list() if i in details]
    base_ids = {f["id"] for f in base}
    old_cat = cat_tmdb - base_ids
    base_pool = {f["id"]: f["release_date"] or "" for f in base}
    print("\n## 3. Films 2022-2023 du catalogue (faux départ à froid : voisins avant 2022)")
    no_rec = sum(not f["recommendations"]["ids"] for f in base)
    print(f"sans aucune « recommendation » TMDB : {share(no_rec, len(base))}")
    report["base"] = table(base, old_cat, base_pool, "films 2022-2023 du catalogue")
    for v in VOTE_THRESHOLDS:
        sub = [f for f in base if f["vote_count"] >= v]
        print(f"  dont ≥ {v} votes TMDB : {len(sub)}")
    tot = n_old = n_base = n_after = 0
    recent_ids = set(pool)
    for f in base:
        for i in f["recommendations"]["ids"]:
            tot += 1
            n_old += i in old_cat
            n_base += i in base_ids
            n_after += i in recent_ids
    print(
        f"« recommendations » des films 2022-2023 : {share(n_old, tot)} au catalogue avant 2022, "
        f"{share(n_base, tot)} parmi les 2022-2023, {share(n_after, tot)} films récents"
    )
    vc = sorted(f["vote_count"] for f in base)
    vr = sorted(f["vote_count"] for f in recent)
    print(
        f"votes TMDB médians : films 2022-2023 du catalogue {vc[len(vc) // 2]}, "
        f"films récents ≥ {MIN_VOTES} votes {vr[len(vr) // 2]}"
    )
    content = {
        "directeur": sum(bool(f["directors"]) for f in recent),
        "mots-clés": sum(bool(f["keywords"]) for f in recent),
        "acteurs": sum(bool(f["cast"]) for f in recent),
        "résumé": sum(f["overview_len"] > 0 for f in recent),
        "affiche": sum(bool(f["poster_path"]) for f in recent),
        "imdb_id": sum(bool(f["imdb_id"]) for f in recent),
    }
    print(
        "contenu disponible (films récents) : "
        + ", ".join(f"{k} {share(v, len(recent))}" for k, v in content.items())
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "stats.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


# --- Preview: neighbour means vs true vectors (2022-2023) -----------------------------------------


def cmd_preview(_args) -> int:
    """Rough look only (D5 is the real evaluation): cosine(estimate, true vector)."""
    info = json.loads((MODELS / "als_final_info.json").read_text(encoding="utf-8"))
    vec = np.load(MODELS / "als_final_f64_r0.05_a1_b1_i30_item_factors.npy")
    mids = np.load(MODELS / "als_final_movie_ids.npy")
    del info
    cat = load_catalog()
    row_of = {int(m): k for k, m in enumerate(mids)}
    tmdb_to_row = {
        int(t): row_of[int(m)]
        for t, m in zip(cat["tmdb_id"].to_list(), cat["movie_id"].to_list(), strict=True)
        if t is not None and int(m) in row_of
    }
    base_cat = cat.filter(pl.col("year").is_in([2022, 2023]) & pl.col("tmdb_id").is_not_null())
    details = load_details(base_cat["tmdb_id"].to_list())
    base_ids = set(details)
    old_rows = np.array([r for t, r in tmdb_to_row.items() if t not in base_ids])
    rng = np.random.default_rng(42)

    def cos(a, b):
        return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

    mu = vec[old_rows].mean(0)
    true_norms = np.linalg.norm(vec[[tmdb_to_row[t] for t in details if t in tmdb_to_row]], axis=1)
    print(
        f"normes des vrais vecteurs 2022-2023 : médiane {np.median(true_norms):.3f} ; "
        f"films avant 2022 : {np.median(np.linalg.norm(vec[old_rows], axis=1)):.3f}"
    )
    sources = {
        "recommendations": lambda f: f["recommendations"]["ids"],
        "similar": lambda f: f["similar"]["ids"],
        "union": lambda f: list(dict.fromkeys(f["recommendations"]["ids"] + f["similar"]["ids"])),
    }
    print("| voisins | k | poids | films | cos | cos centré | hasard (centré) | norme est./vraie |")
    print("|---|---|---|---|---|---|---|---|")
    for sname, src in sources.items():
        for k in (5, 10, 40):
            for weight in ("rang", "égal"):
                rows = []
                for t, f in details.items():
                    nb = [tmdb_to_row[i] for i in src(f) if i in tmdb_to_row and i not in base_ids]
                    nb = nb[:k]
                    if len(nb) < 3 or t not in tmdb_to_row:
                        continue
                    true = vec[tmdb_to_row[t]]
                    w = 1.0 / np.arange(1, len(nb) + 1) if weight == "rang" else np.ones(len(nb))
                    est = (vec[nb] * w[:, None]).sum(0) / w.sum()
                    rand = vec[rng.choice(old_rows, len(nb), replace=False)].mean(0)
                    rows.append(
                        (
                            cos(est, true),
                            cos(est - mu, true - mu),
                            cos(rand - mu, true - mu),
                            np.linalg.norm(est) / np.linalg.norm(true),
                        )
                    )
                a = np.array(rows)
                print(
                    f"| {sname} | {k} | {weight} | {len(a)} | {np.median(a[:, 0]):.3f} | "
                    f"{np.median(a[:, 1]):.3f} | {np.median(a[:, 2]):.3f} | "
                    f"{np.median(a[:, 3]):.2f} |"
                )
    return 0


# --- Point 4: exports (counts only) ---------------------------------------------------------------


def cmd_exports(args) -> int:
    discovered = json.loads((OUT / "discover.json").read_text(encoding="utf-8"))
    cat = load_catalog()
    details = load_details(target_ids(discovered, cat))
    cat_tmdb = set(cat["tmdb_id"].drop_nulls().to_list())
    missing = [d for d in details.values() if d["id"] not in cat_tmdb and d["release_date"]]
    by_key: dict[tuple[str, int], dict] = {}
    by_imdb = {d["imdb_id"]: d for d in missing if d["imdb_id"]}
    for d in missing:
        y = int(d["release_date"][:4])
        for t in {d["title"], d["original_title"]} - {None}:
            by_key[(normalize_title(t), y)] = d

    def lookup(e: dict) -> dict | None:
        if e.get("imdb_id") and e["imdb_id"] in by_imdb:
            return by_imdb[e["imdb_id"]]
        for t in {e["title"], e.get("original_title")} - {None}:
            for dy in (0, -1, 1):
                hit = by_key.get((normalize_title(t), e["year"] + dy))
                if hit is not None:
                    return hit
        return None

    for n, path in enumerate(args.reports, 1):
        rep = json.loads(Path(path).read_text(encoding="utf-8"))
        nf = [
            e
            for e in rep["entries"]
            if e["status"] == "not_found" and e.get("reason") != "non_film" and e["year"]
        ]
        groups = {
            "≥ 2024 (« trop récents »)": [e for e in nf if e["year"] >= 2024],
            "2022-2023": [e for e in nf if e["year"] in (2022, 2023)],
        }
        print(
            f"export {n} : {rep['n_entries']} entrées, {rep['counts']['exact']} exact, "
            f"{len(nf)} non trouvés (datés, hors séries IMDb)"
        )
        for label, es in groups.items():
            hits = [lookup(e) for e in es]
            hits = [h for h in hits if h is not None]
            after = sum((h["release_date"] or "") >= CUTOFF.isoformat() for h in hits)
            votes = sorted(h["vote_count"] for h in hits)
            print(
                f"  {label} : {len(es)} ; retrouvés parmi les films TMDB ≥ {MIN_VOTES} votes "
                f"absents du catalogue : {len(hits)} (dont {after} sortis après le {CUTOFF})"
                + (f", votes médians {votes[len(votes) // 2]}, min {votes[0]}" if votes else "")
            )
    return 0


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("discover").set_defaults(fn=cmd_discover)
    sub.add_parser("fetch").set_defaults(fn=cmd_fetch)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    sub.add_parser("preview").set_defaults(fn=cmd_preview)
    e = sub.add_parser("exports")
    e.add_argument("reports", nargs="+")
    e.set_defaults(fn=cmd_exports)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
