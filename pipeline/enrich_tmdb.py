"""Enrich the catalogue with TMDB metadata (B4).

Reads `data/processed/catalog.parquet` (built by `build_catalog.py`) and adds, from TMDB only:
tmdb_title, tmdb_original_title, tmdb_release_year, tmdb_directors, poster_path, tmdb_vote_count,
original_language, origin_country, tmdb_imdb_id, plus `year` (tmdb_release_year, else ml_year: the
displayed year and the first one used to match Letterboxd exports, which rely on TMDB data).

TMDB calls (never the website; credentials from `.env` only, never logged):
- movies without tmdb_id, and movies not found in the IMDb datasets: /find/{imdb_id};
- every movie: ONE /movie/{tmdb_id}?append_to_response=credits;
- 100 % check: the imdb_id TMDB returns must equal ours. Otherwise /find/{our imdb_id}: a movie
  result replaces the tmdb_id (`tmdb_id_corrected`), else `tmdb_mismatch`. Nothing is dropped.

Cache: `data/cache/tmdb/{movie,find}/` holds one slim JSON per call (useful fields + director
names, no cast) with its fetch date; reused when < 30 days old, deleted when > 6 months old (TMDB
terms). The script resumes from the cache.

Usage (from `pipeline/`):
    uv run python enrich_tmdb.py --limit 50   # first 50 movies, report only, catalogue untouched
    uv run python enrich_tmdb.py              # all movies, rewrites catalog.parquet
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import polars as pl
import requests
from tqdm import tqdm

from build_catalog import CATALOG_COLUMNS, CATALOG_PARQUET, MERGES_PARQUET
from config import CACHE, PROCESSED

API_BASE = "https://api.themoviedb.org/3"
TMDB_CACHE = CACHE / "tmdb"
MISMATCH_CSV = PROCESSED / "tmdb_mismatch.csv"
MISMATCH_REPORT_COLUMNS = (
    "movie_id",
    "imdb_id",
    "ml_tmdb_id",
    "tmdb_id",
    "tmdb_mismatch_reason",
    "imdbds_found",
    "tmdb_imdb_id",
    "ml_title",
    "ml_year",
    "tmdb_title",
    "tmdb_release_year",
    "ml_rating_count",
)
CACHE_REUSE = timedelta(days=30)
CACHE_MAX_AGE = timedelta(days=182)  # TMDB terms: cached data must not be kept > 6 months

# TMDB docs (rate-limiting page, 2026-11): upper limit "somewhere in the 40 requests per second
# range", respect 429. We stay at half of it.
MAX_REQUESTS_PER_SECOND = 20
WORKERS = 8
MAX_RETRIES = 6

ENRICHED_COLUMNS = (
    "ml_tmdb_id",  # tmdb_id as built by B3 (links.csv), kept for provenance
    "tmdb_title",
    "tmdb_original_title",
    "tmdb_release_year",
    "year",
    "tmdb_directors",
    "poster_path",
    "tmdb_vote_count",
    "original_language",
    "origin_country",
    "tmdb_imdb_id",
    "tmdb_id_corrected",
    "tmdb_mismatch",
    "tmdb_mismatch_reason",
    "imdb_id_outdated",
    "imdb_id_aliases",
)


# --- Pure helpers (unit tested) -------------------------------------------------------------------


def release_year(release_date: str | None) -> int | None:
    if not release_date or len(release_date) < 4 or not release_date[:4].isdigit():
        return None
    return int(release_date[:4])


def slim_movie(raw: dict) -> dict:
    """Keep only what the pipeline uses from /movie/{id}?append_to_response=credits."""
    crew = (raw.get("credits") or {}).get("crew") or []
    directors = []
    for person in crew:
        if person.get("job") == "Director" and person.get("name") not in directors:
            directors.append(person.get("name"))
    return {
        "id": raw.get("id"),
        "imdb_id": raw.get("imdb_id") or None,
        "title": raw.get("title") or None,
        "original_title": raw.get("original_title") or None,
        "release_date": raw.get("release_date") or None,
        "poster_path": raw.get("poster_path") or None,
        "vote_count": raw.get("vote_count"),
        "original_language": raw.get("original_language") or None,
        "origin_country": raw.get("origin_country") or [],
        "directors": directors,
    }


def slim_find(raw: dict) -> dict:
    movies = raw.get("movie_results") or []
    return {
        "movie_ids": [m.get("id") for m in movies if m.get("id") is not None],
        "n_tv": len(raw.get("tv_results") or []) + len(raw.get("tv_episode_results") or []),
    }


def is_fresh(fetched_at: str, now: datetime, max_age: timedelta) -> bool:
    return now - datetime.fromisoformat(fetched_at) < max_age


def normalize_title(title: str | None) -> str:
    """Lowercase, strip accents and punctuation, collapse spaces."""
    if not title:
        return ""
    t = unicodedata.normalize("NFKD", title.casefold())
    t = "".join(c if c.isalnum() else " " for c in t if not unicodedata.combining(c))
    return " ".join(t.split())


ARTICLES = ("the", "a", "an", "les", "le", "la", "l'", "il", "el", "der", "die", "das")


def ml_title_variants(title: str) -> str:
    """MovieLens 'City of Lost Children, The (Cité ..., La)' -> 'The City of Lost Children'."""
    t = title.strip()
    if t.endswith(")") and " (" in t:
        t = t[: t.index(" (")].strip()  # alternate/original title in parentheses
    head, sep, art = t.rpartition(", ")
    if sep and art.casefold() in ARTICLES:
        t = f"{art} {head}" if not art.endswith("'") else f"{art}{head}"
    return t


def title_keys(ml: str) -> set[str]:
    """Normalized forms of a MovieLens title: as is, with the article moved back to the front and
    the parenthesized alternate title removed, and that alternate title on its own."""
    keys = {normalize_title(ml), normalize_title(ml_title_variants(ml))}
    t = ml.strip()
    if t.endswith(")") and " (" in t:
        alt = t[t.index(" (") + 2 : -1].strip()
        alt = alt.removeprefix("a.k.a. ").removeprefix("a.k.a ")
        keys |= {normalize_title(alt), normalize_title(ml_title_variants(alt))}
    return keys - {""}


def same_film(ml_title: str, ml_year: int | None, movie: dict | None) -> bool:
    """Guard for /find completions and outdated imdb_ids: TMDB title (or original title) equals
    the normalized MovieLens title, and release years are within 1 year (both must be known)."""
    if movie is None:
        return False
    tmdb_year = release_year(movie.get("release_date"))
    if ml_year is None or tmdb_year is None or abs(tmdb_year - ml_year) > 1:
        return False
    tmdb = {normalize_title(movie.get("title")), normalize_title(movie.get("original_title"))}
    return bool(title_keys(ml_title) & (tmdb - {""}))


def resolve(our_imdb: str, movie: dict | None, find_ids: list[int] | None) -> str:
    """Verification rule. Returns 'ok', 'corrected' or 'mismatch'.

    movie: slim /movie response for the current tmdb_id (None if 404/no id);
    find_ids: movie ids returned by /find/{our_imdb} (None when not called yet).
    """
    if movie is not None and movie.get("imdb_id") == our_imdb:
        return "ok"
    if find_ids:
        return "corrected"
    return "mismatch"


def mismatch_reason(tmdb_id: int | None, movie: dict | None) -> str:
    if tmdb_id is None:
        return "no_tmdb_id"  # no id in links.csv and /find found nothing
    if movie is None:
        return "tmdb_404"  # /movie/{id} gone (deleted, or a TV id)
    if not movie.get("imdb_id"):
        return "tmdb_no_imdb_id"
    return "other_imdb_id"


# --- TMDB client ------------------------------------------------------------------------------


class RateLimiter:
    def __init__(self, per_second: float):
        self.interval = 1.0 / per_second
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next_at)
            self.next_at = at + self.interval
        if at > now:
            time.sleep(at - now)


class Tmdb:
    """Minimal TMDB v3 client. Never logs a URL (the v3 key would be in its query string)."""

    def __init__(self, cache_dir: Path = TMDB_CACHE):
        token = os.environ.get("TMDB_READ_TOKEN", "").strip()
        key = os.environ.get("TMDB_API_KEY", "").strip()
        if not token and not key:
            raise SystemExit("TMDB_READ_TOKEN ou TMDB_API_KEY manquant dans .env")
        self.session = requests.Session()
        self.session.headers["Accept"] = "application/json"
        self.auth_params = {}
        if token:
            self.session.headers["Authorization"] = f"Bearer {token}"
        else:
            self.auth_params = {"api_key": key}
        self.limiter = RateLimiter(MAX_REQUESTS_PER_SECOND)
        self.cache_dir = cache_dir
        self.now = datetime.now(UTC)
        self.stats = {"http": 0, "cache_hits": 0, "retries": 0}
        self.lock = threading.Lock()

    def _count(self, key: str) -> None:
        with self.lock:
            self.stats[key] += 1

    def _get(self, path: str, params: dict) -> dict | None:
        """GET with retries. JSON, or None on 404. Logs `path`, never the URL."""
        for attempt in range(MAX_RETRIES):
            self.limiter.wait()
            try:
                r = self.session.get(
                    API_BASE + path, params={**params, **self.auth_params}, timeout=20
                )
            except requests.RequestException as exc:
                status, retry_after = type(exc).__name__, None
            else:
                self._count("http")
                if r.status_code == 200:
                    return r.json()
                if r.status_code == 404:
                    return None
                if r.status_code in (401, 403):
                    raise SystemExit(f"TMDB {r.status_code} sur {path} : clé refusée")
                status, retry_after = r.status_code, r.headers.get("Retry-After")
                if r.status_code != 429 and r.status_code < 500:
                    raise RuntimeError(f"TMDB {r.status_code} sur {path}")
            self._count("retries")
            delay = float(retry_after) if retry_after else min(60, 2**attempt) + random.random()
            tqdm.write(f"  {path} : {status}, nouvel essai dans {delay:.0f} s")
            time.sleep(delay)
        raise RuntimeError(f"TMDB : abandon sur {path} après {MAX_RETRIES} essais")

    def _cached(self, kind: str, key: str, fetch) -> dict | None:
        file = self.cache_dir / kind / f"{key}.json"
        if file.exists():
            entry = json.loads(file.read_text(encoding="utf-8"))
            if is_fresh(entry["fetched_at"], self.now, CACHE_REUSE):
                self._count("cache_hits")
                return entry["data"]
        data = fetch()
        file.parent.mkdir(parents=True, exist_ok=True)
        entry = {"fetched_at": datetime.now(UTC).isoformat(timespec="seconds"), "data": data}
        tmp = file.with_suffix(".tmp")
        tmp.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        tmp.replace(file)
        return data

    def movie(self, tmdb_id: int) -> dict | None:
        def fetch():
            raw = self._get(f"/movie/{tmdb_id}", {"append_to_response": "credits"})
            return None if raw is None else slim_movie(raw)

        return self._cached("movie", str(tmdb_id), fetch)

    def find(self, imdb_id: str) -> dict:
        def fetch():
            raw = self._get(f"/find/{imdb_id}", {"external_source": "imdb_id"})
            return slim_find(raw or {})

        return self._cached("find", imdb_id, fetch)


def purge_old_cache(cache_dir: Path = TMDB_CACHE, now: datetime | None = None) -> int:
    """Delete cached responses older than 6 months. Returns how many were removed."""
    now = now or datetime.now(UTC)
    removed = 0
    for file in cache_dir.glob("*/*.json"):
        try:
            fetched_at = json.loads(file.read_text(encoding="utf-8"))["fetched_at"]
            old = not is_fresh(fetched_at, now, CACHE_MAX_AGE)
        except (ValueError, KeyError):
            old = True  # unreadable entry: refetch
        if old:
            file.unlink()
            removed += 1
    return removed


# --- Enrichment -------------------------------------------------------------------------------


def enrich_one(api: Tmdb, row: dict) -> dict:
    """Process one catalogue row. Returns the TMDB fields + bookkeeping for the report."""
    imdb_id, tmdb_id = row["imdb_id"], row["tmdb_id"]
    out = {"movie_id": row["movie_id"], "lookup_find": None, "notfound_find": None}

    if tmdb_id is None:  # needs_tmdb_lookup
        ids = api.find(imdb_id)["movie_ids"]
        out["lookup_find"] = ids
        tmdb_id = ids[0] if ids else None
    if not row["imdbds_found"]:  # report only: does TMDB know this imdb_id?
        out["notfound_find"] = api.find(imdb_id)["movie_ids"]

    movie = api.movie(tmdb_id) if tmdb_id is not None else None
    find_ids = None
    if movie is None or movie.get("imdb_id") != imdb_id:
        find_ids = [i for i in api.find(imdb_id)["movie_ids"] if i != tmdb_id] or None
    status = resolve(imdb_id, movie, find_ids)
    if status == "corrected":
        candidate = api.movie(find_ids[0])
        # /find can return an id whose /movie page is gone (404): not a usable correction.
        if candidate is not None and candidate.get("imdb_id") == imdb_id:
            tmdb_id, movie = find_ids[0], candidate
        else:
            status = "mismatch"
    reason = mismatch_reason(tmdb_id, movie) if status == "mismatch" else None
    same = same_film(row["ml_title"], row["ml_year"], movie)
    outdated = False
    if reason == "other_imdb_id" and same:
        # Same film, TMDB carries the current imdb_id (ours, from links.csv, is outdated).
        status, reason, outdated = "ok", None, True
    if row["tmdb_id"] is None and tmdb_id is not None and not same:
        # /find completion that does not look like our film (wrong imdb_id in links.csv?).
        tmdb_id, movie, status, reason = None, None, "mismatch", "lookup_suspect"
    out["tmdb_id"], out["movie"] = tmdb_id, movie
    out["tmdb_mismatch_reason"] = reason
    # A lookup (no tmdb_id in links.csv) resolved by /find is a completion, not a correction.
    out["tmdb_id_corrected"] = status == "corrected" and row["tmdb_id"] is not None
    out["tmdb_mismatch"] = status == "mismatch"
    out["imdb_id_outdated"] = outdated
    return out


def run(catalog: pl.DataFrame, api: Tmdb) -> list[dict]:
    rows = catalog.select(
        "movie_id", "imdb_id", "tmdb_id", "imdbds_found", "ml_title", "ml_year"
    ).to_dicts()
    with ThreadPoolExecutor(WORKERS) as pool:
        return list(
            tqdm(pool.map(lambda r: enrich_one(api, r), rows), total=len(rows), unit="film")
        )


def merge(catalog: pl.DataFrame, results: list[dict], merges: pl.DataFrame) -> pl.DataFrame:
    def field(m: dict | None, k: str):
        return None if m is None else m.get(k)

    tmdb = pl.DataFrame(
        {
            "movie_id": [r["movie_id"] for r in results],
            "tmdb_id": [r["tmdb_id"] for r in results],
            "tmdb_title": [field(r["movie"], "title") for r in results],
            "tmdb_original_title": [field(r["movie"], "original_title") for r in results],
            "tmdb_release_year": [release_year(field(r["movie"], "release_date")) for r in results],
            "tmdb_directors": [field(r["movie"], "directors") or [] for r in results],
            "poster_path": [field(r["movie"], "poster_path") for r in results],
            "tmdb_vote_count": [field(r["movie"], "vote_count") for r in results],
            "original_language": [field(r["movie"], "original_language") for r in results],
            "origin_country": [field(r["movie"], "origin_country") or [] for r in results],
            "tmdb_imdb_id": [field(r["movie"], "imdb_id") for r in results],
            "tmdb_id_corrected": [r["tmdb_id_corrected"] for r in results],
            "tmdb_mismatch": [r["tmdb_mismatch"] for r in results],
            "tmdb_mismatch_reason": [r["tmdb_mismatch_reason"] for r in results],
            "imdb_id_outdated": [r["imdb_id_outdated"] for r in results],
        },
        schema_overrides={
            "movie_id": pl.Int32,
            "tmdb_id": pl.Int64,
            "tmdb_release_year": pl.Int32,
            "tmdb_vote_count": pl.Int32,
            "tmdb_directors": pl.List(pl.String),
            "origin_country": pl.List(pl.String),
        },
    )
    # Old imdb_ids of merged movies: the duplicate's id and the canonical's own links.csv id.
    old_ids = pl.concat(
        [
            merges.select("movie_id_to", "imdb_id_to", pl.col("imdb_id_from").alias("alias")),
            merges.select(
                "movie_id_to", "imdb_id_to", pl.col("imdb_id_to_original").alias("alias")
            ),
        ]
    )
    aliases = (
        old_ids.filter(pl.col("alias").is_not_null() & (pl.col("alias") != pl.col("imdb_id_to")))
        .group_by(pl.col("movie_id_to").alias("movie_id"))
        .agg(pl.col("alias").unique().sort().alias("imdb_id_aliases"))
    )
    base = catalog.select(CATALOG_COLUMNS)
    if "ml_tmdb_id" in catalog.columns:  # re-run on an enriched catalogue: keep B3 provenance
        base = base.with_columns(catalog["ml_tmdb_id"])
    else:
        base = base.with_columns(pl.col("tmdb_id").alias("ml_tmdb_id"))
    out = (
        base.drop("tmdb_id")
        .join(tmdb, on="movie_id", how="left")
        .join(aliases, on="movie_id", how="left")
        .with_columns(
            pl.col("imdb_id_aliases").fill_null(pl.lit([], dtype=pl.List(pl.String))),
            pl.coalesce("tmdb_release_year", "ml_year").alias("year"),
        )
        .with_columns(
            # TMDB's (current) imdb_id is an alias when it differs from ours, unless the row is
            # a mismatch (TMDB may describe another film there).
            pl.when(
                pl.col("tmdb_imdb_id").is_not_null()
                & (pl.col("tmdb_imdb_id") != pl.col("imdb_id"))
                & ~pl.col("tmdb_mismatch")
            )
            .then(pl.concat_list("imdb_id_aliases", "tmdb_imdb_id").list.unique().list.sort())
            .otherwise("imdb_id_aliases")
            .alias("imdb_id_aliases")
        )
        .sort("item_idx")
    )
    # item_idx is frozen here (nothing is dropped by B4); renumber only if rows were removed.
    if out["item_idx"].to_list() != list(range(out.height)):
        out = out.with_columns(pl.int_range(out.height, dtype=pl.Int32).alias("item_idx"))
    cols = [c for c in CATALOG_COLUMNS if c != "tmdb_id"]
    cols.insert(cols.index("imdb_id") + 1, "tmdb_id")
    return out.select(cols + list(ENRICHED_COLUMNS))


# --- Report -----------------------------------------------------------------------------------


def pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.2f} %)" if d else "0/0"


def print_report(cat: pl.DataFrame, results: list[dict], api: Tmdb) -> None:
    n = cat.height
    print("\n== Appels ==")
    print(
        f"requêtes HTTP : {api.stats['http']} ; cache : {api.stats['cache_hits']} ; "
        f"réessais : {api.stats['retries']}"
    )

    print("\n== Couverture ==")
    for col, label in [
        ("tmdb_id", "tmdb_id"),
        ("tmdb_title", "tmdb_title"),
        ("tmdb_release_year", "tmdb_release_year"),
        ("poster_path", "poster_path"),
    ]:
        print(f"{label} : {pct(int(cat[col].is_not_null().sum()), n)}")
    dirs = int((cat["tmdb_directors"].list.len() > 0).sum())
    print(f"tmdb_directors : {pct(dirs, n)}")

    print("\n== Vérification imdb_id (100 % des films) ==")
    corrected = cat.filter("tmdb_id_corrected")
    mismatch = cat.filter("tmdb_mismatch")
    outdated = int(cat["imdb_id_outdated"].sum())
    print(
        f"tmdb_id corrigés : {corrected.height} ; imdb_id_outdated : {outdated} ; "
        f"mismatch restants : {mismatch.height}"
    )
    print(mismatch.group_by("tmdb_mismatch_reason").len().sort("len", descending=True))
    if corrected.height:
        print(
            corrected.select(
                "movie_id",
                "imdb_id",
                "ml_tmdb_id",
                "tmdb_id",
                "ml_title",
                "ml_year",
                "tmdb_title",
                "tmdb_release_year",
            )
        )
    if mismatch.height:
        reasons = mismatch.group_by("tmdb_mismatch_reason", "imdbds_found").len().sort("len")
        print("par cause (imdbds_found = notre imdb_id présent dans les datasets IMDb) :")
        print(reasons)
        mismatch.select(MISMATCH_REPORT_COLUMNS).sort(
            "tmdb_mismatch_reason", "ml_rating_count", descending=[False, True]
        ).write_csv(MISMATCH_CSV)
        print(f"liste complète : {MISMATCH_CSV}")
        print(mismatch.select(MISMATCH_REPORT_COLUMNS).sort("ml_rating_count", descending=True))
    dup = cat.filter(pl.col("tmdb_id").is_not_null() & pl.col("tmdb_id").is_duplicated())
    print(f"doublons de tmdb_id après correction : {dup.height}")
    if dup.height:
        print(dup.select("movie_id", "imdb_id", "tmdb_id", "ml_title", "ml_year"))
    sample = cat.filter(pl.col("tmdb_imdb_id").is_not_null()).sample(min(50, n), seed=0)
    ok = int((sample["tmdb_imdb_id"] == sample["imdb_id"]).sum())
    print(f"échantillon 50 au hasard : imdb_id TMDB = le nôtre pour {pct(ok, sample.height)}")

    by_id = {r["movie_id"]: r for r in results}
    lookups = [r for r in results if r["lookup_find"] is not None]
    if lookups:
        found = sum(bool(r["lookup_find"]) for r in lookups)
        print(f"\nneeds_tmdb_lookup : {len(lookups)} ; trouvés par /find : {found}")
        ids = [r["movie_id"] for r in lookups]
        lk = cat.filter(pl.col("movie_id").is_in(ids)).with_columns(
            ((pl.col("tmdb_release_year") - pl.col("ml_year")).abs() > 1).alias("year_gap_gt1")
        )
        print(
            lk.select(
                "movie_id",
                "imdb_id",
                "tmdb_id",
                "ml_title",
                "ml_year",
                "tmdb_title",
                "tmdb_release_year",
                "year_gap_gt1",
            )
        )
    nf = [r for r in results if r["notfound_find"] is not None]
    if nf:
        known = [r for r in nf if r["notfound_find"]]
        same = sum(by_id[r["movie_id"]]["tmdb_id"] in r["notfound_find"] for r in known)
        print(
            f"\nimdbds_found = false : {len(nf)} ; reconnus par TMDB (/find) : {len(known)} "
            f"(dont {same} avec le même tmdb_id que le nôtre)"
        )

    phantom = cat.filter(pl.col("tmdb_id") == 69234)
    if phantom.height:
        print("\nPhantom of the Opera (tmdb_id 69234) :")
        print(
            phantom.select(
                "movie_id",
                "imdb_id",
                "tmdb_imdb_id",
                "ml_title",
                "ml_year",
                "tmdb_title",
                "tmdb_release_year",
                "tmdb_directors",
            )
        )

    print("\n== Années ==")
    gap = cat.filter((pl.col("tmdb_release_year") - pl.col("ml_year")).abs() > 1).with_columns(
        (pl.col("tmdb_release_year") - pl.col("ml_year")).alias("diff")
    )
    print(f"écarts TMDB vs MovieLens > 1 an : {gap.height}")
    print(
        gap.sort("ml_rating_count", descending=True)
        .head(10)
        .select("movie_id", "ml_title", "ml_year", "tmdb_release_year", "diff", "ml_rating_count")
    )
    print(f"année manquante (year null) : {cat['year'].null_count()}")

    print("\n== Titres ==")
    t = cat.filter(pl.col("tmdb_title").is_not_null()).select(
        "movie_id", "ml_title", "tmdb_title", "tmdb_original_title", "ml_rating_count"
    )
    rows = t.to_dicts()
    raw_diff = [
        r for r in rows if normalize_title(r["ml_title"]) != normalize_title(r["tmdb_title"])
    ]
    var_diff = [
        r
        for r in raw_diff
        if normalize_title(ml_title_variants(r["ml_title"])) != normalize_title(r["tmdb_title"])
    ]
    orig_ok = [
        r
        for r in var_diff
        if normalize_title(ml_title_variants(r["ml_title"]))
        == normalize_title(r["tmdb_original_title"])
    ]
    print(f"tmdb_title ≠ ml_title (casse/accents/ponctuation) : {pct(len(raw_diff), len(rows))}")
    print(
        f"  … encore différents après article replacé et titre alternatif retiré : "
        f"{pct(len(var_diff), len(rows))} (dont {len(orig_ok)} égaux au titre original TMDB)"
    )
    random.Random(0).shuffle(var_diff)
    for r in var_diff[:20]:
        print(f"  {r['movie_id']:>6}  ML « {r['ml_title']} »  →  TMDB « {r['tmdb_title']} »")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, help="only the first N movies; catalogue not written")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    pl.Config.set_tbl_width_chars(170).set_fmt_str_lengths(40).set_tbl_rows(60)

    catalog = pl.read_parquet(CATALOG_PARQUET)
    merges = pl.read_parquet(MERGES_PARQUET)
    if "ml_tmdb_id" in catalog.columns:  # restart from the B3 tmdb_id (links.csv)
        catalog = catalog.with_columns(pl.col("ml_tmdb_id").alias("tmdb_id"))
    work = catalog.head(args.limit) if args.limit else catalog

    removed = purge_old_cache()
    print(f"cache : {removed} réponse(s) de plus de 6 mois supprimée(s)")
    api = Tmdb()
    results = run(work, api)
    enriched = merge(work, results, merges)
    print_report(enriched, results, api)
    if args.limit:
        print(f"\n--limit {args.limit} : catalog.parquet non modifié")
    else:
        enriched.write_parquet(CATALOG_PARQUET)
        print(f"\nécrit : {CATALOG_PARQUET} ({enriched.height} films)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
