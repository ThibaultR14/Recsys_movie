"""Step 8b (D4-D5): people of the « des films de… » search (synthetic TMDB records)."""

import people as ppl


def rec(directors, cast):
    return {"directors": [{"id": i, "name": n} for i, n in directors], "cast": cast}


def test_directors_rebuilt_identical_whatever_the_cache_order():
    fulls = [
        rec([(1, "A"), (2, "B")], []),  # the cache lists B first on film 1 below
        rec([(2, "B"), (1, "A")], []),
        None,  # no record: A is found by its name elsewhere (one id)
        rec([], []),  # a name absent from the cache and elsewhere: its own entry
    ]
    directors = [["A", "B"], ["A", "B"], ["A"], ["Z"]]
    out = ppl.build_people(fulls, directors, {})
    assert ppl.rebuild_directors(out["people"], out["director_ids"]) == directors
    assert out["director_ids"][0] == out["director_ids"][1] == [0, 1]
    assert out["director_ids"][2] == [0]
    assert out["stats"]["director_names_without_id"] == 1


def test_namesakes_are_two_entries_and_one_person_both_roles_is_one():
    fulls = [
        rec([(1, "Same Name")], [7, 8]),
        rec([(2, "Same Name")], [7, 8]),
        rec([(3, "C")], [7, 1, {"id": 8, "name": "x"}]),  # 1: the director also acts
        rec([(4, "D")], [1, 9]),
        rec([(5, "E")], [1, 9]),
    ]
    directors = [["Same Name"], ["Same Name"], ["C"], ["D"], ["E"]]
    names = {7: "Actor Seven", 8: "Actor Eight", 1: "Same Name"}  # 9: no cached name
    out = ppl.build_people(fulls, directors, names, min_films=3)
    p = out["people"]
    # two directors named the same: two entries
    assert out["director_ids"][0] != out["director_ids"][1]
    assert p[out["director_ids"][0][0]] == p[out["director_ids"][1][0]] == "Same Name"
    # actor 1 is director 1: one entry, cast points to it
    assert out["director_ids"][0][0] in out["cast"][2]
    # kept actors: >= 3 films (7, 8, 1); 9 has 2 films (and no name); cast in role order
    assert [p[k] for k in out["cast"][2]] == ["Actor Seven", "Same Name", "Actor Eight"]
    assert out["cast"][3] == out["cast"][4] == [out["director_ids"][0][0]]
    assert out["stats"]["actors"] == 3 and out["stats"]["actors_also_directors"] == 1
    assert out["stats"]["names_with_several_ids"] == 1


def test_kept_actors_first_roles_and_threshold():
    casts = ppl.cast_lists(
        [{"cast": [1, 2, 3, 4, 5, 6]}, {"cast": [6, 1]}, {"cast": [{"id": 1, "name": "x"}]}, None]
    )
    assert casts == [[1, 2, 3, 4, 5], [6, 1], [1], []]
    assert ppl.kept_actors(casts, 3) == {1}
    assert ppl.kept_actors(casts, 2) == {1}
    assert ppl.slim_person({"id": 4, "name": "N", "biography": "b", "birthday": "x"}) == {
        "id": 4,
        "name": "N",
    }
