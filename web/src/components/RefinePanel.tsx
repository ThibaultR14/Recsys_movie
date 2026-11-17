import { useId, useState, type ReactNode } from 'react';
import { REFINE } from '../content/refine';
import { activeCount, type Filters, type RefineOptions } from '../reco/filters';
import { LANGUAGES_SHOWN, activeChips, choices, toggle, type Chip } from './refineChips';

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
