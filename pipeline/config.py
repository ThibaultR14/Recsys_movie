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

# Step 2 (model + offline evaluation), see docs/etape-2-modele.md.
SEED = 42
MIN_EVAL_USER_RATINGS = 10  # users eligible for validation/test (D1)
N_VAL_USERS = 10_000
N_TEST_USERS = 10_000
FOLDIN_NUM, FOLDIN_DEN = 4, 5  # oldest 80 % (rounded down) = fold-in, the rest = held-out (D1)
TOP_K = 20
LONG_TAIL_HEAD_SHARE = 0.2  # "head" = 20 % most popular recommendable movies (D3)
SPLIT_DIR = PROCESSED / "split"
RESULTS_DIR = PROCESSED / "results"

# override=False: real environment variables (e.g. GitHub Actions secrets) win over .env.
load_dotenv(REPO_ROOT / ".env", override=False)
