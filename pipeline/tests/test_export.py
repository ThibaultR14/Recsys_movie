import json

import numpy as np
import pytest

import export

# synthetic cases: single_film, all_ties (step 4); version_seen, ties_at_threshold,
# guard_small (6c); with_estimated, estimated_only (step 8)
N_SYNTHETIC = 7


def test_quantize_by_hand_and_zero_row():
    Y = np.array([[1.27, -0.635, 0.0], [0.0, 0.0, 0.0], [-2.0, 1.0, 0.5]], dtype=np.float32)
    q, scales = export.quantize(Y)
    assert scales[0] == pytest.approx(0.01) and scales[1] == 0.0
    assert q[0].tolist() == [127, -64, 0]  # -63.5 rounds half to even -> -64
    assert q[1].tolist() == [0, 0, 0]
    assert q[2].tolist() == [-127, 64, 32]  # 1.0 / (2/127) = 63.5 -> 64 ; 31.75 -> 32
    Yq = export.dequantize(q, scales)
    assert np.abs(Yq - Y).max() <= scales.max() / 2 + 1e-7
    assert np.abs(q).max() <= 127


def test_embeddings_file_roundtrip(tmp_path):
    rng = np.random.default_rng(0)
    Y = rng.normal(size=(7, 4)).astype(np.float32)
    q, scales = export.quantize(Y)
    path = tmp_path / "embeddings.bin"
    export.write_embeddings(path, q, scales)
    raw = path.read_bytes()
    assert raw[:4] == b"PEPE"
    assert len(raw) == 16 + 7 * 4 + 7 * 4
    q2, s2 = export.read_embeddings(path)
    assert np.array_equal(q, q2) and np.array_equal(scales, s2)
    path.write_bytes(raw[:-1])
    with pytest.raises(ValueError):
        export.read_embeddings(path)


def test_web_guard():
    export.assert_web_safe({"movie_ids": [1, 2], "popularity": {"source": "ml_rating_count"}})
    with pytest.raises(ValueError):
        export.assert_web_safe({"imdbds_num_votes": [1]})
    with pytest.raises(ValueError):
        export.assert_web_safe({"popularity": {"source": "imdbds_num_votes"}})


def test_top_under_cap():
    scores = np.array([5.0, 4.0, 3.0, 2.0, 1.0, 9.0])
    seen = np.array([True, False, False, False, False, False])
    rec = np.array([True, True, True, True, True, False])
    pop = np.array([10, 5000, 100, 300, 50, 1], dtype=np.uint32)
    assert export.top_under_cap(scores, seen, rec, pop, None, 3).tolist() == [1, 2, 3]
    assert export.top_under_cap(scores, seen, rec, pop, 300, 3).tolist() == [2, 3, 4]
    assert export.top_under_cap(scores, seen, rec, pop, 60, 3).tolist() == [4]  # short list


def test_fixture_shape():
    if not export.FIXTURE.exists():
        pytest.skip("fixture not generated yet (export.py export)")
    fixture = json.loads(export.FIXTURE.read_text())
    assert len(fixture["cases"]) == export.N_CASES + N_SYNTHETIC
    for case in fixture["cases"]:
        n = len(case["item_idx"])
        assert len(case["movie_id"]) == len(case["rating"]) == len(case["percentile"]) == n
        assert len(case["user_vector"]) == fixture["config"]["factors"]
        assert set(case["top10"]) == {"inf", "2000", "500"}
        for top in case["top10"].values():
            assert len(top["item_idx"]) == fixture["top"]
            assert not set(top["item_idx"]) & set(case["item_idx"])
            assert top["score"] == sorted(top["score"], reverse=True)


def test_exported_files_replay():
    """C5 criterion: read-back identical and fold-in cases replayed from the exported files."""
    if not (export.STAGING / "embeddings.bin").exists() or not export.FINAL_FACTORS.exists():
        pytest.skip("no export in data/processed/export (export.py export)")
    out = export.cmd_verify(export.STAGING)
    assert out["top_lists_identical"] == (export.N_CASES + N_SYNTHETIC) * len(
        export.FIXTURE_POSITIONS
    )
    assert out["max_user_vector_abs_diff"] < 1e-9
