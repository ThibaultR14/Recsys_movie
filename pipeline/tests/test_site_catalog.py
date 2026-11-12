import numpy as np
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
            "ml_mean_rating": [4.284, 3.85, 3.849],
            "ml_rating_count": [102929, 20, 1240],
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
    assert c["v"] == 3
    assert c["n_trained"] == 3 and c["tmdb_mean"] == [] and c["tmdb_count"] == []
    assert c["ml_mean"] == [43, 39, 38]  # x 10, half up
    assert c["ml_count"] == [102929, 20, 1240]


def test_mean_x10_rounding():
    assert [sc.mean_x10(x) for x in (0.86, 3.05, 3.149, 4.95, None)] == [9, 31, 31, 50, None]


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


def test_version_pairs_written_to_catalog_json():
    o = _title_lines(
        [
            (4973, "version_of", 50, None, "cut"),
            (4973, "version_of", 156, None, "cut"),
            (50, "exclude", None, None, "ignored here"),
        ]
    )
    pairs = sc.version_pairs(frame(), o)
    assert pairs == [[2, 0], [2, 1]]
    assert sc.build_catalog_json(frame(), None, pairs)["version_of"] == [[2, 0], [2, 1]]
    assert sc.build_catalog_json(frame())["version_of"] == []
    with pytest.raises(ValueError):
        sc.version_pairs(frame(), _title_lines([(999, "version_of", 50, None, "not in catalogue")]))


# --- « ça divise » (step 6c, Q6) -------------------------------------------------------------


def test_rating_dispersion_is_the_population_std():
    ratings = pl.LazyFrame({"movieId": [1, 1, 2, 2, 2, 2], "rating": [1.0, 5.0, 3.0, 3, 3, 3]})
    d = sc.rating_dispersion(ratings).sort("movieId")
    assert d["std"].to_list() == [2.0, 0.0] and d["n"].to_list() == [2, 4]


def test_shrunk_std_pulls_small_samples_towards_the_mean():
    std, n = np.array([2.0, 2.0, 0.0]), np.array([20, 20_000, 1000])
    s = sc.shrunk_std(std, n, k=50)
    vbar = (4 + 4 + 0) / 3
    assert s[0] == pytest.approx(np.sqrt((20 * 4 + 50 * vbar) / 70))
    assert s[1] > s[0] and s[1] == pytest.approx(2.0, abs=0.01)  # many ratings: almost the raw std


def test_divisive_items_are_the_top_share_sorted():
    rng = np.random.default_rng(0)
    std, n = rng.random(1000) + 0.5, rng.integers(20, 5000, 1000)
    out = sc.divisive_items(std, n, share=0.10)
    assert out == sorted(out) and 95 <= len(out) <= 105
    s = sc.shrunk_std(std, n)
    assert min(s[out]) >= max(np.delete(s, out))  # exactly the most dispersed ones
    assert sc.build_catalog_json(frame(), None, None, [2])["divisive"] == [2]
    assert sc.build_catalog_json(frame())["divisive"] == []


def test_estimated_films_follow_the_trained_ones():
    cat = frame()
    est = pl.DataFrame(
        {
            "tmdb_id": [1001],
            "title": ["Un film récent"],
            "original_title": ["Ein neuer Film"],
            "year": [2025],
            "imdb_id": ["tt30000001"],
            "director_names": [["A. Réalisatrice"]],
            "poster_path": ["/c.jpg"],
            "ml_genres": [["Drama"]],
            "vote_average": [6.85],
            "vote_count": [812],
        }
    )
    full = pl.concat([cat, sc.estimated_frame(est, cat.height, cat.schema)])
    c = sc.build_catalog_json(full, n_trained=cat.height, estimated=est)
    assert c["n"] == 4 and c["n_trained"] == 3
    assert c["title"][3] == "Un film récent" and c["original_title"]["3"] == "Ein neuer Film"
    assert c["ml_mean"][3] is None and c["ml_count"][3] is None
    assert c["tmdb_mean"] == [34] and c["tmdb_count"] == [812]  # 6.85 / 2 = 3.425 -> « 3,4 »
    assert c["genres"][3] == [c["genre_names"].index("Drama")]
    idx = sc.build_title_index(full)
    keys = {k for k, post in zip(idx["keys"], idx["post"], strict=True) if 4 * 3 in post}
    assert keys == {"un film recent"}  # TMDB title as source 0
    assert sc.tmdb_mean_x10(None) is None
