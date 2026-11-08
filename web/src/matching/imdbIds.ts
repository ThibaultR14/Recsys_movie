/**
 * imdb_id -> item_idx, built from catalog.json (ids from MovieLens links.csv, never from the IMDb
 * datasets): main ids first, then the aliases (docs/etape-6-imdb.md, D2).
 */

/** Numeric part of an IMDb id ("tt0114709" and "tt114709" are the same title); null if invalid. */
export function imdbKey(id: string | null | undefined): number | null {
  const m = /^tt(\d+)$/i.exec((id ?? '').trim());
  return m ? Number(m[1]) : null;
}

export class ImdbIdIndex {
  private readonly main = new Map<number, number>();
  private readonly aliases = new Map<number, number>();

  constructor(imdbIds: readonly (string | null)[], aliases: Record<string, string[]> = {}) {
    imdbIds.forEach((id, item) => {
      const k = imdbKey(id);
      if (k !== null && !this.main.has(k)) this.main.set(k, item);
    });
    for (const [item, ids] of Object.entries(aliases)) {
      for (const id of ids) {
        const k = imdbKey(id);
        if (k !== null && !this.main.has(k) && !this.aliases.has(k)) {
          this.aliases.set(k, Number(item));
        }
      }
    }
  }

  lookup(id: string | undefined): { item: number; by: 'imdb_id' | 'imdb_alias' } | null {
    const k = imdbKey(id);
    if (k === null) return null;
    const main = this.main.get(k);
    if (main !== undefined) return { item: main, by: 'imdb_id' };
    const alias = this.aliases.get(k);
    return alias === undefined ? null : { item: alias, by: 'imdb_alias' };
  }
}
