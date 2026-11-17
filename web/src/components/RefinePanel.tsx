import { useId, useState, type ReactNode } from 'react';
import { GENRE_LABELS, REFINE, languageName } from '../content/refine';
import { DECADES, DURATIONS, activeCount, type Filters, type RefineOptions } from '../reco/filters';

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

const chipClass = (pressed: boolean) =>
  `min-h-11 cursor-pointer rounded-[3px] border-2 px-3 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen ${
    pressed ? 'border-ink bg-ink text-paper' : 'border-rule bg-surface text-ink hover:border-ink'
  }`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="m-0 text-[15px] font-bold">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

interface RefineProps {
  filters: Filters;
  options: RefineOptions | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (filters: Filters) => void;
}

/**
 * « affiner » (step 8b, D3): a disclosure button with the number of active filters, a panel of
 * toggle chips (aria-pressed; OR within a section, AND between sections), and, panel closed or
 * open, the active filters as « × horreur » buttons plus « tout effacer ».
 */
export function RefinePanel({ filters, options, open, onOpenChange, onChange }: RefineProps) {
  const panelId = useId();
  const moreId = useId();
  const docsId = useId();
  const [moreLanguages, setMoreLanguages] = useState(false);
  const all = choices(options);
  const count = activeCount(filters);
  const chips = activeChips(filters, options);
  const chip = (c: Chip) => {
    const pressed = filters[c.key].includes(c.value);
    return (
      <button
        key={`${c.key}:${c.value}`}
        type="button"
        aria-pressed={pressed}
        className={chipClass(pressed)}
        onClick={() => onChange(toggle(filters, c.key, c.value))}
      >
        {c.label}
      </button>
    );
  };
  const shownLanguages = all.languages.slice(0, LANGUAGES_SHOWN);
  const otherLanguages = all.languages.slice(LANGUAGES_SHOWN);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          className="h-11 cursor-pointer rounded-[3px] border-2 border-ink bg-surface px-4 text-[15px] font-bold text-ink hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
          onClick={() => onOpenChange(!open)}
        >
          {count ? REFINE.buttonWithCount(count) : REFINE.button}
        </button>
        {chips.map((c) => (
          <button
            key={`active:${c.key}:${c.value}`}
            type="button"
            aria-label={REFINE.remove(c.label)}
            className="min-h-11 cursor-pointer rounded-[3px] border-2 border-dashed border-ink bg-surface px-3 text-[15px] text-ink hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
            onClick={() => onChange(toggle(filters, c.key, c.value))}
          >
            × {c.label}
          </button>
        ))}
        {!filters.docs && (
          <button
            type="button"
            aria-label={REFINE.remove(REFINE.docsHidden)}
            className="min-h-11 cursor-pointer rounded-[3px] border-2 border-dashed border-ink bg-surface px-3 text-[15px] text-ink hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
            onClick={() => onChange({ ...filters, docs: true })}
          >
            × {REFINE.docsHidden}
          </button>
        )}
        {count > 0 && (
          <button
            type="button"
            className="min-h-11 cursor-pointer border-0 bg-transparent px-2 text-[15px] text-ink underline hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
            onClick={() =>
              onChange({ genres: [], decades: [], durations: [], languages: [], docs: true })
            }
          >
            {REFINE.clearAll}
          </button>
        )}
      </div>
      <div id={panelId} hidden={!open} className="flex flex-col gap-5 border-l-2 border-rule pl-4">
        <Section title={REFINE.genres}>{all.genres.map(chip)}</Section>
        <Section title={REFINE.decades}>{all.decades.map(chip)}</Section>
        <Section title={REFINE.durations}>{all.durations.map(chip)}</Section>
        {all.languages.length > 0 && (
          <Section title={REFINE.languages}>
            {shownLanguages.map(chip)}
            {otherLanguages.length > 0 && (
              <button
                type="button"
                aria-expanded={moreLanguages}
                aria-controls={moreId}
                className="min-h-11 cursor-pointer border-0 bg-transparent px-2 text-[15px] text-ink underline hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
                onClick={() => setMoreLanguages(!moreLanguages)}
              >
                {REFINE.otherLanguages}
              </button>
            )}
            <div id={moreId} hidden={!moreLanguages} className="contents">
              {moreLanguages && otherLanguages.map(chip)}
            </div>
          </Section>
        )}
        <div role="group" aria-labelledby={`${docsId}-t`} className="flex flex-col gap-2">
          <p id={`${docsId}-t`} className="m-0 text-[15px] font-bold">
            {REFINE.alsoShow}
          </p>
          <label
            htmlFor={docsId}
            className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-[15px]"
          >
            <input
              id={docsId}
              type="checkbox"
              checked={filters.docs}
              onChange={(e) => onChange({ ...filters, docs: e.target.checked })}
              className="size-5 accent-pen"
            />
            {REFINE.docs}
          </label>
        </div>
      </div>
    </div>
  );
}
