import json

import pytest

import title_fixtures as tf
from titles import NORMALIZATION_VERSION, normalize_title, title_keys

SHARED = json.loads(tf.NORMALIZATION_CASES.read_text(encoding="utf-8"))


def test_shared_cases_version():
    assert SHARED["norm"] == NORMALIZATION_VERSION
    assert len(SHARED["cases"]) >= 75


@pytest.mark.parametrize("case", SHARED["cases"], ids=lambda c: f"{c['group']}:{c['input']!r}")
def test_shared_normalization_cases(case):
    assert normalize_title(case["input"]) == case["expected"]


def test_casefold_table_is_up_to_date_and_complete():
    stored = json.loads(tf.CASEFOLD_TABLE.read_text(encoding="utf-8"))["table"]
    assert stored == tf.casefold_table()
    for s in ["Straße", "ΟΔΥΣΣΕΥΣ", "Αλέξης", "ﬁ", "İ", "ǅ"]:
        assert "".join(stored.get(c, c) for c in s.lower()) == s.casefold()


def test_v2_drops_every_mark_and_keeps_letters_numbers():
    assert normalize_title("পথের") == "পথর"  # vowel signs (marks of class 0) dropped, not spaces
    assert normalize_title("áb") == "ab"
    assert normalize_title("Ⅻ") == "xii"  # NFKD + Nl number


def test_title_keys_movielens_forms():
    keys = title_keys("City of Lost Children, The (Cité des enfants perdus, La)")
    assert "the city of lost children" in keys
    assert "la cite des enfants perdus" in keys
    assert title_keys("Sunset Blvd. (a.k.a. Sunset Boulevard)") >= {"sunset boulevard"}
