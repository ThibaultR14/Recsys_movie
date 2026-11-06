import math

import numpy as np
import pytest

import metrics as m


def arr(*xs):
    return np.array(xs, dtype=np.int32)


def test_recall_hand_example():
    # top 5 = [3, 1, 7, 9, 4]; relevant = {1, 4, 8}: 2 hits / min(5, 3)
    assert m.recall_at_k(arr(3, 1, 7, 9, 4), arr(1, 4, 8), 5) == pytest.approx(2 / 3)


def test_recall_more_relevant_than_k():
    # 25 relevant items, top 20 contains 10 of them: 10 / min(20, 25) = 0.5
    ranked = np.arange(20)
    relevant = np.concatenate([np.arange(0, 20, 2), np.arange(100, 115)])
    assert m.recall_at_k(ranked, relevant, 20) == pytest.approx(0.5)


def test_recall_fewer_relevant_than_k():
    # 2 relevant, both in the top 20 -> 1.0 (not 2/20)
    assert m.recall_at_k(np.arange(20), arr(5, 19), 20) == 1.0


def test_no_relevant_is_none():
    assert m.recall_at_k(np.arange(20), arr(), 20) is None
    assert m.ndcg_at_k(np.arange(20), arr(), 20) is None


def test_ndcg_hand_example():
    # hits at ranks 2 and 5, 3 relevant: DCG = 1/log2(3) + 1/log2(6)
    dcg = 1 / math.log2(3) + 1 / math.log2(6)
    idcg = 1 + 1 / math.log2(3) + 1 / math.log2(4)
    assert m.ndcg_at_k(arr(3, 1, 7, 9, 4), arr(1, 4, 8), 5) == pytest.approx(dcg / idcg)


def test_ndcg_perfect_and_zero():
    assert m.ndcg_at_k(arr(1, 4, 8, 0, 2), arr(1, 4, 8), 5) == pytest.approx(1.0)
    assert m.ndcg_at_k(arr(0, 2, 3), arr(9), 3) == 0.0


def test_ndcg_fewer_relevant_than_k():
    # one relevant item ranked first -> 1.0 even with k = 20
    assert m.ndcg_at_k(np.arange(20), arr(0), 20) == pytest.approx(1.0)
    # same item at rank 2 -> 1/log2(3)
    assert m.ndcg_at_k(np.arange(20), arr(1), 20) == pytest.approx(1 / math.log2(3))


def test_popularity_metrics():
    counts = np.array([0, 9, 99, 999])
    expected = (math.log(10) + math.log(100)) / 2
    assert m.mean_log_popularity(arr(1, 2), counts, 2) == pytest.approx(expected)
    assert m.median_popularity(arr(0, 1, 3), counts, 3) == 9.0
    assert m.median_popularity(arr(1, 2), counts, 2) == 54.0


def test_head_mask_and_long_tail():
    counts = np.array([50, 10, 40, 30, 20, 100])
    candidates = np.array([True, True, True, True, True, False])  # item 5 not recommendable
    head = m.head_mask(counts, candidates, 0.4)  # round(0.4 * 5) = 2 -> items 0 and 2
    assert head.tolist() == [True, False, True, False, False, False]
    assert m.long_tail_share(arr(0, 1, 3, 4), head, 4) == pytest.approx(0.75)


def test_head_mask_ties_broken_by_index():
    head = m.head_mask(np.array([5, 5, 5, 1]), np.ones(4, dtype=bool), 0.5)
    assert head.tolist() == [True, True, False, False]


def test_coverage():
    assert m.coverage([arr(0, 1), arr(1, 2), arr(1, 0)], 10, 2) == pytest.approx(0.3)


def test_mean_ci():
    out = m.mean_ci([1.0, None, 3.0])
    assert out["n"] == 2
    assert out["mean"] == 2.0
    # std (ddof=1) = sqrt(2), sem = 1
    assert out["ci95"] == pytest.approx(1.96)
    assert m.mean_ci([None])["n"] == 0
