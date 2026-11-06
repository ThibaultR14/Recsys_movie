import polars as pl
import pytest

import build_catalog as bc

# --- Pure transformations ------------------------------------------------------------------------


def test_imdb_id_formatting():
    df = pl.DataFrame({"raw": ["0114709", "114709", "10376068", "0000001"]})
    out = df.select(bc.imdb_tt(pl.col("raw")))["literal"].to_list()
    assert out == ["tt0114709", "tt0114709", "tt10376068", "tt0000001"]


def test_imdb_id_formatting_from_int():
    df = pl.DataFrame({"raw": [114709, 10376068]})
    assert df.select(bc.imdb_tt(pl.col("raw")))["literal"].to_list() == ["tt0114709", "tt10376068"]


@pytest.mark.parametrize(
    ("raw", "title", "year"),
    [
        ("Toy Story (1995)", "Toy Story", 1995),
        # parentheses inside the name (original title) are kept
        (
            "City of Lost Children, The (Cité des enfants perdus, La) (1995)",
            "City of Lost Children, The (Cité des enfants perdus, La)",
            1995,
        ),
        # no year at all, with or without parentheses (real MovieLens titles)
        ("Terrible Joe Moran", "Terrible Joe Moran", None),
        (
            "Millions Game, The (Das Millionenspiel)",
            "Millions Game, The (Das Millionenspiel)",
            None,
        ),
        # a year range in the name is not the release year
        (
            "All the Streets Are Silent: The Convergence of Hip Hop and Skateboarding (1987-1997) "
            "(2021)",
            "All the Streets Are Silent: The Convergence of Hip Hop and Skateboarding (1987-1997)",
            2021,
        ),
        # doubled closing parenthesis (movieId 98063) and trailing spaces
        (
            "Mona and the Time of Burning Love (Mona ja palavan rakkauden aika) (1983))",
            "Mona and the Time of Burning Love (Mona ja palavan rakkauden aika)",
            1983,
        ),
        ("Babylon 5 (1994-1998) ", "Babylon 5", 1994),
        ("Big Bang Theory, The (2007-)", "Big Bang Theory, The", 2007),
    ],
)
def test_title_and_year_extraction(raw, title, year):
    df = pl.DataFrame({"t": [raw]}).select(
        bc.ml_title(pl.col("t")).alias("title"), bc.ml_year(pl.col("t")).alias("year")
    )
    assert df.row(0) == (title, year)


def test_genres_split_and_no_genres():
    df = pl.DataFrame({"g": ["Adventure|Animation", "(no genres listed)"]})
    assert df.select(bc.ml_genres(pl.col("g")).alias("g"))["g"].to_list() == [
        ["Adventure", "Animation"],
        [],
    ]


# --- Duplicates ----------------------------------------------------------------------------------


def _movies(rows):
    cols = (
        "movie_id",
        "tmdb_id",
        "imdb_id",
        "ml_year",
        "raw_rating_count",
        "imdbds_title_type",
        "imdbds_found",
    )
    return pl.DataFrame([dict(zip(cols, r, strict=True)) for r in rows])


def test_duplicates_merge_into_most_rated_and_take_found_imdb_id():
    movies = _movies(
        [
            (10, 1, "tt0000010", 2002, 900, None, False),  # dead imdb id, most ratings
            (20, 1, "tt0000020", 2002, 50, "movie", True),
            (30, 2, "tt0000030", 2000, 40, "movie", True),  # not a duplicate
        ]
    )
    merges, overrides, conflicts = bc.resolve_tmdb_duplicates(movies)
    assert merges.select("movie_id_from", "movie_id_to", "imdb_id_to").rows() == [
        (20, 10, "tt0000020")
    ]
    assert overrides == {10: "tt0000020"}
    assert conflicts == []


def test_duplicates_episode_link_error_same_year_is_merged():
    # Enron case: the most-rated movieId is linked to a tvEpisode, the other to the movie.
    movies = _movies(
        [
            (1, 7, "tt1", 2005, 1800, "tvEpisode", True),
            (2, 7, "tt2", 2005, 130, "movie", True),
        ]
    )
    merges, overrides, _ = bc.resolve_tmdb_duplicates(movies)
    assert merges.select("movie_id_from", "movie_id_to").rows() == [(2, 1)]
    assert overrides == {1: "tt2"}


def test_duplicates_series_other_year_is_not_merged():
    # Phantom of the Opera case: 1989 film vs 1990 miniseries -> left to the type filter.
    movies = _movies(
        [(1, 7, "tt1", 1989, 130, "movie", True), (2, 7, "tt2", 1990, 30, "tvMiniSeries", True)]
    )
    merges, overrides, conflicts = bc.resolve_tmdb_duplicates(movies)
    assert merges.height == 0 and overrides == {} and conflicts == []


def test_duplicates_different_films_are_conflicts():
    movies = _movies(
        [(1, 7, "tt1", 1998, 53, "movie", True), (2, 7, "tt2", 2012, 21, "movie", True)]
    )
    merges, _, conflicts = bc.resolve_tmdb_duplicates(movies)
    assert merges.height == 0
    assert conflicts == [1, 2]


def test_apply_merges_keeps_most_recent_rating():
    ratings = pl.DataFrame(
        {
            "userId": [1, 1, 2, 3],
            "movieId": [10, 20, 20, 10],
            "rating": [2.0, 5.0, 4.0, 3.0],
            "timestamp": [100, 200, 50, 10],
        }
    )
    merges = pl.DataFrame(
        {"movie_id_from": [20], "movie_id_to": [10]},
        schema={"movie_id_from": pl.Int64, "movie_id_to": pl.Int64},
    )
    out, stats = bc.apply_merges(ratings, merges)
    assert sorted(out.select("userId", "movieId", "rating").rows()) == [
        (1, 10, 5.0),  # user 1 rated both: the later rating (on 20) wins
        (2, 10, 4.0),
        (3, 10, 3.0),
    ]
    assert stats == {"reassigned": 2, "collisions": 1, "reassigned_kept": 2}


# --- Column provenance ---------------------------------------------------------------------------


def test_imdb_columns_are_prefixed_and_publishable_ones_are_not():
    assert all(c.startswith(bc.IMDB_PREFIX) for c in bc.IMDB_COLUMNS)
    assert not any(c.startswith(bc.IMDB_PREFIX) for c in bc.PUBLISHABLE_COLUMNS)
    # IMDb dataset field names must never appear unprefixed.
    imdb_fields = {"primary", "original", "start_year", "title_type", "votes", "average", "tconst"}
    assert not any(f in c for c in bc.PUBLISHABLE_COLUMNS for f in imdb_fields)


# --- Acceptance on the real build (skipped if build_catalog.py has not been run) -----------------

needs_catalog = pytest.mark.skipif(
    not bc.CATALOG_PARQUET.exists(), reason="run build_catalog.py first"
)


@pytest.fixture(scope="module")
def catalog():
    return pl.read_parquet(bc.CATALOG_PARQUET)


@needs_catalog
def test_catalog_columns_match_declared(catalog):
    assert tuple(catalog.columns) == bc.CATALOG_COLUMNS


@needs_catalog
def test_toy_story(catalog):
    row = catalog.filter(pl.col("movie_id") == 1).row(0, named=True)
    assert (row["imdb_id"], row["tmdb_id"]) == ("tt0114709", 862)
    assert (row["ml_title"], row["ml_year"]) == ("Toy Story", 1995)


@needs_catalog
def test_no_series_or_episodes(catalog):
    assert catalog.filter(pl.col("imdbds_title_type").is_in(bc.EXCLUDED_TITLE_TYPES)).height == 0


@needs_catalog
def test_ids_unique_and_complete(catalog):
    assert catalog["movie_id"].is_unique().all()
    assert catalog["imdb_id"].is_unique().all()
    assert catalog["imdb_id"].null_count() == 0
    assert catalog["tmdb_id"].drop_nulls().is_unique().all()
    assert catalog["item_idx"].to_list() == list(range(catalog.height))
    assert catalog["imdbds_found"].mean() >= 0.98
    assert (catalog["needs_tmdb_lookup"] == catalog["tmdb_id"].is_null()).all()


@needs_catalog
def test_ratings_filtered_consistent(catalog):
    ratings = pl.scan_parquet(bc.RATINGS_FILTERED_PARQUET)
    merged_away = pl.read_parquet(bc.MERGES_PARQUET)["movie_id_from"].implode()
    ids = ratings.select(pl.col("movieId").unique()).collect()["movieId"]
    assert set(ids.to_list()) == set(catalog["movie_id"].to_list())
    assert (
        ratings.filter(pl.col("movieId").is_in(merged_away)).select(pl.len()).collect().item() == 0
    )
    pairs = ratings.group_by("userId", "movieId").len().filter(pl.col("len") > 1)
    assert pairs.select(pl.len()).collect().item() == 0
    assert catalog["ml_rating_count"].sum() == ratings.select(pl.len()).collect().item()
