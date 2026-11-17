// Pure helpers of « affiner » (step 8b, D3): the chips of each section, the active filters.
import { GENRE_LABELS, languageName } from '../content/refine';
import { DECADES, DURATIONS, type Filters, type RefineOptions } from '../reco/filters';

/** Languages shown before « autres langues » (D3). */
export const LANGUAGES_SHOWN = 8;

type ListKey = 'genres' | 'decades' | 'durations' | 'languages';

export interface Chip {
  key: ListKey;
  value: string;
  label: string;
}

/** French labels of the choices of each section, in the panel's order. */
export function choices(options: RefineOptions | undefined): Record<ListKey, Chip[]> {
  const genres = (options?.genres ?? [])
    .filter((g) => GENRE_LABELS[g])
    .map((g) => ({ key: 'genres' as const, value: g, label: GENRE_LABELS[g]! }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  const languages = (options?.languages ?? []).flatMap(({ code }) => {
    const label = languageName(code);
    return label ? [{ key: 'languages' as const, value: code, label }] : [];
  });
  return {
    genres,
    decades: DECADES.map((d) => ({ key: 'decades' as const, value: d.key, label: d.label })),
    durations: DURATIONS.map((d) => ({ key: 'durations' as const, value: d.key, label: d.label })),
    languages,
  };
}

/** Active filters, as the « × horreur » chips show them (panel order). */
export function activeChips(filters: Filters, options: RefineOptions | undefined): Chip[] {
  const all = choices(options);
  const out: Chip[] = [];
  for (const key of ['genres', 'decades', 'durations', 'languages'] as const) {
    for (const value of filters[key]) {
      const chip = all[key].find((c) => c.value === value);
      out.push(chip ?? { key, value, label: value });
    }
  }
  return out;
}

export function toggle(filters: Filters, key: ListKey, value: string): Filters {
  const list = filters[key];
  return {
    ...filters,
    [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
  };
}
