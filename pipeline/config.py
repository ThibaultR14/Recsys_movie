"""Shared paths and constants for the offline pipeline.

Importing this module loads the repository's root `.env` (TMDB credentials).
Never print or log the values read from it.
"""

from pathlib import Path

from dotenv import load_dotenv

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parent

DATA_DIR = PIPELINE_DIR / "data"
RAW = DATA_DIR / "raw"
PROCESSED = DATA_DIR / "processed"
CACHE = DATA_DIR / "cache"

# Static files served by the website. Nothing derived from IMDb datasets may be written here.
WEB_DATA = REPO_ROOT / "web" / "public" / "data"

# Catalogue: keep movies with at least this many MovieLens ratings.
MIN_RATINGS = 20

# override=False: real environment variables (e.g. GitHub Actions secrets) win over .env.
load_dotenv(REPO_ROOT / ".env", override=False)
