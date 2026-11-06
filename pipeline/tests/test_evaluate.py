import numpy as np
import polars as pl
import pytest
import scipy.sparse as sp

import evaluate as ev
from baselines import PopularModel, RandomModel


def tiny_catalog():
    # 6 items, item 5 not recommendable
    return ev.Catalog(np.array([10, 20, 30, 40, 50, 60]), np.array([1, 1, 1, 1, 1, 0], bool))


def frame(rows):
    return pl.DataFrame(rows, schema=["userId", "movieId", "rating"], orient="row").with_columns(
        pl.col("userId", "movieId").cast(pl.Int32), pl.col("rating").cast(pl.Float32)
    )


def test_build_eval_set_relevance_and_restriction():
    cat = tiny_catalog()
    foldin = frame([(1, 10, 2.0), (1, 20, 4.0), (2, 10, 3.0)])  # medians: 3.0 and 3.0
    heldout = frame([(1, 30, 3.0), (1, 40, 2.5), (1, 60, 5.0), (2, 20, 1.0)])
    es = ev.build_eval_set(foldin, heldout, cat)
    assert es.user_ids.tolist() == [1, 2]
    assert es.heldout[0].tolist() == [2, 3]  # movie 60 (item 5) dropped: not recommendable
    assert es.relevant[0].tolist() == [2]  # 3.0 >= median 3.0; 2.5 is not
    assert es.relevant[1].tolist() == []  # user 2: no relevant movie
    assert es.n_heldout_dropped == 1
    assert es.foldin[0].indices.tolist() == [0, 1]


def test_top_k_masks_foldin_and_non_recommendable():
    cand = tiny_catalog().recommendable
    foldin = sp.csr_matrix(np.array([[1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], dtype=np.float32))
    scores = np.array([[9, 1, 2, 3, 4, 99], [9, 1, 2, 3, 4, 99]], dtype=np.float32)
    top = ev.top_k(scores, foldin, cand, 3)
    assert top.tolist() == [[4, 3, 2], [0, 4, 3]]


def test_popular_and_random_models():
    foldin = sp.csr_matrix((3, 4), dtype=np.float32)
    pop = PopularModel(np.array([5, 1, 3, 2]))
    assert pop.scores(foldin).shape == (3, 4)
    assert (pop.scores(foldin).argmax(axis=1) == 0).all()
    a, b = RandomModel(4, seed=1).scores(foldin), RandomModel(4, seed=1).scores(foldin)
    assert np.array_equal(a, b)


def test_compute_metrics_end_to_end():
    cat = tiny_catalog()
    foldin = frame([(1, 10, 2.0), (1, 20, 4.0)])
    heldout = frame([(1, 30, 5.0), (1, 50, 1.0)])
    es = ev.build_eval_set(foldin, heldout, cat)
    counts = np.array([100, 90, 80, 70, 60, 1000])
    ranked = ev.recommend(PopularModel(counts), es, cat.recommendable, k=2)
    assert ranked.tolist() == [[2, 3]]  # items 0, 1 in fold-in, item 5 not recommendable
    out = ev.compute_metrics(ranked, es, counts, cat.recommendable, k=2)
    assert out["recall@2"]["mean"] == 1.0  # relevant = {item 2}
    assert out["recall_all@2"]["mean"] == pytest.approx(0.5)  # held-out = {items 2, 4}
    assert out["couverture@2"] == pytest.approx(2 / 5)
