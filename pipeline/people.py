"""Step 8b (docs/etape-8b-ux-resultats.md, D4-D5): the people of the « des films de… » search.

People = directors and actors, one entry per TMDB person; in catalog.json v4:

- `people`: display names (the index is the identity: two namesakes are two entries);
- `director_ids`: per film, indices into `people`, in the order of the v3 `directors` column, which
  is no longer written: the site rebuilds it (names identical to v3, film by film);
- `cast`: per film, indices of the kept actors (first TOP_ROLES roles, in >= MIN_FILMS films of the
  site catalogue, estimated films included), in role order.

Sources: the step 8 TMDB cache (`data/cache/tmdb/full/`: director {id, name}, cast ids) and, for
the actors' names, one `/person/{id}` call per kept actor, cached in `data/cache/tmdb/person/`
with only {id, name} (no biography, birth date or place, nothing else).

    uv run python people.py fetch   # /person/{id} of the kept actors (resumable, per-person cache)
    uv run python people.py stats      # counts (namesakes), no name printed
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

from enrich_tmdb import TMDB_CACHE, WORKERS, Tmdb

FULL = TMDB_CACHE / "full"
PERSON_KIND = "person"
TOP_ROLES = 5
MIN_FILMS = 3


def read_cached(kind: str, key) -> dict | None:
    """Cached TMDB answer (no HTTP, no credentials); None if absent or 404."""
    if key is None:
        return None
    f = TMDB_CACHE / kind / f"{key}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))["data"]


def _id_of(c) -> int | None:
    """A cast entry: an id (step 8 cache) or {id, name} (slim_full since step 8b)."""
    return c.get("id") if isinstance(c, dict) else c


def full_records(tmdb_ids: list) -> list[dict | None]:
    with ThreadPoolExecutor(16) as ex:
        return list(ex.map(lambda t: read_cached("full", t), tmdb_ids))


def cast_lists(fulls: list[dict | None], roles: int = TOP_ROLES) -> list[list[int]]:
    out = []
    for f in fulls:
        ids = [_id_of(c) for c in ((f or {}).get("cast") or [])[:roles]]
        out.append([i for i in ids if i is not None])
    return out


def kept_actors(casts: list[list[int]], min_films: int = MIN_FILMS) -> set[int]:
    films = Counter(a for c in casts for a in set(c))
    return {a for a, k in films.items() if k >= min_films}


def slim_person(raw: dict | None) -> dict | None:
    """Only {id, name} of /person/{id}."""
    if raw is None:
        return None
    return {"id": raw.get("id"), "name": raw.get("name") or None}


def build_people(
    fulls: list[dict | None],
    directors: list[list[str]],
    actor_names: dict[int, str],
    min_films: int = MIN_FILMS,
) -> dict:
    """people / director_ids / cast for catalog.json v4, with counts.

    Directors are keyed by TMDB id, matched by name to the v3 `directors` lists (the cache can list
    them in another order); a name without id on its film takes the id of the same name elsewhere
    when there is exactly one, else gets its own entry. An id seen with two display names gets one
    entry per name (the rebuilt `directors` must equal v3). Actors without a cached name are left
    out. A person both director and actor is one entry (the director's display name).
    """
    by_name: dict[str, set[int]] = defaultdict(set)
    for f in fulls:
        for d in (f or {}).get("directors") or []:
            if d.get("id") is not None and d.get("name"):
                by_name[d["name"]].add(d["id"])
    keys: dict[tuple, int] = {}
    names: list[str] = []
    primary: dict[int, int] = {}  # TMDB id -> first entry

    def entry(key: tuple, name: str) -> int:
        if key not in keys:
            keys[key] = len(names)
            names.append(name)
        return keys[key]

    unmatched = 0
    director_ids: list[list[int]] = []
    for f, dnames in zip(fulls, directors, strict=True):
        on_film = {d.get("name"): d.get("id") for d in (f or {}).get("directors") or []}
        row = []
        for nm in dnames:
            pid = on_film.get(nm)
            if pid is None and len(by_name.get(nm, ())) == 1:
                pid = next(iter(by_name[nm]))
            if pid is None:
                unmatched += 1
                row.append(entry(("name", nm), nm))
                continue
            k = entry(("id", pid, nm), nm)
            primary.setdefault(pid, k)
            row.append(k)
        director_ids.append(row)

    director_pids = set(primary)
    casts = cast_lists(fulls)
    actors = {a for a in kept_actors(casts, min_films) if actor_names.get(a)}
    for a in sorted(actors):
        if a not in primary:
            primary[a] = entry(("id", a, actor_names[a]), actor_names[a])
    cast = [[primary[a] for a in c if a in actors] for c in casts]

    ids_by_display = defaultdict(set)
    for key in keys:
        if key[0] == "id":
            ids_by_display[key[2]].add(key[1])
    actor_display = {names[primary[a]] for a in actors}
    return {
        "people": names,
        "director_ids": director_ids,
        "cast": cast,
        "stats": {
            "people": len(names),
            "actors": len(actors),
            "actors_also_directors": sum(1 for a in actors if a in director_pids),
            "director_names_without_id": unmatched,
            "film_actor_pairs": sum(len(c) for c in cast),
            "names_with_several_ids": sum(len(v) > 1 for v in ids_by_display.values()),
            "actor_names_with_several_ids": sum(
                len(v) > 1 for n, v in ids_by_display.items() if n in actor_display
            ),
            "ids_with_several_names": sum(
                v > 1 for v in Counter(k[1] for k in keys if k[0] == "id").values()
            ),
        },
    }


def rebuild_directors(people: list[str], director_ids: list[list[int]]) -> list[list[str]]:
    """What the site does (catalog.json v4): `directors` from `people` + `director_ids`."""
    return [[people[k] for k in row] for row in director_ids]


def site_frame():
    """The site catalogue (trained films, then the estimated ones), as `export.py catalog`."""
    import evaluate as ev
    import export
    import site_catalog as sc

    return export.site_catalog_frame(sc.load_catalog_frame(ev.CATALOG_PARQUET))[0]


def actor_names_from_cache(ids) -> dict[int, str]:
    out = {}
    for a in ids:
        p = read_cached(PERSON_KIND, a)
        if p and p.get("name"):
            out[a] = p["name"]
    return out


def cmd_fetch() -> None:
    full = site_frame()
    fulls = full_records(full["tmdb_id"].to_list())
    ids = sorted(kept_actors(cast_lists(fulls)))
    api = Tmdb()
    t0 = time.monotonic()

    def one(pid: int):
        return api._cached(
            PERSON_KIND, str(pid), lambda: slim_person(api._get(f"/person/{pid}", {}))
        )

    from tqdm import tqdm

    with ThreadPoolExecutor(WORKERS) as pool:
        got = list(tqdm(pool.map(one, ids), total=len(ids), unit="personne"))
    print(
        f"acteurs gardés : {len(ids)} ; "
        f"sans nom : {sum(not g or not g.get('name') for g in got)} ; "
        f"appels HTTP {api.stats['http']}, cache {api.stats['cache_hits']}, "
        f"nouveaux essais {api.stats['retries']}, {time.monotonic() - t0:.0f} s"
    )


def cmd_stats() -> dict:
    full = site_frame()
    fulls = full_records(full["tmdb_id"].to_list())
    directors = [list(d or []) for d in full["tmdb_directors"].to_list()]
    ids = kept_actors(cast_lists(fulls))
    built = build_people(fulls, directors, actor_names_from_cache(ids))
    ok = rebuild_directors(built["people"], built["director_ids"]) == directors
    stats = {**built["stats"], "kept_actor_ids": len(ids), "rebuilt_directors_identical": ok}
    print(json.dumps(stats, indent=2))
    return stats


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("command", choices=["fetch", "stats"])
    args = p.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    cmd_fetch() if args.command == "fetch" else cmd_stats()


if __name__ == "__main__":
    main()
