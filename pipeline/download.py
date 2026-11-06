"""Download the raw datasets (MovieLens 32M, IMDb) and convert MovieLens ratings to Parquet.

Idempotent: files already present are not downloaded again (use --force to redo everything).
Writes `data/raw/manifest.json` with URL, download date, size and MD5 of every raw file, so we
always know which version of the (daily updated) IMDb datasets was used.

IMDb datasets are for offline use only (joins, imdbId checks, QA): nothing derived from them may
be written to `web/public/data/`.

Usage (from `pipeline/`):
    uv run python download.py [--force] [--skip-imdb]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import polars as pl
import requests
from tqdm import tqdm

from config import PROCESSED, RAW

MOVIELENS_URL = "https://files.grouplens.org/datasets/movielens/ml-32m.zip"
MOVIELENS_ZIP = RAW / "ml-32m.zip"
MOVIELENS_DIR = RAW / "ml-32m"
MOVIELENS_FILES = ("ratings.csv", "movies.csv", "links.csv", "tags.csv")

IMDB_BASE_URL = "https://datasets.imdbws.com/"
IMDB_DIR = RAW / "imdb"
# Only basics + ratings: directors and titles shipped in the site come from TMDB (step B4).
IMDB_FILES = (
    "title.basics.tsv.gz",
    "title.ratings.tsv.gz",
)

RATINGS_PARQUET = PROCESSED / "ratings.parquet"
MANIFEST = RAW / "manifest.json"

RATINGS_SCHEMA = {
    "userId": pl.Int32,
    "movieId": pl.Int32,
    "rating": pl.Float32,
    "timestamp": pl.Int64,
}

CHUNK = 1 << 20  # 1 MiB
USER_AGENT = "pepite-pipeline/0.1 (student project, non-commercial)"


# --- Helpers -----------------------------------------------------------------------------------


def md5_of(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> dict:
    """Stream `url` to `dest` (via a .part file) with a progress bar. Returns HTTP metadata."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with requests.get(url, stream=True, timeout=60, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0)) or None
        with (
            tmp.open("wb") as f,
            tqdm(total=total, unit="B", unit_scale=True, unit_divisor=1024, desc=dest.name) as bar,
        ):
            for chunk in r.iter_content(CHUNK):
                f.write(chunk)
                bar.update(len(chunk))
        meta = {"last_modified": r.headers.get("Last-Modified"), "etag": r.headers.get("ETag")}
    tmp.replace(dest)
    return meta


def parse_checksums(text: str) -> dict[str, str]:
    """Parse a checksums file into {file name: md5}.

    Accepts both `md5sum` style (`<md5>  <name>`) and BSD style (`MD5 (<name>) = <md5>`).
    File names are reduced to their base name.
    """
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if m := re.fullmatch(r"MD5 \((.+)\)\s*=\s*([0-9a-fA-F]{32})", line):
            name, digest = m.group(1), m.group(2)
        elif m := re.fullmatch(r"([0-9a-fA-F]{32})\s+\*?(.+)", line):
            digest, name = m.group(1), m.group(2)
        else:
            continue
        out[Path(name.strip()).name] = digest.lower()
    return out


def safe_extract(zip_path: Path, target: Path) -> None:
    """Extract a zip archive, refusing members that would land outside `target`."""
    target = target.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            out = (target / member.filename).resolve()
            if not out.is_relative_to(target):
                raise RuntimeError(f"Unsafe path in archive: {member.filename}")
        zf.extractall(target)


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"files": {}}


def save_manifest(manifest: dict) -> None:
    manifest["updated_at"] = now()
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def manifest_entry(url: str, path: Path, meta: dict | None = None) -> dict:
    entry = {
        "url": url,
        "downloaded_at": now(),
        "size_bytes": path.stat().st_size,
        "md5": md5_of(path),
    }
    if meta:
        entry.update({k: v for k, v in meta.items() if v})
    return entry


def rel(path: Path) -> str:
    return path.relative_to(RAW).as_posix()


# --- MovieLens ---------------------------------------------------------------------------------


def fetch_movielens(manifest: dict, force: bool) -> None:
    files = manifest["files"]
    key = rel(MOVIELENS_ZIP)

    if force or not MOVIELENS_ZIP.exists():
        meta = download(MOVIELENS_URL, MOVIELENS_ZIP)
        files[key] = manifest_entry(MOVIELENS_URL, MOVIELENS_ZIP, meta)
        save_manifest(manifest)
    else:
        print(f"[skip] {key} already present")
        if key not in files:  # zip present but manifest lost: record it (date unknown -> now)
            files[key] = manifest_entry(MOVIELENS_URL, MOVIELENS_ZIP)

    extracted = all((MOVIELENS_DIR / f).exists() for f in (*MOVIELENS_FILES, "checksums.txt"))
    if force or not extracted:
        if MOVIELENS_DIR.exists():
            shutil.rmtree(MOVIELENS_DIR)
        print(f"Extracting {MOVIELENS_ZIP.name} ...")
        safe_extract(MOVIELENS_ZIP, RAW)
    else:
        print(f"[skip] {rel(MOVIELENS_DIR)}/ already extracted")

    digests = verify_movielens()

    for name in (*MOVIELENS_FILES, "checksums.txt", "README.txt"):
        path = MOVIELENS_DIR / name
        if not path.exists():
            continue
        files[rel(path)] = {
            "url": f"{MOVIELENS_URL}#{name}",
            "downloaded_at": files[key]["downloaded_at"],
            "size_bytes": path.stat().st_size,
            "md5": digests.get(name) or md5_of(path),
        }
    save_manifest(manifest)


def verify_movielens() -> dict[str, str]:
    """Check extracted files against checksums.txt. Returns {file name: md5}."""
    expected = parse_checksums((MOVIELENS_DIR / "checksums.txt").read_text(encoding="utf-8"))
    if not expected:
        raise RuntimeError("checksums.txt is empty or in an unknown format")
    bad = []
    for name, digest in tqdm(sorted(expected.items()), desc="MD5 MovieLens", unit="file"):
        path = MOVIELENS_DIR / name
        actual = md5_of(path) if path.exists() else "missing"
        if actual != digest:
            bad.append(f"{name}: expected {digest}, got {actual}")
    if bad:
        raise RuntimeError("MovieLens checksum mismatch (rerun with --force):\n" + "\n".join(bad))
    print(f"MovieLens MD5 ok ({len(expected)} files)")
    return expected


# --- IMDb --------------------------------------------------------------------------------------


def fetch_imdb(manifest: dict, force: bool) -> None:
    files = manifest["files"]
    for name in IMDB_FILES:
        url = IMDB_BASE_URL + name
        dest = IMDB_DIR / name
        key = rel(dest)
        if force or not dest.exists():
            meta = download(url, dest)
            files[key] = manifest_entry(url, dest, meta)
            save_manifest(manifest)
        else:
            print(f"[skip] {key} already present")
            if key not in files:
                files[key] = manifest_entry(url, dest)
    save_manifest(manifest)


def scan_imdb(name: str) -> pl.LazyFrame:
    """Lazily read an IMDb .tsv.gz: tab separated, `\\N` = null, no quoting at all."""
    return pl.scan_csv(
        IMDB_DIR / name,
        separator="\t",
        quote_char=None,
        null_values="\\N",
        infer_schema=False,  # everything as String; cast explicitly where needed
    )


# --- Parquet -----------------------------------------------------------------------------------


def convert_ratings(force: bool) -> None:
    if RATINGS_PARQUET.exists() and not force:
        print(f"[skip] {RATINGS_PARQUET.name} already present")
        return
    RATINGS_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    tmp = RATINGS_PARQUET.with_name(RATINGS_PARQUET.name + ".part")
    print(f"Converting ratings.csv -> {RATINGS_PARQUET.name} (streaming) ...")
    (
        pl.scan_csv(MOVIELENS_DIR / "ratings.csv", schema=RATINGS_SCHEMA).sink_parquet(
            tmp, compression="zstd"
        )
    )
    tmp.replace(RATINGS_PARQUET)


# --- Sanity checks -----------------------------------------------------------------------------


def report() -> None:
    """Print the acceptance figures (row counts, users, rating values, columns)."""
    stats = (
        pl.scan_parquet(RATINGS_PARQUET)
        .select(
            rows=pl.len(),
            users=pl.col("userId").n_unique(),
            movies=pl.col("movieId").n_unique(),
            min_rating=pl.col("rating").min(),
            max_rating=pl.col("rating").max(),
            off_grid=((pl.col("rating") * 2) % 1 != 0).sum(),
        )
        .collect()
        .row(0, named=True)
    )
    movies = pl.scan_csv(MOVIELENS_DIR / "movies.csv").select(pl.len()).collect().item()
    links_cols = pl.scan_csv(MOVIELENS_DIR / "links.csv").collect_schema().names()
    print("--- MovieLens")
    print(f"ratings rows      : {stats['rows']:,}")
    print(f"distinct users    : {stats['users']:,}")
    print(f"distinct movies   : {stats['movies']:,}")
    print(f"rating range      : {stats['min_rating']} - {stats['max_rating']}")
    print(f"off 0.5 grid      : {stats['off_grid']}")
    print(f"movies.csv rows   : {movies:,}")
    print(f"links.csv columns : {links_cols}")

    present = [n for n in IMDB_FILES if (IMDB_DIR / n).exists()]
    if present:
        print("--- IMDb (offline only)")
        for name in present:
            n = scan_imdb(name).select(pl.len()).collect().item()
            print(f"{name:<22}: {n:,} rows")


# --- Main --------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="download and convert again")
    parser.add_argument("--skip-imdb", action="store_true", help="do not fetch IMDb datasets")
    parser.add_argument("--no-report", action="store_true", help="skip the final sanity report")
    args = parser.parse_args(argv)

    RAW.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    fetch_movielens(manifest, args.force)
    if not args.skip_imdb:
        fetch_imdb(manifest, args.force)
    convert_ratings(args.force)
    if not args.no_report:
        report()
    return 0


if __name__ == "__main__":
    sys.exit(main())
