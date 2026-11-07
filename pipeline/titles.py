"""Title normalization shared by the catalogue build (manual merges) and the TMDB enrichment.

The same rules will back the browser-side title index (step 3): case, accents and punctuation are
ignored; MovieLens titles also yield their "The X" form and their parenthesized alternate title.
"""

from __future__ import annotations

import unicodedata

NORMALIZATION_VERSION = "titles-v2"


def normalize_title(title: str | None) -> str:
    """Title key, v2 (docs/etape-3-letterboxd.md, D1). Must stay identical to the TypeScript
    `normalize` in web/src/matching/normalize.ts (shared cases: shared/fixtures/).

    casefold -> NFKD -> drop every mark (category M) -> keep letters and numbers (categories L, N),
    anything else becomes a space -> collapse spaces. Defined on Unicode categories only, so that
    JavaScript can reproduce it with \\p{M}, \\p{L}, \\p{N} (v1 used combining classes and isalnum).
    """
    if not title:
        return ""
    t = unicodedata.normalize("NFKD", title.casefold())
    out = []
    for c in t:
        cat = unicodedata.category(c)[0]
        if cat == "M":
            continue
        out.append(c if cat in "LN" else " ")
    return " ".join("".join(out).split())


ARTICLES = ("the", "a", "an", "les", "le", "la", "l'", "il", "el", "der", "die", "das")


def ml_title_variants(title: str) -> str:
    """MovieLens 'City of Lost Children, The (Cité ..., La)' -> 'The City of Lost Children'."""
    t = title.strip()
    if t.endswith(")") and " (" in t:
        t = t[: t.index(" (")].strip()  # alternate/original title in parentheses
    head, sep, art = t.rpartition(", ")
    if sep and art.casefold() in ARTICLES:
        t = f"{art} {head}" if not art.endswith("'") else f"{art}{head}"
    return t


def title_keys(ml: str) -> set[str]:
    """Normalized forms of a MovieLens title: as is, with the article moved back to the front and
    the parenthesized alternate title removed, and that alternate title on its own."""
    keys = {normalize_title(ml), normalize_title(ml_title_variants(ml))}
    t = ml.strip()
    if t.endswith(")") and " (" in t:
        alt = t[t.index(" (") + 2 : -1].strip()
        alt = alt.removeprefix("a.k.a. ").removeprefix("a.k.a ")
        keys |= {normalize_title(alt), normalize_title(ml_title_variants(alt))}
    return keys - {""}
