import json
from datetime import UTC, datetime, timedelta

import polars as pl
import pytest

import enrich_tmdb as et
from build_catalog import CATALOG_COLUMNS, CATALOG_PARQUET

# --- Pure helpers --------------------------------------------------------------------------------


def test_slim_movie_keeps_directors_only_and_useful_fields():
    raw = {
        "id": 862,
        "imdb_id": "tt0114709",
        "title": "Toy Story",
        "original_title": "Toy Story",
        "release_date": "1995-11-22",
        "poster_path": "/p.jpg",
        "vote_count": 100,
        "original_language": "en",
        "origin_country": ["US"],
        "overview": "dropped",
        "credits": {
            "cast": [{"name": "Tom Hanks"}],
            "crew": [
                {"job": "Director", "name": "A"},
                {"job": "Producer", "name": "B"},
                {"job": "Director", "name": "C"},
                {"job": "Director", "name": "A"},  # same person twice (two departments)
            ],
        },
    }
    slim = et.slim_movie(raw)
    assert slim["directors"] == ["A", "C"]
    assert "credits" not in slim and "overview" not in slim
    assert "Tom Hanks" not in json.dumps(slim)


def test_slim_movie_empty_strings_become_null():
    slim = et.slim_movie({"id": 1, "imdb_id": "", "release_date": "", "poster_path": None})
    assert slim["imdb_id"] is None and slim["release_date"] is None
    assert slim["directors"] == [] and slim["origin_country"] == []


def test_slim_find():
    raw = {"movie_results": [{"id": 5}, {"id": 7}], "tv_results": [{"id": 9}]}
    assert et.slim_find(raw) == {"movie_ids": [5, 7], "n_tv": 1}
    assert et.slim_find({}) == {"movie_ids": [], "n_tv": 0}


@pytest.mark.parametrize(("date", "year"), [("1995-11-22", 1995), ("", None), (None, None)])
def test_release_year(date, year):
    assert et.release_year(date) == year


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Amélie", "amelie"),
        ("Se7en!", "se7en"),
        ("Star Wars: Episode IV - A New Hope", "star wars episode iv a new hope"),
        ("  L'Atalante ", "l atalante"),
    ],
)
def test_normalize_title(a, b):
    assert et.normalize_title(a) == b


@pytest.mark.parametrize(
    ("ml", "expected"),
    [
        ("City of Lost Children, The (Cité des enfants perdus, La)", "The City of Lost Children"),
        ("Usual Suspects, The", "The Usual Suspects"),
        ("Toy Story", "Toy Story"),
        ("Seven (a.k.a. Se7en)", "Seven"),
    ],
)
def test_ml_title_variants(ml, expected):
    assert et.ml_title_variants(ml) == expected


def test_resolve_and_reason():
    ok = {"imdb_id": "tt1"}
    assert et.resolve("tt1", ok, None) == "ok"
    assert et.resolve("tt1", {"imdb_id": "tt2"}, [42]) == "corrected"
    assert et.resolve("tt1", None, [42]) == "corrected"
    assert et.resolve("tt1", {"imdb_id": "tt2"}, None) == "mismatch"
    assert et.mismatch_reason(None, None) == "no_tmdb_id"
    assert et.mismatch_reason(1, None) == "tmdb_404"
    assert et.mismatch_reason(1, {"imdb_id": None}) == "tmdb_no_imdb_id"
    assert et.mismatch_reason(1, {"imdb_id": "tt2"}) == "other_imdb_id"


# --- Cache ---------------------------------------------------------------------------------------


def _entry(path, age_days, now):
    path.parent.mkdir(parents=True, exist_ok=True)
    at = (now - timedelta(days=age_days)).isoformat(timespec="seconds")
    path.write_text(json.dumps({"fetched_at": at, "data": None}), encoding="utf-8")


def test_purge_removes_entries_older_than_six_months(tmp_path):
    now = datetime(2026, 11, 6, tzinfo=UTC)
    _entry(tmp_path / "movie" / "1.json", 10, now)
    _entry(tmp_path / "movie" / "2.json", 200, now)
    (tmp_path / "find").mkdir()
    (tmp_path / "find" / "tt3.json").write_text("not json", encoding="utf-8")
    assert et.purge_old_cache(tmp_path, now) == 2
    assert [p.name for p in tmp_path.glob("*/*.json")] == ["1.json"]


class FakeApi(et.Tmdb):
    """Tmdb with a fake HTTP layer: no network, no credentials."""

    def __init__(self, cache_dir, movies, finds):
        self.cache_dir, self.now = cache_dir, datetime.now(UTC)
        self.stats = {"http": 0, "cache_hits": 0, "retries": 0}
        import threading

        self.lock = threading.Lock()
        self.movies, self.finds, self.calls = movies, finds, []

    def _get(self, path, params):
        self.calls.append(path)
        kind, key = path.strip("/").split("/")
        if kind == "movie":
            return self.movies.get(int(key))
        return {"movie_results": [{"id": i} for i in self.finds.get(key, [])]}


def test_cache_reused_when_fresh_and_refetched_when_stale(tmp_path):
    api = FakeApi(tmp_path, {1: {"id": 1, "imdb_id": "tt1"}}, {})
    api.movie(1)
    api.movie(1)
    assert api.calls == ["/movie/1"]
    _entry(tmp_path / "movie" / "1.json", 40, api.now)
    api.movie(1)
    assert api.calls == ["/movie/1", "/movie/1"]
    cached = json.loads((tmp_path / "movie" / "1.json").read_text(encoding="utf-8"))
    assert cached["data"]["imdb_id"] == "tt1" and "fetched_at" in cached


# --- Verification rule ---------------------------------------------------------------------------


def _row(tmdb_id, imdb="tt1", found=True, title="Film", year=2000):
    return {
        "movie_id": 1,
        "imdb_id": imdb,
        "tmdb_id": tmdb_id,
        "imdbds_found": found,
        "ml_title": title,
        "ml_year": year,
    }


def _movie(i, imdb, title="Film", date="2000-05-01"):
    return {"id": i, "imdb_id": imdb, "title": title, "original_title": title, "release_date": date}


def test_enrich_ok(tmp_path):
    api = FakeApi(tmp_path, {10: {"id": 10, "imdb_id": "tt1"}}, {})
    out = et.enrich_one(api, _row(10))
    assert out["tmdb_id"] == 10 and not out["tmdb_mismatch"] and not out["tmdb_id_corrected"]
    assert api.calls == ["/movie/10"]  # one call, no /find


def test_enrich_corrects_wrong_tmdb_id(tmp_path):
    # Phantom of the Opera (1989): links.csv gives a TV id (/movie 404), /find gives the film.
    api = FakeApi(tmp_path, {86962: {"id": 86962, "imdb_id": "tt1"}}, {"tt1": [86962]})
    out = et.enrich_one(api, _row(69234))
    assert out["tmdb_id"] == 86962 and out["tmdb_id_corrected"] and not out["tmdb_mismatch"]


def test_enrich_find_to_dead_movie_is_a_mismatch(tmp_path):
    # On Your Mark: /find returns an id whose /movie page is 404.
    api = FakeApi(tmp_path, {}, {"tt1": [99]})
    out = et.enrich_one(api, _row(10))
    assert out["tmdb_id"] == 10 and out["tmdb_mismatch"] and not out["tmdb_id_corrected"]
    assert out["tmdb_mismatch_reason"] == "tmdb_404"


def test_enrich_other_imdb_id_without_find_result_is_a_mismatch(tmp_path):
    api = FakeApi(tmp_path, {10: _movie(10, "tt2", "Another Film", "1980-01-01")}, {})
    out = et.enrich_one(api, _row(10))
    assert out["tmdb_mismatch"] and out["tmdb_mismatch_reason"] == "other_imdb_id"
    assert not out["imdb_id_outdated"]
    assert out["movie"]["imdb_id"] == "tt2"  # data kept, nothing excluded


@pytest.mark.parametrize(
    ("tmdb_title", "date", "mismatch"),
    [
        ("Batman: The Dark Knight Returns", "2013-01-18", False),  # same film, no imdb_id on TMDB
        ("Batman: The Dark Knight Returns", "2016-01-18", True),
        ("Something Else", "2013-01-18", True),
    ],
)
def test_tmdb_without_imdb_id_uses_the_title_year_guard(tmp_path, tmdb_title, date, mismatch):
    api = FakeApi(tmp_path, {10: _movie(10, None, tmdb_title, date)}, {})
    out = et.enrich_one(api, _row(10, title="Batman: The Dark Knight Returns", year=2013))
    assert out["tmdb_mismatch"] is mismatch and not out["imdb_id_outdated"]
    assert out["tmdb_mismatch_reason"] == ("tmdb_no_imdb_id" if mismatch else None)


def test_enrich_lookup_completion_is_not_a_correction(tmp_path):
    api = FakeApi(tmp_path, {7: _movie(7, "tt1")}, {"tt1": [7]})
    out = et.enrich_one(api, _row(None))
    assert out["tmdb_id"] == 7 and out["lookup_find"] == [7]
    assert not out["tmdb_id_corrected"] and not out["tmdb_mismatch"]


@pytest.mark.parametrize(
    ("ml_title", "ml_year", "tmdb_title", "date"),
    [
        ("Knock at the Cabin", 2023, "Knock at the Cabin", "2023-02-01"),
        ("Kingdom II, The (Riget II)", 1997, "The Kingdom II", "1998-09-01"),  # article + 1 year
        (
            "City of Lost Children, The (Cité des enfants perdus, La)",
            1995,
            "La Cité des enfants perdus",
            "1995-05-17",
        ),  # matches the alternate title
    ],
)
def test_other_imdb_id_same_title_and_year_is_outdated_not_mismatch(
    tmp_path, ml_title, ml_year, tmdb_title, date
):
    api = FakeApi(tmp_path, {10: _movie(10, "tt8272064", tmdb_title, date)}, {})
    out = et.enrich_one(api, _row(10, imdb="tt15679400", title=ml_title, year=ml_year))
    assert out["imdb_id_outdated"] and not out["tmdb_mismatch"]
    assert out["tmdb_id"] == 10 and out["tmdb_mismatch_reason"] is None


@pytest.mark.parametrize(
    ("tmdb_title", "date"),
    [("Knock at the Cabin", "2026-01-01"), ("Something Else", "2023-02-01"), ("Knock", None)],
)
def test_other_imdb_id_with_title_or_year_off_stays_mismatch(tmp_path, tmdb_title, date):
    api = FakeApi(tmp_path, {10: _movie(10, "tt2", tmdb_title, date)}, {})
    out = et.enrich_one(api, _row(10, title="Knock at the Cabin", year=2023))
    assert out["tmdb_mismatch"] and out["tmdb_mismatch_reason"] == "other_imdb_id"
    assert not out["imdb_id_outdated"]


@pytest.mark.parametrize(
    ("ml_title", "ml_year", "tmdb_title", "date"),
    [
        ("Loser", 1991, "Loser: The Movie", "1996-09-27"),  # title and year off
        ("Anna", 1996, "Anna Meintjies", "1983-03-21"),
        ("Get Over It", 1996, "Get Over It", "1993-01-01"),  # same title, year off by 3
        ("Eros", None, "Eros", "2004-09-10"),  # unknown ML year: cannot confirm
    ],
)
def test_lookup_completion_suspect_is_not_filled(tmp_path, ml_title, ml_year, tmdb_title, date):
    api = FakeApi(tmp_path, {7: _movie(7, "tt1", tmdb_title, date)}, {"tt1": [7]})
    out = et.enrich_one(api, _row(None, title=ml_title, year=ml_year))
    assert out["tmdb_id"] is None and out["movie"] is None
    assert out["tmdb_mismatch"] and out["tmdb_mismatch_reason"] == "lookup_suspect"


def test_lookup_completion_accepted_with_close_title_and_year(tmp_path):
    api = FakeApi(tmp_path, {7: _movie(7, "tt1", "Get Over It", "1995-01-01")}, {"tt1": [7]})
    out = et.enrich_one(api, _row(None, title="Get Over It", year=1996))
    assert out["tmdb_id"] == 7 and not out["tmdb_mismatch"]


# --- Merge ---------------------------------------------------------------------------------------


def _catalog():
    rows = {c: [None, None] for c in CATALOG_COLUMNS}
    rows.update(
        item_idx=[0, 1],
        movie_id=[1, 2],
        imdb_id=["tt1", "tt2"],
        tmdb_id=[10, None],
        ml_title=["A", "B"],
        ml_year=[2000, 1990],
        ml_genres=[[], []],
        needs_tmdb_lookup=[False, True],
        imdbds_found=[True, True],
    )
    return pl.DataFrame(rows).with_columns(
        pl.col("item_idx", "movie_id").cast(pl.Int32), pl.col("tmdb_id").cast(pl.Int64)
    )


def test_merge_year_aliases_and_frozen_item_idx():
    results = [
        {
            "movie_id": 1,
            "tmdb_id": 10,
            "movie": {
                "title": "A",
                "release_date": "2001-01-01",
                "directors": ["X"],
                "imdb_id": "tt5",
            },
            "tmdb_id_corrected": False,
            "tmdb_mismatch": False,
            "tmdb_mismatch_reason": None,
            "imdb_id_outdated": True,
        },
        {
            "movie_id": 2,
            "tmdb_id": None,
            "movie": None,
            "tmdb_id_corrected": False,
            "tmdb_mismatch": True,
            "tmdb_mismatch_reason": "no_tmdb_id",
            "imdb_id_outdated": False,
        },
    ]
    merges = pl.DataFrame(
        {
            "movie_id_to": [1, 1],
            "imdb_id_from": ["tt1", "tt1"],
            "imdb_id_to": ["tt1", "tt1"],
            "imdb_id_to_original": ["tt9", "tt9"],
        }
    )
    out = et.merge(_catalog(), results, merges)
    assert out["year"].to_list() == [2001, 1990]  # TMDB year first, ML as fallback
    assert out["imdb_id_aliases"].to_list() == [["tt5", "tt9"], []]  # merge + TMDB current id
    assert out["item_idx"].to_list() == [0, 1]
    assert out["ml_tmdb_id"].to_list() == [10, None]
    assert out["tmdb_directors"].to_list() == [["X"], []]
    assert set(et.ENRICHED_COLUMNS) <= set(out.columns)
    assert out["recommendable"].to_list() == [True, False]  # mismatch -> never shown


# --- Acceptance on the real enriched catalogue (skipped until B4 has run) -------------------------


@pytest.fixture(scope="module")
def enriched():
    if not CATALOG_PARQUET.exists():
        pytest.skip("catalog.parquet absent")
    cat = pl.read_parquet(CATALOG_PARQUET)
    if "tmdb_title" not in cat.columns:
        pytest.skip("catalogue pas encore enrichi (enrich_tmdb.py)")
    return cat


def test_enriched_coverage(enriched):
    n = enriched.height
    assert enriched["tmdb_id"].is_not_null().sum() >= 0.99 * n
    assert enriched["tmdb_title"].is_not_null().sum() >= 0.98 * n
    assert enriched["tmdb_release_year"].is_not_null().sum() >= 0.98 * n
    assert (enriched["tmdb_directors"].list.len() > 0).sum() >= 0.95 * n
    assert enriched["poster_path"].is_not_null().sum() >= 0.95 * n


def test_enriched_item_idx_contiguous_and_ids_unique(enriched):
    assert enriched["item_idx"].to_list() == list(range(enriched.height))
    ids = enriched.filter(pl.col("tmdb_id").is_not_null())["tmdb_id"]
    assert ids.is_unique().all()


def test_mismatch_alias_not_added(tmp_path):
    results = [
        {
            "movie_id": m,
            "tmdb_id": 10 + m,
            "movie": {"imdb_id": "tt7"},
            "tmdb_id_corrected": False,
            "tmdb_mismatch": True,
            "tmdb_mismatch_reason": "other_imdb_id",
            "imdb_id_outdated": False,
        }
        for m in (1, 2)
    ]
    empty = pl.DataFrame(
        schema={
            "movie_id_to": pl.Int32,
            "imdb_id_from": pl.String,
            "imdb_id_to": pl.String,
            "imdb_id_to_original": pl.String,
        },
    )
    out = et.merge(_catalog(), results, empty)
    assert out["imdb_id_aliases"].to_list() == [[], []]


def test_enriched_phantom_1989_is_the_film(enriched):
    row = enriched.filter(pl.col("imdb_id") == "tt0098090")
    assert row["tmdb_id"].item() == 86962 and row["tmdb_release_year"].item() == 1989
