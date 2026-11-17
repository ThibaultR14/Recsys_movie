"""Step 8b, U0 (docs/etape-8b-ux-resultats.md): measures for the results-page filters and search.

Reads web/public/data/catalog.json and the TMDB cache of step 8 (data/cache/tmdb/full/); no HTTP,
writes nothing to web/public/data/. Counts and sizes only (no title, no name printed).

    uv run python ux_diagnostics.py measure

- coverage of runtime and original_language;
- people by TMDB id (directors + actors of the first 5 roles in >= 3 catalogue films), names
  shared by several ids;
- size of catalog.json v4 (same serialisation as export.py, gzip level 9) with and without the
  actors, actor names FAKED with realistic lengths (first and last names of the directors,
  reshuffled): the real names need one /person call per actor (spec Q2, after the go-ahead);
- web/test-data/ux_extra.json (ignored): language and runtime per item, for
  web/scripts/ux-measure.ts.
"""

from __future__ import annotations

import argparse
import gzip
import json
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

from config import WEB_DATA
from enrich_tmdb import TMDB_CACHE

FULL = TMDB_CACHE / "full"
TOP_ROLES = 5
MIN_FILMS = 3
BUDGET_DELTA = 250_000
BUDGET_TOTAL = 4_000_000
EXTRA_OUT = WEB_DATA.parent.parent / "test-data" / "ux_extra.json"


def dumps(obj) -> bytes:
    """Same serialisation as export.py (`write_json`)."""
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def gz(b: bytes) -> int:
    return len(gzip.compress(b, 9))


def read_full(tmdb_id) -> dict | None:
    if tmdb_id is None:
        return None
    f = FULL / f"{tmdb_id}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))["data"]


def fake_names(n: int, real: list[str], seed: int = 8) -> list[str]:
    """n distinct names built from the first and last tokens of real names (realistic length and
    compressibility; no real person's full name is reproduced on purpose)."""
    rng = random.Random(seed)
    firsts = [r.split()[0] for r in real if len(r.split()) >= 2]
    lasts = [r.split()[-1] for r in real if len(r.split()) >= 2]
    seen = set(real)
    out: list[str] = []
    while len(out) < n:
        name = f"{rng.choice(firsts)} {rng.choice(lasts)}"
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def measure() -> dict:
    cat = json.loads((WEB_DATA / "catalog.json").read_text(encoding="utf-8"))
    n, n_trained = cat["n"], cat.get("n_trained", cat["n"])
    with ThreadPoolExecutor(16) as ex:
        fulls = list(ex.map(read_full, cat["tmdb_id"]))

    lang = [f.get("original_language") if f else None for f in fulls]
    runtime = [(f.get("runtime") or None) if f else None for f in fulls]

    def cov(values, lo, hi):
        part = values[lo:hi]
        return {"n": len(part), "known": sum(v is not None for v in part)}

    # directors: ids from the cache, names compared with catalog.json `directors`
    dir_ids: list[list[int]] = []
    name_of: dict[int, str] = {}
    dir_name_mismatch = 0
    for i, f in enumerate(fulls):
        ds = (f or {}).get("directors") or []
        ids = [d["id"] for d in ds if d.get("id") is not None]
        for d in ds:
            if d.get("id") is not None:
                name_of[d["id"]] = d.get("name") or ""
        if [d.get("name") for d in ds] != (cat["directors"][i] or []):
            dir_name_mismatch += 1
        dir_ids.append(ids)
    director_set = {d for ids in dir_ids for d in ids}

    cast5 = [((f or {}).get("cast") or [])[:TOP_ROLES] for f in fulls]
    films_of = Counter(a for c in cast5 for a in set(c))
    kept_actors = {a for a, k in films_of.items() if k >= MIN_FILMS}
    actor_only = kept_actors - director_set
    pairs = sum(sum(a in kept_actors for a in c) for c in cast5)

    # homonyms among directors (real names known); actors: unknown until the /person calls
    ids_by_name = defaultdict(set)
    for d in director_set:
        ids_by_name[name_of[d]].add(d)
    dir_homonyms = sum(len(v) > 1 for v in ids_by_name.values())
    dir_homonym_ids = sum(len(v) for v in ids_by_name.values() if len(v) > 1)

    # catalog.json v4 sizes (in memory)
    base = dumps(cat)
    langs = sorted({x for x in lang if x}, key=lambda x: (-lang.count(x), x))
    li = {x: k for k, x in enumerate(langs)}
    v4 = dict(cat)
    v4["v"] = 4
    v4["languages"] = langs
    v4["language"] = [li[x] if x else None for x in lang]
    v4["runtime"] = runtime
    size_lr = gz(dumps(v4))

    def with_people(actors: set[int], roles: int, with_ids: bool, dedup: bool = False) -> int:
        """dedup: `directors` (names) dropped from the file, rebuilt by the site from `people` +
        `director_ids` (the names are then stored once)."""
        people = sorted(director_set | actors)
        idx = {p: k for k, p in enumerate(people)}
        names_real = [name_of[p] for p in sorted(director_set)]
        fakes = iter(fake_names(len(actors - director_set), names_real))
        names = [name_of[p] if p in director_set else next(fakes) for p in people]
        out = dict(v4)
        if dedup:
            del out["directors"]
        if with_ids:
            out["people"] = [[p, nm] for p, nm in zip(people, names, strict=True)]
        else:
            out["people"] = names
        out["director_ids"] = [[idx[d] for d in ids] for ids in dir_ids]
        out["cast"] = [[idx[a] for a in c[:roles] if a in actors] for c in cast5]
        return gz(dumps(out))

    def kept(roles: int, min_films: int) -> set[int]:
        cnt = Counter(a for c in cast5 for a in set(c[:roles]))
        return {a for a, k in cnt.items() if k >= min_films}

    others = sum(
        gz(p.read_bytes()) for p in WEB_DATA.iterdir() if p.is_file() and p.name != "catalog.json"
    )
    sizes = {
        "catalog_v3_gz": gz(base),
        "catalog_v4_lang_runtime_gz": size_lr,
        "catalog_v4_directors_only_gz": with_people(set(), TOP_ROLES, True),
    }
    variants = {}
    for roles, mf in [(5, 3), (3, 3), (5, 4), (5, 5)]:
        a = kept(roles, mf)
        s_ids = with_people(a, roles, True)
        s_noids = with_people(a, roles, False)
        variants[f"roles{roles}_min{mf}"] = {
            "actors": len(a),
            "catalog_gz_people_with_ids": s_ids,
            "catalog_gz_people_names_only": s_noids,
            "delta_gz_with_ids": s_ids - gz(base),
            "total_data_gz_with_ids": s_ids + others,
            "delta_gz_dedup_names_only": with_people(a, roles, False, dedup=True) - gz(base),
            "delta_gz_dedup_with_ids": with_people(a, roles, True, dedup=True) - gz(base),
        }
    sizes["delta_directors_only_dedup_names_only"] = with_people(
        set(), TOP_ROLES, False, dedup=True
    ) - gz(base)
    report = {
        "films": n,
        "trained": n_trained,
        "estimated": n - n_trained,
        "cached": sum(f is not None for f in fulls),
        "runtime_known": {
            "trained": cov(runtime, 0, n_trained),
            "estimated": cov(runtime, n_trained, n),
        },
        "language_known": {
            "trained": cov(lang, 0, n_trained),
            "estimated": cov(lang, n_trained, n),
        },
        "languages_distinct": len(langs),
        "directors_distinct_ids": len(director_set),
        "director_name_lists_differing_from_catalog": dir_name_mismatch,
        "director_names_with_several_ids": dir_homonyms,
        "director_ids_in_those_names": dir_homonym_ids,
        "actors_kept": len(kept_actors),
        "actors_kept_also_directors": len(kept_actors & director_set),
        "people_total": len(director_set | kept_actors),
        "actor_only_ids": len(actor_only),
        "film_actor_pairs": pairs,
        "sizes": sizes,
        "others_data_gz": others,
        "variants": variants,
        "budget": {"delta": BUDGET_DELTA, "total": BUDGET_TOTAL},
    }
    EXTRA_OUT.parent.mkdir(parents=True, exist_ok=True)
    EXTRA_OUT.write_text(
        json.dumps({"language": lang, "runtime": runtime}, separators=(",", ":")), encoding="utf-8"
    )
    return report


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("command", choices=["measure"])
    p.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(measure(), indent=2))


if __name__ == "__main__":
    main()
