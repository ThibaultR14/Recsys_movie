import polars as pl
import pytest

import build_catalog as bc

COLS = (
    "movie_id",
    "tmdb_id",
    "imdb_id",
    "ml_title",
    "ml_year",
    "raw_rating_count",
    "imdbds_title_type",
    "imdbds_found",
)


def _movies(rows):
    return pl.DataFrame(
        [dict(zip(COLS, r, strict=True)) for r in rows],
        schema={
            "movie_id": pl.Int32,
            "tmdb_id": pl.Int64,
            "imdb_id": pl.String,
            "ml_title": pl.String,
            "ml_year": pl.Int32,
            "raw_rating_count": pl.Int32,
            "imdbds_title_type": pl.String,
            "imdbds_found": pl.Boolean,
        },
    )


def _overrides(rows):
    return pl.DataFrame(
        rows,
        schema={
            "movie_id": pl.Int32,
            "action": pl.String,
            "target_movie_id": pl.Int32,
            "reason": pl.String,
        },
        orient="row",
    )


# --- The versioned file --------------------------------------------------------------------------


def test_versioned_file_is_valid_and_documented():
    df = bc.load_manual_overrides()
    assert df.height >= 1 and df["reason"].null_count() == 0
    assert set(df["action"]) <= set(bc.MANUAL_ACTIONS)


def test_title_lines_are_read():
    df = bc.load_manual_overrides()
    titles = dict(df.filter(pl.col("action") == "title").select("movie_id", "title").iter_rows())
    assert titles[7099] == "Nausicaä of the Valley of the Wind"


H = "movie_id,action,target_movie_id,title,reason\n"


@pytest.mark.parametrize(
    "content",
    [
        H + "1,drop,,,typo\n",  # unknown action
        H + "1,merge_into,,,no target\n",
        H + "1,exclude,,,a\n1,exclude,,,b\n",  # duplicate
        H + "1,exclude,,,\n",  # no reason
        H + "1,title,,,no title\n",
        H + "1,title,,  ,blank title\n",
        H + "1,exclude,,Some Title,title on another action\n",
        H + "1,title,2,Some Title,target on a title line\n",
    ],
)
def test_invalid_files_are_rejected(tmp_path, content):
    f = tmp_path / "o.csv"
    f.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError):
        bc.load_manual_overrides(f)


# --- Manual merges -------------------------------------------------------------------------------


def test_saturn_3_target_takes_valid_ids_and_keeps_its_old_imdb_id():
    movies = _movies(
        [
            (2851, None, "tt0081454", "Saturn 3", 1980, 632, None, False),  # dead id, no tmdb
            (168358, 19761, "tt0079285", "Saturn 3", 1980, 42, "movie", True),
        ]
    )
    o = _overrides([(168358, "merge_into", 2851, "dup")])
    merges, imdb_over, tmdb_over, refused = bc.resolve_manual_merges(movies, o)
    assert refused == []
    assert imdb_over == {2851: "tt0079285"} and tmdb_over == {2851: 19761}
    row = merges.row(0, named=True)
    assert (row["movie_id_from"], row["movie_id_to"], row["origin"]) == (168358, 2851, "manual")
    assert row["imdb_id_to"] == "tt0079285" and row["imdb_id_to_original"] == "tt0081454"


def test_blue_angel_target_keeps_its_own_valid_ids():
    movies = _movies(
        [
            (
                4970,
                228,
                "tt0020697",
                "Blue Angel, The (Blaue Engel, Der)",
                1930,
                1144,
                "movie",
                True,
            ),
            (100538, 162806, "tt0818931", "Blue Angel, The", 1930, 30, None, False),
        ]
    )
    o = _overrides([(100538, "merge_into", 4970, "dup")])
    merges, imdb_over, tmdb_over, refused = bc.resolve_manual_merges(movies, o)
    assert refused == [] and imdb_over == {} and tmdb_over == {}
    assert merges.row(0, named=True)["imdb_id_from"] == "tt0818931"  # future alias


@pytest.mark.parametrize(
    ("title", "year", "why"),
    [
        ("Blue Angel, The", 1959, "titre ou année"),  # the 1959 remake
        ("Blue Devil, The", 1930, "titre ou année"),
        ("Blue Angel, The", None, "titre ou année"),  # unknown year: cannot confirm
    ],
)
def test_manual_merge_refused_when_title_or_year_differ(title, year, why):
    movies = _movies(
        [
            (4970, 228, "tt1", "Blue Angel, The (Blaue Engel, Der)", 1930, 1144, "movie", True),
            (9, 5, "tt2", title, year, 30, "movie", True),
        ]
    )
    merges, _, _, refused = bc.resolve_manual_merges(
        movies, _overrides([(9, "merge_into", 4970, "x")])
    )
    assert merges.height == 0 and why in refused[0]["why"]


def test_manual_merge_refused_when_absent_or_already_merged():
    movies = _movies([(1, 5, "tt1", "A", 2000, 100, "movie", True)])
    o = _overrides([(2, "merge_into", 1, "x")])
    assert "absent" in bc.resolve_manual_merges(movies, o)[3][0]["why"]
    movies = _movies(
        [(1, 5, "tt1", "A", 2000, 100, "movie", True), (2, 6, "tt2", "A", 2000, 30, "movie", True)]
    )
    refused = bc.resolve_manual_merges(movies, o, frozenset({1}))[3]
    assert "automatique" in refused[0]["why"]


# --- On the real build (skipped until it has run) ------------------------------------------------


@pytest.fixture(scope="module")
def catalog():
    if not bc.CATALOG_PARQUET.exists():
        pytest.skip("catalog.parquet absent")
    return pl.read_parquet(bc.CATALOG_PARQUET)


def test_real_overrides_applied(catalog):
    ids = set(catalog["movie_id"].to_list())
    assert {170355, 168358, 100538}.isdisjoint(ids) and {4848, 2851, 4970} <= ids
    saturn = catalog.filter(pl.col("movie_id") == 2851).row(0, named=True)
    assert (saturn["imdb_id"], saturn["tmdb_id"]) == ("tt0079285", 19761)
    merges = pl.read_parquet(bc.MERGES_PARQUET)
    assert set(merges.filter(pl.col("origin") == "manual")["movie_id_from"]) == {168358, 100538}
