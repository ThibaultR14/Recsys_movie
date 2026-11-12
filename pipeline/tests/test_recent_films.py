from datetime import date

import recent_films as rf


def test_month_windows_cover_the_range():
    w = rf.month_windows(date(2023, 11, 15), date(2024, 1, 10))
    assert w == [
        (date(2023, 11, 15), date(2023, 11, 30)),
        (date(2023, 12, 1), date(2023, 12, 31)),
        (date(2024, 1, 1), date(2024, 1, 10)),
    ]


def test_slim_full_keeps_only_what_is_used():
    raw = {
        "id": 7,
        "imdb_id": "tt1",
        "title": "T",
        "release_date": "2024-05-01",
        "genres": [{"id": 18, "name": "Drama"}],
        "vote_count": 120,
        "vote_average": 7.1,
        "overview": "abc",
        "credits": {
            "crew": [
                {"id": 1, "name": "A", "job": "Director"},
                {"id": 1, "name": "A", "job": "Director"},
                {"id": 2, "name": "B", "job": "Writer"},
            ],
            "cast": [{"id": 30 + i, "order": 11 - i} for i in range(12)],
        },
        "keywords": {"keywords": [{"id": 5, "name": "k"}]},
        "recommendations": {"results": [{"id": 9}, {"id": 8}], "total_results": 2},
        "similar": {"results": [], "total_results": 0},
    }
    s = rf.slim_full(raw)
    assert s["directors"] == [{"id": 1, "name": "A"}]
    assert s["cast"][0] == 41 and len(s["cast"]) == 10  # sorted by order, 10 kept
    assert s["genres"] == [18] and s["keywords"] == [5]
    assert s["recommendations"] == {"ids": [9, 8], "total": 2}
    assert s["overview_len"] == 3 and "overview" not in s


def test_missing_ids_since_2022_only():
    disc = [
        {"id": 1, "release_date": "2021-12-31"},
        {"id": 2, "release_date": "2022-01-01"},
        {"id": 3, "release_date": "2025-03-01"},
        {"id": 4, "release_date": None},
    ]
    assert rf.missing_ids(disc, catalog_tmdb={3}) == [2]


def test_ml_genres_of():
    assert rf.ml_genres_of([878, 10751, 36, 10770, 18, 878]) == ["Sci-Fi", "Children", "Drama"]
