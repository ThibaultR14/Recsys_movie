import polars as pl
import pytest

import export
import site_catalog as sc


def frame():
    return pl.DataFrame(
        {
            "item_idx": [0, 1, 2],
            "movie_id": [50, 156, 4973],
            "tmdb_title": ["The Usual Suspects", None, "Amélie"],
            "tmdb_original_title": [
                "The Usual Suspects",
                None,
                "Le Fabuleux Destin d'Amélie Poulain",
            ],
            "ml_title": [
                "Usual Suspects, The",
                "City of Lost Children, The (Cité des enfants perdus, La)",
                "Amelie (Fabuleux destin d'Amélie Poulain, Le)",
            ],
            "year": [1995, 1995, None],
            "ml_year": [1995, 1994, 2001],
            "tmdb_id": [629, None, 194],
            "imdb_id": ["tt0114814", "tt0112682", "tt0211915"],
            "imdb_id_aliases": [[], ["tt9999999"], None],
            "tmdb_directors": [["Bryan Singer"], [], ["Jean-Pierre Jeunet"]],
            "poster_path": ["/a.jpg", None, "/b.jpg"],
            "ml_genres": [["Crime", "Thriller"], ["(no genres listed)"], ["Comedy", "Romance"]],
        },
        schema_overrides={"year": pl.Int32, "ml_year": pl.Int32, "tmdb_id": pl.Int64},
    )


def test_catalog_json_columns_and_sparse_fields():
    c = sc.build_catalog_json(frame())
    assert c["n"] == 3
    assert c["title"] == ["The Usual Suspects", "The City of Lost Children", "Amélie"]
    assert c["original_title"] == {"2": "Le Fabuleux Destin d'Amélie Poulain"}
    assert c["year"] == [1995, 1995, None]
    assert c["tmdb_id"] == [629, None, 194]
    assert c["imdb_id_aliases"] == {"1": ["tt9999999"]}
    assert c["genre_names"] == ["Comedy", "Crime", "Romance", "Thriller"]
    assert c["genres"] == [[1, 3], [], [0, 2]]


def test_title_index_keys_sources_and_ml_year():
    idx = sc.build_title_index(frame())
    assert idx["keys"] == sorted(set(idx["keys"]))
    post = dict(zip(idx["keys"], idx["post"], strict=True))
    assert post["the usual suspects"] == [4 * 0 + sc.SRC_TMDB]  # best source kept, no duplicate
    assert post["usual suspects the"] == [4 * 0 + sc.SRC_ML]
    assert post["the city of lost children"] == [4 * 1 + sc.SRC_ML]
    assert post["la cite des enfants perdus"] == [4 * 1 + sc.SRC_ML_ALT]
    assert post["le fabuleux destin d amelie poulain"] == [4 * 2 + sc.SRC_ORIGINAL]
    assert post["amelie"] == [4 * 2 + sc.SRC_TMDB]
    assert idx["ml_year"] == {"1": 1994, "2": 2001}  # only where it differs from year


def test_shared_key_lists_every_film():
    df = frame().with_columns(pl.Series("tmdb_title", ["Amélie", None, "Amélie"]))
    idx = sc.build_title_index(df)
    post = dict(zip(idx["keys"], idx["post"], strict=True))
    assert post["amelie"] == [0, 8]


def test_web_guard_on_catalog_files(tmp_path):
    export.write_compact_json(tmp_path / "ok.json", {"title": ["x"]})
    with pytest.raises(ValueError):
        export.write_compact_json(tmp_path / "bad.json", {"imdbds_num_votes": [1]})


def test_exported_catalog_files_verify():
    if not (export.STAGING / "title-index.json").exists():
        pytest.skip("catalog files not exported (export.py catalog)")
    out = export.cmd_catalog_verify(export.STAGING)
    assert out["films_without_key"] == 0


def _title_lines(rows):
    return pl.DataFrame(
        rows,
        schema={
            "movie_id": pl.Int32,
            "action": pl.String,
            "target_movie_id": pl.Int32,
            "title": pl.String,
            "reason": pl.String,
        },
        orient="row",
    )


def test_manual_title_shown_and_indexed_as_source_0():
    o = _title_lines(
        [
            (156, "title", None, " La Cité des enfants perdus ", "fix"),
            (50, "exclude", None, None, "ignored here"),
        ]
    )
    manual = sc.title_overrides(frame(), o)
    assert manual == {1: "La Cité des enfants perdus"}
    c = sc.build_catalog_json(frame(), manual)
    assert c["title"][1] == "La Cité des enfants perdus"
    assert c["title"][0] == "The Usual Suspects"  # other films untouched
    idx = sc.build_title_index(frame(), manual)
    post = dict(zip(idx["keys"], idx["post"], strict=True))
    assert post["la cite des enfants perdus"] == [4 * 1 + sc.SRC_TMDB]  # was SRC_ML_ALT
    assert post["the city of lost children"] == [4 * 1 + sc.SRC_ML]  # old keys kept


def test_manual_title_keeps_the_tmdb_title_key():
    o = _title_lines([(50, "title", None, "Suspects", "fix")])
    idx = sc.build_title_index(frame(), sc.title_overrides(frame(), o))
    post = dict(zip(idx["keys"], idx["post"], strict=True))
    assert post["suspects"] == [sc.SRC_TMDB]
    assert post["the usual suspects"] == [sc.SRC_TMDB]


def test_manual_title_for_unknown_movie_is_refused():
    with pytest.raises(ValueError):
        sc.title_overrides(frame(), _title_lines([(999, "title", None, "X", "not in catalogue")]))
