"""Step 8 (docs/etape-8-films-recents.md): TMDB data for the films missing from MovieLens 32M.

R1 — collection (TMDB only, never an IMDb dataset):

    uv run python recent_films.py collect   # /discover 2018 -> today, then one /movie call per film
    uv run python recent_films.py table     # data/processed/tmdb_films.parquet + genre agreement
    uv run python recent_films.py popularity   # D7 slider popularity of the missing films
    uv run python recent_films.py popularity-check   # R3d: controls (a) (b) (c) + figure

- `/discover/movie` by month (>= 50 votes): vote counts of every TMDB film since 2018 (reference
  of the slider popularity, D7) and the list of films missing from the catalogue (D0).
- one `/movie/{id}?append_to_response=credits,keywords,recommendations,similar` per film of the
  catalogue (23 019, content model D2) and per missing film released since 2022 (D0).

Answers are slimmed and cached in `data/cache/tmdb/{discover,full}/` (ignored by git; reused
< 30 days, deleted > 6 months, as `enrich_tmdb.py`). Output tables in `data/processed/`
(ignored by git).
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

import popularity as popm
from build_catalog import CATALOG_PARQUET
from config import PROCESSED
from enrich_tmdb import TMDB_CACHE, WORKERS, Tmdb
from models import coldstart as cs

CUTOFF = date(2023, 10, 13)  # first day after the last MovieLens 32M rating (2023-10-12)
FIRST_YEAR = 2022  # D0: missing films released since 2022-01-01 are placed
DISCOVER_FROM = date(2010, 1, 1)  # D7 references (2019-2022 adopted; older ones compared)
MIN_VOTES = 50  # D0: placed from 50 TMDB votes
MIN_VOTES_RECOMMENDABLE = 100  # D0 v0.2 (kept for the reports)
MIN_VOTES_RECOMMENDABLE_V03 = 500  # D0 v0.3: the 50-499 votes bin failed the cold-start test
DISCOVER_MAX_PAGES = 500  # TMDB caps /discover at page 500
FULL_KIND = "full"  # cache sub-folder of the full /movie answers
GENRE_DOCUMENTARY = 99
GENRE_TV_MOVIE = 10770
DISCOVER_PARQUET = PROCESSED / "tmdb_discover.parquet"
FILMS_PARQUET = PROCESSED / "tmdb_films.parquet"

# TMDB genre id -> MovieLens genre (D7, calibration). History (36) and TV Movie (10770): none.
TMDB_TO_ML_GENRE = {
    28: "Action",
    12: "Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    99: "Documentary",
    18: "Drama",
    10751: "Children",
    14: "Fantasy",
    27: "Horror",
    10402: "Musical",
    9648: "Mystery",
    10749: "Romance",
    878: "Sci-Fi",
    53: "Thriller",
    10752: "War",
    37: "Western",
}


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


def discover_window(api: Tmdb, gte: date, lte: date) -> tuple[list[dict], int]:
    """All films of one window with >= MIN_VOTES votes. Returns (films, total_results)."""
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
    return films, total


def discover_all(api: Tmdb, start: date = DISCOVER_FROM, end: date | None = None) -> list[dict]:
    films, capped = {}, []
    for gte, lte in tqdm(month_windows(start, end or date.today()), unit="mois"):
        got, total = discover_window(api, gte, lte)
        if total > DISCOVER_MAX_PAGES * 20:
            capped.append(gte.isoformat())
        for f in got:
            films[f["id"]] = f
    if capped:
        raise RuntimeError(f"fenêtres /discover plafonnées (500 pages) : {capped}")
    return sorted(films.values(), key=lambda f: (f["release_date"] or "", f["id"]))


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

    return api._cached(FULL_KIND, str(tmdb_id), fetch)


def read_full(tmdb_id: int) -> dict | None:
    """Cached full answer (no HTTP, no credentials). None if absent or 404."""
    f = TMDB_CACHE / FULL_KIND / f"{tmdb_id}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))["data"]


def catalog_frame() -> pl.DataFrame:
    return pl.read_parquet(CATALOG_PARQUET).select(
        "item_idx",
        "movie_id",
        "tmdb_id",
        "year",
        "ml_genres",
        "ml_rating_count",
        "tmdb_vote_count",
        "recommendable",
    )


def missing_ids(discovered: list[dict], catalog_tmdb: set[int]) -> list[int]:
    """D0: discovered films (>= 50 votes) not in the catalogue, released since FIRST_YEAR."""
    first = date(FIRST_YEAR, 1, 1).isoformat()
    return [
        f["id"]
        for f in discovered
        if f["id"] not in catalog_tmdb and (f["release_date"] or "") >= first
    ]


def cmd_collect(_args) -> int:
    api = Tmdb()
    t0 = time.monotonic()
    discovered = discover_all(api)
    pl.DataFrame(discovered, schema_overrides={"genre_ids": pl.List(pl.Int64)}).write_parquet(
        DISCOVER_PARQUET
    )
    cat = catalog_frame()
    cat_tmdb = set(cat["tmdb_id"].drop_nulls().to_list())
    ids = sorted(cat_tmdb | set(missing_ids(discovered, cat_tmdb)))
    with ThreadPoolExecutor(WORKERS) as pool:
        got = list(tqdm(pool.map(lambda i: fetch_full(api, i), ids), total=len(ids), unit="film"))
    print(
        f"discover : {len(discovered)} films ({DISCOVER_FROM} -> {date.today()}) ; fiches : "
        f"{len(ids)} ({sum(g is None for g in got)} absentes) ; appels HTTP {api.stats['http']}, "
        f"cache {api.stats['cache_hits']}, nouveaux essais {api.stats['retries']}, "
        f"{time.monotonic() - t0:.0f} s"
    )
    return 0


# --- Table --------------------------------------------------------------------------------------


def films_table(cat: pl.DataFrame, discovered: pl.DataFrame) -> pl.DataFrame:
    """One row per TMDB film with a full answer: catalogue films and missing films (D0)."""
    cat_rows = {
        int(t): (int(i), int(m))
        for t, i, m in zip(
            cat["tmdb_id"].to_list(),
            cat["item_idx"].to_list(),
            cat["movie_id"].to_list(),
            strict=True,
        )
        if t is not None
    }
    ids = sorted(set(cat_rows) | set(missing_ids(discovered.to_dicts(), set(cat_rows))))
    rows = []
    for t in ids:
        d = read_full(t)
        if d is None:
            continue
        item_idx, movie_id = cat_rows.get(t, (None, None))
        rows.append(
            {
                "tmdb_id": t,
                "in_catalog": item_idx is not None,
                "item_idx": item_idx,
                "movie_id": movie_id,
                "imdb_id": d["imdb_id"],
                "title": d["title"],
                "original_title": d["original_title"],
                "release_date": d["release_date"],
                "year": int(d["release_date"][:4]) if d["release_date"] else None,
                "runtime": d["runtime"],
                "genres": d["genres"],
                "vote_count": d["vote_count"],
                "vote_average": d["vote_average"],
                "original_language": d["original_language"],
                "origin_country": d["origin_country"],
                "poster_path": d["poster_path"],
                "overview_len": d["overview_len"],
                "director_ids": [p["id"] for p in d["directors"]],
                "director_names": [p["name"] for p in d["directors"]],
                "cast": d["cast"],
                "keywords": d["keywords"],
                "recommendations": d["recommendations"]["ids"],
                "similar": d["similar"]["ids"],
            }
        )
    lists = {
        c: pl.List(pl.Int64)
        for c in ("genres", "director_ids", "cast", "keywords", "recommendations", "similar")
    }
    return pl.DataFrame(
        rows,
        schema_overrides={
            **lists,
            "item_idx": pl.Int64,
            "movie_id": pl.Int64,
            "year": pl.Int64,
            "runtime": pl.Int64,
            "vote_average": pl.Float64,
            "origin_country": pl.List(pl.String),
            "director_names": pl.List(pl.String),
        },
    )


def ml_genres_of(tmdb_genres: list[int]) -> list[str]:
    """MovieLens genres of a TMDB genre list (D7), in TMDB order, without duplicates."""
    out = []
    for g in tmdb_genres:
        name = TMDB_TO_ML_GENRE.get(g)
        if name is not None and name not in out:
            out.append(name)
    return out


def genre_agreement(films: pl.DataFrame, cat: pl.DataFrame) -> list[dict]:
    """Per MovieLens genre, on catalogue films: precision and recall of the TMDB mapping."""
    ml = dict(zip(cat["tmdb_id"].to_list(), cat["ml_genres"].to_list(), strict=True))
    stats: dict[str, list[int]] = {}
    for t, genres in zip(
        films.filter("in_catalog")["tmdb_id"].to_list(),
        films.filter("in_catalog")["genres"].to_list(),
        strict=True,
    ):
        g = ml.get(t) or []
        truth = set(g.split("|") if isinstance(g, str) else g) - {"", "(no genres listed)"}
        mapped = set(ml_genres_of(genres))
        for g in truth | mapped | set(TMDB_TO_ML_GENRE.values()):
            s = stats.setdefault(g, [0, 0, 0])  # both, mapped only, MovieLens only
            if g in truth and g in mapped:
                s[0] += 1
            elif g in mapped:
                s[1] += 1
            elif g in truth:
                s[2] += 1
    out = []
    for g, (both, fp, fn) in sorted(stats.items()):
        out.append(
            {
                "genre": g,
                "movielens": both + fn,
                "tmdb_mapped": both + fp,
                "precision": both / (both + fp) if both + fp else None,
                "recall": both / (both + fn) if both + fn else None,
            }
        )
    return out


def cmd_table(_args) -> int:
    cat = catalog_frame()
    discovered = pl.read_parquet(DISCOVER_PARQUET)
    films = films_table(cat, discovered)
    films.write_parquet(FILMS_PARQUET)
    n_cat = int(films["in_catalog"].sum())
    miss = films.filter(~pl.col("in_catalog"))
    print(
        f"{films.height} fiches : {n_cat} films du catalogue (sur {cat.height}), "
        f"{miss.height} films absents depuis {FIRST_YEAR} "
        f"(dont {int((miss['vote_count'] >= MIN_VOTES_RECOMMENDABLE).sum())} ≥ "
        f"{MIN_VOTES_RECOMMENDABLE} votes, "
        f"{int((miss['release_date'] >= CUTOFF.isoformat()).sum())} sortis à partir du {CUTOFF})"
    )
    print("\n| genre MovieLens | films ML | films TMDB traduits | précision | rappel |")
    print("|---|---|---|---|---|")
    for r in genre_agreement(films, cat):
        p = "—" if r["precision"] is None else f"{100 * r['precision']:.0f} %"
        rc = "—" if r["recall"] is None else f"{100 * r['recall']:.0f} %"
        print(f"| {r['genre']} | {r['movielens']} | {r['tmdb_mapped']} | {p} | {rc} |")
    return 0


REFERENCE_YEARS = (2019, 2022)  # D7 (v0.2): reference distribution of the slider popularity
SLIDER_CAPS = (20_000, 10_000, 5_000, 2_000, 1_000, 500, 200)


def recent_popularity(
    discovered: pl.DataFrame,
    missing: pl.DataFrame,
    reference_years=REFERENCE_YEARS,
    rule: str = "percentile",
) -> tuple[np.ndarray, dict]:
    """D7 popularity of the missing films: rank of their TMDB votes within the release year
    (among the TMDB films of that year, >= 50 votes), mapped to the popularity distribution of
    the TMDB films of 2019-2022 (catalogue: popularity.bin formula; others: r_ref x votes)."""
    pop_cat, info = popm.production_popularity(CATALOG_PARQUET)
    r_ref = info["r_ref"]
    cat = catalog_frame()
    pop_of = {
        int(t): int(p)
        for t, p in zip(cat["tmdb_id"].to_list(), pop_cat.tolist(), strict=True)
        if t is not None
    }
    disc = discovered.with_columns(
        year=pl.col("release_date").str.slice(0, 4).cast(pl.Int64, strict=False)
    )
    lo, hi = reference_years
    ref = disc.filter(pl.col("year").is_between(lo, hi))
    ref_pop = [
        pop_of.get(t, round(r_ref * v))
        for t, v in zip(ref["id"].to_list(), ref["vote_count"].to_list(), strict=True)
    ]
    out = np.zeros(missing.height, dtype=np.int64)
    years = missing["year"].to_numpy()
    votes = missing["vote_count"].to_numpy().astype(np.float64)
    info = {
        "r_ref": r_ref,
        "n_reference": len(ref_pop),
        "reference_years": [lo, hi],
        "reference": np.asarray(ref_pop),
        "rule": rule,
        "pop_of": pop_of,
    }
    if rule == "rank":  # R3c: r-th most voted film of its year <- r-th most popular reference
        by_rank = cs.reference_by_rank(
            [
                [
                    pop_of.get(t, round(r_ref * v))
                    for t, v in zip(d["id"].to_list(), d["vote_count"].to_list(), strict=True)
                ]
                for d in (disc.filter(pl.col("year") == y) for y in range(lo, hi + 1))
            ]
        )
        for y in np.unique(years):
            sel = np.flatnonzero(years == y)
            same = np.sort(
                disc.filter(pl.col("year") == int(y))["vote_count"].to_numpy().astype(float)
            )[::-1]
            ranks = [int(np.searchsorted(-same, -v, side="left")) for v in votes[sel]]
            out[sel] = cs.absolute_rank_popularity(ranks, by_rank, votes[sel], r_ref)
        return out, info
    for y in np.unique(years):
        sel = np.flatnonzero(years == y)
        same = disc.filter(pl.col("year") == int(y))["vote_count"].to_numpy().astype(np.float64)
        allv = np.concatenate([same, votes[sel]])
        pct = cs.within_year_percentile(allv, np.zeros(len(allv)))[len(same) :]
        out[sel] = cs.rank_popularity(pct, ref_pop, votes[sel], r_ref)
    return out, info


def cmd_popularity(args) -> int:
    films = pl.read_parquet(FILMS_PARQUET)
    missing = films.filter(~pl.col("in_catalog") & (pl.col("vote_count") >= MIN_VOTES))
    ref_years = tuple(int(x) for x in args.ref.split("-"))
    disc = pl.read_parquet(DISCOVER_PARQUET)
    pop, info = recent_popularity(disc, missing, ref_years, args.rule)
    missing = missing.with_columns(popularity=pl.Series(pop))
    print(
        f"règle {info['rule']}, référence {info['reference_years']} : "
        f"{info['n_reference']} films TMDB ≥ {MIN_VOTES} "
        f"votes ; r_ref {info['r_ref']:.4f} ; part sous chaque plafond : "
        + ", ".join(f"≤ {c} {100 * (info['reference'] <= c).mean():.0f} %" for c in SLIDER_CAPS)
    )
    print("\n| films absents | n | " + " | ".join(f"≤ {c}" for c in SLIDER_CAPS) + " |")
    print("|---|---|" + "---|" * len(SLIDER_CAPS))
    pop_bin = popm.production_popularity(CATALOG_PARQUET)[0]

    def row(label: str, p: np.ndarray) -> None:
        cells = " | ".join(f"{100 * (p <= c).mean():.0f} %" for c in SLIDER_CAPS)
        print(f"| {label} | {len(p)} | {cells} |")

    for y in sorted(missing["year"].unique().to_list()):
        row(str(y), missing.filter(pl.col("year") == y)["popularity"].to_numpy())
    row("tous", missing["popularity"].to_numpy())
    row("catalogue (popularity.bin)", pop_bin)
    cat = catalog_frame()
    for lo, hi in ((2019, 2022),):
        sel = cat["year"].is_between(lo, hi).fill_null(False).to_numpy()
        row(f"catalogue {lo}-{hi}", pop_bin[sel])
    rec = missing.filter(pl.col("vote_count") >= MIN_VOTES_RECOMMENDABLE_V03)
    row(f"recommandables (≥ {MIN_VOTES_RECOMMENDABLE_V03} votes)", rec["popularity"].to_numpy())
    est = dict(zip(missing["tmdb_id"].to_list(), missing["popularity"].to_list(), strict=True))
    years_disc = disc.with_columns(
        year=pl.col("release_date").str.slice(0, 4).cast(pl.Int64, strict=False)
    )
    print("\ncontrôle v0.3 : 10 films les plus votés de chaque année (catalogue compris) < 10 000")
    failed = False
    for y in sorted(missing["year"].unique().to_list()):
        top = years_disc.filter(pl.col("year") == y).sort("vote_count", descending=True).head(10)
        p = [est.get(t, info["pop_of"].get(t)) for t in top["id"].to_list()]
        under = sum(x is not None and x < 10_000 for x in p)
        failed |= under > 0
        print(f"  {y} : {under}/10 sous 10 000 ; popularités {p}")
    print("  contrôle : " + ("échoue" if failed else "atteint"))
    print("\nles 10 films absents les plus votés de chaque année (popularité D7) :")
    for y in sorted(missing["year"].unique().to_list()):
        top = missing.filter(pl.col("year") == y).sort("vote_count", descending=True).head(10)
        above = int((top["popularity"] > 20_000).sum())
        print(
            f"  {y} : {above}/10 au-dessus de 20 000 ; votes {top['vote_count'].to_list()} ; "
            f"popularité {top['popularity'].to_list()}"
        )
    return 0


# --- R3d: popularity rule of step 8 (catalogue from 2019 + estimated films) -----------------------

RANK_WINDOWS = {1: (1, 3), 10: (9, 11), 100: (95, 105)}  # "popularity at rank r" = window median
FIGURE = Path(__file__).resolve().parent.parent / "docs" / "figures" / "etape8-popularite-rangs.png"


def estimated_popularity(
    missing: pl.DataFrame, disc: pl.DataFrame, pop_of_tmdb: dict[int, int], r_ref: float
) -> np.ndarray:
    """D7 (v0.4): the rank rule of popularity.py; base = r_ref x votes (no MovieLens count)."""
    votes = missing["vote_count"].to_numpy().astype(np.float64)
    pop, _ = popm.rank_corrected(
        np.rint(r_ref * votes).astype(np.int64),
        missing["tmdb_id"].to_list(),
        missing["year"].cast(pl.Float64).fill_null(np.nan).to_numpy(),
        votes,
        disc,
        r_ref,
        first_year=FIRST_YEAR,  # every estimated film (released since 2022)
        pop_of_tmdb=pop_of_tmdb,
    )
    return pop


def year_profile(disc: pl.DataFrame, pop_of: dict[int, int], year: int) -> list[int | None]:
    d = disc.filter(pl.col("year") == year).sort(["vote_count", "id"], descending=[True, False])
    return [pop_of.get(t) for t in d["id"].to_list()]


def window_median(profile: list[int | None], lo: int, hi: int) -> float | None:
    vals = [p for p in profile[lo - 1 : hi] if p is not None]
    return float(np.median(vals)) if vals else None


def cmd_popularity_check(_args) -> int:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    new_cat, info = popm.production_popularity_v8(CATALOG_PARQUET, DISCOVER_PARQUET)
    old_cat = info["year_all"]
    r_ref = info["r_ref"]
    cat = catalog_frame()
    disc = popm.discover_frame(DISCOVER_PARQUET)
    tmdb = cat["tmdb_id"].to_list()
    films = pl.read_parquet(FILMS_PARQUET)
    missing = films.filter(~pl.col("in_catalog") & (pl.col("vote_count") >= MIN_VOTES))
    ref_pop = {int(t): int(p) for t, p in zip(tmdb, new_cat.tolist(), strict=True) if t is not None}
    est_new = estimated_popularity(missing, disc, ref_pop, r_ref)
    old_ref = {int(t): int(p) for t, p in zip(tmdb, old_cat.tolist(), strict=True) if t is not None}
    est_old, _ = recent_popularity(pl.read_parquet(DISCOVER_PARQUET), missing, REFERENCE_YEARS)
    mids = missing["tmdb_id"].to_list()
    pop_new = {**ref_pop, **dict(zip(mids, est_new.tolist(), strict=True))}
    pop_old = {**old_ref, **dict(zip(mids, est_old.tolist(), strict=True))}
    print(
        f"règle : rang des votes dans l'année à partir de {info['rank_first_year']}, référence "
        f"{info['rank_reference_years']} ; 10 premiers rangs : {info['rank_table_head']}"
    )
    changed = int((new_cat != old_cat).sum())
    print(
        f"catalogue : {changed} films relevés (aucun baissé : {bool((new_cat >= old_cat).all())})"
    )

    # (a)
    print("\n(a) 10 films les plus votés de chaque année ≥ 2019 : aucun sous 10 000")
    ok_a = True
    for y in range(info["rank_first_year"], date.today().year + 1):
        top = year_profile(disc, pop_new, y)[:10]
        under = sum(p is not None and p < 10_000 for p in top)
        ok_a &= under == 0
        print(f"  {y} : {under}/10 sous 10 000 ; {top}")
    print("  (a) " + ("atteint" if ok_a else "échoue"))

    # (b)
    years = list(range(2010, date.today().year + 1))
    rows = {"avant": {}, "après": {}}
    for label, pop_of in (("avant", pop_old), ("après", pop_new)):
        for y in years:
            prof = year_profile(disc, pop_of, y)
            rows[label][y] = {r: window_median(prof, *w) for r, w in RANK_WINDOWS.items()}
    print("\n(b) popularité médiane aux rangs 1 (1-3), 10 (9-11), 100 (95-105), avant → après")
    print("| année | rang 1 | rang 10 | rang 100 |")
    print("|---|---|---|---|")

    def fmt(x):
        return "—" if x is None else f"{x:,.0f}".replace(",", " ")

    for y in years:
        cells = [f"{fmt(rows['avant'][y][r])} → {fmt(rows['après'][y][r])}" for r in RANK_WINDOWS]
        print(f"| {y} | " + " | ".join(cells) + " |")
    ok_b = True
    lo, hi = popm.RANK_REFERENCE_YEARS
    y0 = info["rank_first_year"]
    for r in RANK_WINDOWS:
        steps = [abs(np.log(rows["après"][y + 1][r] / rows["après"][y][r])) for y in range(lo, hi)]
        jump = abs(np.log(rows["après"][y0][r] / rows["après"][y0 - 1][r]))
        ok = jump <= max(steps)
        ok_b &= ok
        print(
            f"  rang {r} : saut {y0 - 1} → {y0} = ×{np.exp(jump):.2f} ; plus grand saut "
            f"{lo}-{hi} = ×{np.exp(max(steps)):.2f} → {'ok' if ok else 'saut'}"
        )
    print("  (b) " + ("atteint" if ok_b else "échoue"))

    # (c)
    print("\n(c) part des films recommandables sous 2 000 / 500 / 200, avant → après")
    rec = cat["recommendable"].to_numpy()

    def shares(p):
        return " / ".join(f"{100 * (p <= c).mean():.1f} %" for c in (2_000, 500, 200))

    print(f"  catalogue ({int(rec.sum())}) : {shares(old_cat[rec])} → {shares(new_cat[rec])}")
    recent = cat["year"].fill_null(0).to_numpy() >= y0
    print(
        f"  catalogue ≥ {y0} ({int((rec & recent).sum())}) : {shares(old_cat[rec & recent])} → "
        f"{shares(new_cat[rec & recent])}"
    )
    r500 = missing["vote_count"].to_numpy() >= MIN_VOTES_RECOMMENDABLE_V03
    print(
        f"  estimés ≥ 500 votes ({int(r500.sum())}) : {shares(est_old[r500])} → "
        f"{shares(est_new[r500])}"
    )

    # figure
    fig, ax = plt.subplots(figsize=(8, 4.5))
    colors = {1: "#2f4bd8", 10: "#1f8a5b", 100: "#b0306a"}
    for r, c in colors.items():
        for label, style in (("avant", "--"), ("après", "-")):
            ys = [rows[label][y][r] for y in years]
            ax.plot(years, ys, style, color=c, label=f"rang {r}, {label}", linewidth=1.6)
    ax.axvline(y0 - 0.5, color="#888", linewidth=0.8)
    ax.axhline(10_000, color="#888", linewidth=0.8, linestyle=":")
    ax.set_yscale("log")
    ax.set_xlabel("année de sortie")
    ax.set_ylabel("popularité du curseur (médiane autour du rang)")
    ax.set_title("Popularité des films classés 1, 10 et 100 par votes TMDB dans leur année")
    ax.legend(fontsize=8, ncol=3)
    fig.tight_layout()
    fig.savefig(FIGURE, dpi=120)
    print(f"\nfigure : {FIGURE.relative_to(FIGURE.parent.parent.parent)}")
    return 0 if ok_a and ok_b else 1


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("collect").set_defaults(fn=cmd_collect)
    sub.add_parser("table").set_defaults(fn=cmd_table)
    pp = sub.add_parser("popularity")
    pp.add_argument("--ref", default=f"{REFERENCE_YEARS[0]}-{REFERENCE_YEARS[1]}")
    pp.add_argument("--rule", choices=("percentile", "rank"), default="percentile")
    pp.set_defaults(fn=cmd_popularity)
    sub.add_parser("popularity-check").set_defaults(fn=cmd_popularity_check)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
