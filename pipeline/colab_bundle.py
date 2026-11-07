"""Pack what EASE needs on Google Colab into one zip (step 2, C3).

Output: data/processed/colab/ease_bundle.zip (ignored by git). Contents: the pipeline code used by
`train_ease.py`, the catalogue reduced to (item_idx, movie_id, recommendable), the split files and
`bundle_info.json` (git commit, date). Never includes `.env` or anything from data/raw.

Usage (from `pipeline/`):
    uv run python colab_bundle.py
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import zipfile
from datetime import UTC, datetime

import polars as pl

from config import PIPELINE_DIR, PROCESSED, SPLIT_DIR

OUT = PROCESSED / "colab" / "ease_bundle.zip"
CODE = [
    "config.py",
    "evaluate.py",
    "metrics.py",
    "baselines.py",
    "train_ease.py",
    "models/__init__.py",
    "models/als.py",
    "models/ease.py",
]
SPLIT_FILES = [
    "manifest.json",
    "train.parquet",
    "val_foldin.parquet",
    "val_heldout.parquet",
    "test_foldin.parquet",
    "test_heldout.parquet",
]


def git_commit() -> str:
    out = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    dirty = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
    return out.stdout.strip() + (" (dirty)" if dirty.stdout.strip() else "")


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    catalog = pl.read_parquet(
        PROCESSED / "catalog.parquet", columns=["item_idx", "movie_id", "recommendable"]
    )
    buf = io.BytesIO()
    catalog.write_parquet(buf)
    info = {"created_at": datetime.now(UTC).isoformat(timespec="seconds"), "commit": git_commit()}
    # parquet is already compressed: store, don't deflate
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_STORED) as z:
        for rel in CODE:
            z.write(PIPELINE_DIR / rel, f"pipeline/{rel}")
        z.writestr("pipeline/data/processed/catalog.parquet", buf.getvalue())
        for name in SPLIT_FILES:
            z.write(SPLIT_DIR / name, f"pipeline/data/processed/split/{name}")
        z.writestr("pipeline/bundle_info.json", json.dumps(info, indent=2) + "\n")
    print(f"-> {OUT} ({OUT.stat().st_size / 2**20:.1f} MiB), commit {info['commit']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
