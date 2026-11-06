"""Reference models (step 2, decision D3): `popular` and `random`.

A model exposes `name` and `scores(foldin) -> (n_users, n_items) float32`, where `foldin` is the
batch's fold-in matrix (users x items, CSR, values = ratings). Higher score = better. Masking of
fold-in and non-recommendable items is done by evaluate.py, not by the models.
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp

from config import SEED


class PopularModel:
    """Same ranking for everyone: movies most rated by training users."""

    name = "popular"

    def __init__(self, train_counts: np.ndarray):
        self.item_scores = np.asarray(train_counts, dtype=np.float32)

    def scores(self, foldin: sp.csr_matrix) -> np.ndarray:
        return np.broadcast_to(self.item_scores, (foldin.shape[0], len(self.item_scores))).copy()


class RandomModel:
    """Uniform random ranking, reproducible: one generator seeded once, users in a fixed order."""

    name = "random"

    def __init__(self, n_items: int, seed: int = SEED):
        self.n_items = n_items
        self.rng = np.random.default_rng(seed)

    def scores(self, foldin: sp.csr_matrix) -> np.ndarray:
        return self.rng.random((foldin.shape[0], self.n_items), dtype=np.float32)
