import zipfile

import polars as pl
import pytest

import download as dl


def test_parse_checksums_md5sum_and_bsd_styles():
    text = (
        "8f033867bcb4e6be8792b21468b4fa6e  links.csv\n"
        "MD5 (ml-32m/movies.csv) = 0DF90835C19151F9D819D0822E190797\n"
        "\n"
        "garbage line\n"
    )
    assert dl.parse_checksums(text) == {
        "links.csv": "8f033867bcb4e6be8792b21468b4fa6e",
        "movies.csv": "0df90835c19151f9d819d0822e190797",
    }


def test_safe_extract_rejects_path_traversal(tmp_path):
    archive = tmp_path / "evil.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../escape.txt", "nope")
    with pytest.raises(RuntimeError):
        dl.safe_extract(archive, tmp_path / "out")
    assert not (tmp_path / "escape.txt").exists()


def test_md5_of(tmp_path):
    f = tmp_path / "a.txt"
    f.write_bytes(b"abc")
    assert dl.md5_of(f) == "900150983cd24fb0d6963f7d28e17f72"


# --- Acceptance checks on the real data (skipped when not downloaded) ---------------------------

needs_data = pytest.mark.skipif(
    not dl.RATINGS_PARQUET.exists(), reason="run `uv run python download.py` first"
)


@needs_data
def test_ratings_parquet_matches_movielens_32m():
    stats = (
        pl.scan_parquet(dl.RATINGS_PARQUET)
        .select(
            rows=pl.len(),
            users=pl.col("userId").n_unique(),
            lo=pl.col("rating").min(),
            hi=pl.col("rating").max(),
            off_grid=((pl.col("rating") * 2) % 1 != 0).sum(),
        )
        .collect()
        .row(0, named=True)
    )
    assert stats["rows"] == 32_000_204
    assert stats["users"] == 200_948
    assert (stats["lo"], stats["hi"]) == (0.5, 5.0)
    assert stats["off_grid"] == 0


@needs_data
def test_movies_and_links():
    assert pl.scan_csv(dl.MOVIELENS_DIR / "movies.csv").select(pl.len()).collect().item() == 87_585
    cols = pl.scan_csv(dl.MOVIELENS_DIR / "links.csv").collect_schema().names()
    assert cols == ["movieId", "imdbId", "tmdbId"]
