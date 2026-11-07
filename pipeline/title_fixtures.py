"""Fixtures shared by the Python and TypeScript title normalisation (step 3, D1).

Subcommands (from `pipeline/`):
    uv run python title_fixtures.py casefold-table  # -> shared/fixtures/ (versioned)
    uv run python title_fixtures.py catalog-keys    # -> web/test-data/ (ignored)

`casefold_table.json`: characters that are already lowercase but whose casefold differs (ß -> ss,
ς -> σ…). TypeScript applies `toLowerCase()` then this table to reproduce `str.casefold()`.
`catalog_title_keys.json`: every title string of the catalogue with its normalised form, for the
exhaustive TypeScript test (not versioned: derived from MovieLens and TMDB titles).
"""

from __future__ import annotations

import argparse
import json
import sys

import polars as pl

from config import PROCESSED, REPO_ROOT
from titles import NORMALIZATION_VERSION, normalize_title

SHARED = REPO_ROOT / "shared" / "fixtures"
CASEFOLD_TABLE = SHARED / "casefold_table.json"
NORMALIZATION_CASES = SHARED / "title_normalization.json"
CATALOG_KEYS = REPO_ROOT / "web" / "test-data" / "catalog_title_keys.json"


def casefold_table() -> dict[str, str]:
    table = {}
    for cp in range(sys.maxunicode + 1):
        if 0xD800 <= cp <= 0xDFFF:  # surrogates
            continue
        c = chr(cp)
        if c.lower() == c and c.casefold() != c:
            table[c] = c.casefold()
    return table


def write_json(path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n"
    )


def cmd_casefold_table() -> None:
    table = casefold_table()
    write_json(
        CASEFOLD_TABLE,
        {
            "description": "Lowercase characters whose casefold differs; TypeScript: "
            "toLowerCase() then this table == Python str.casefold().",
            "python": sys.version.split()[0],
            "table": table,
        },
    )
    print(f"-> {CASEFOLD_TABLE} ({len(table)} characters)")


def cmd_catalog_keys() -> None:
    cat = pl.read_parquet(
        PROCESSED / "catalog.parquet", columns=["tmdb_title", "tmdb_original_title", "ml_title"]
    )
    strings = sorted({t for col in cat.columns for t in cat[col].drop_nulls().to_list()})
    write_json(
        CATALOG_KEYS,
        {"norm": NORMALIZATION_VERSION, "cases": [[s, normalize_title(s)] for s in strings]},
    )
    print(f"-> {CATALOG_KEYS} ({len(strings)} strings)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cmd", choices=["casefold-table", "catalog-keys"])
    args = parser.parse_args()
    {"casefold-table": cmd_casefold_table, "catalog-keys": cmd_catalog_keys}[args.cmd]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
