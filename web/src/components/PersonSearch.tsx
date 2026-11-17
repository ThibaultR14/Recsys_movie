import { useId, useRef, useState } from 'react';
import { PEOPLE } from '../content/people';
import type { PersonSuggestion } from '../reco/people';

interface PersonSearchProps {
  /** Suggestions for a query (the worker's people index; nothing goes on the network). */
  search: (query: string) => Promise<PersonSuggestion[]>;
  onPick: (s: PersonSuggestion) => void;
}

/**
 * « des films de… » (step 8b, D4): a combobox with a list of suggestions (ARIA 1.2 pattern:
 * role="combobox", aria-expanded, aria-controls -> role="listbox", aria-activedescendant;
 * arrows up and down, Enter picks, Escape closes).
 */
export function PersonSearch({ search, onPick }: PersonSearchProps) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PersonSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const last = useRef(0);

  // the last query only: an older answer is ignored
  const onQuery = (value: string) => {
    setQuery(value);
    setOpen(true);
    const id = ++last.current;
    if (!value.trim()) {
      setItems([]);
      return;
    }
    void search(value).then((found) => {
      if (id !== last.current) return;
      setItems(found);
      setActive(found.length ? 0 : -1);
    });
  };

  const expanded = open && items.length > 0;
  const pick = (s: PersonSuggestion) => {
    onPick(s);
    onQuery('');
    setOpen(false);
  };
  const optionId = (k: number) => `${listId}-${k}`;

  return (
    <div className="relative flex max-w-[460px] flex-col gap-2">
      <label htmlFor={inputId} className="text-[15px] font-bold">
        {PEOPLE.label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        placeholder={PEOPLE.placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === 'Enter' && expanded && active >= 0) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === 'Escape') {
            if (expanded) setOpen(false);
            else onQuery('');
          }
        }}
        className="h-11 rounded-[3px] border-2 border-ink bg-surface px-3 text-[16px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={PEOPLE.label}
        hidden={!expanded}
        className="absolute top-full z-10 m-0 mt-1 w-full list-none rounded-[3px] border-2 border-ink bg-surface p-0 shadow-photo"
      >
        {items.map((s, k) => (
          <li
            key={s.person}
            id={optionId(k)}
            role="option"
            aria-selected={k === active}
            // mousedown, not click: the input keeps the focus (no blur before the pick)
            onMouseDown={(e) => {
              e.preventDefault();
              pick(s);
            }}
            onMouseEnter={() => setActive(k)}
            className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1 ${
              k === active ? 'bg-ink text-paper' : 'text-ink'
            }`}
          >
            <span className="text-[16px]">{s.name}</span>
            <span className={`text-[13px] ${k === active ? 'text-paper' : 'text-muted'}`}>
              {PEOPLE.detail(s)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
