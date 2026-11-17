import { useId } from 'react';
import type { Category } from '../pages/categories';

interface CategoryPickerProps {
  categories: readonly (Category & { index: number })[];
  /** Position index of the engine shown now. */
  index: number;
  onChange: (index: number) => void;
}

/**
 * « plutôt connu ou plutôt pépite ? » (step 8b, D1): three real radio inputs styled as buttons.
 * The arrow keys are the browser's (one radio group); the radio itself is visually hidden but
 * focusable, the label is the button (>= 44 px). Wraps on a 360 px wide phone.
 */
export function CategoryPicker({ categories, index, onChange }: CategoryPickerProps) {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="mb-2.5 p-0 text-[15px] font-bold">plutôt connu ou plutôt pépite ?</legend>
      <div className="flex flex-wrap gap-2.5">
        {categories.map((c) => {
          const id = `${name}-${c.index}`;
          const checked = c.index === index;
          return (
            <label
              key={c.index}
              htmlFor={id}
              className={`relative flex min-h-11 cursor-pointer flex-col justify-center rounded-[3px] border-2 bg-surface px-4 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pen ${
                checked ? 'border-ink' : 'border-rule hover:border-ink'
              }`}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={c.index}
                checked={checked}
                onChange={() => onChange(c.index)}
                className="sr-only"
              />
              <span
                className={`text-[16px] leading-tight ${checked ? 'font-bold text-ink underline decoration-pen decoration-wavy decoration-2 underline-offset-4' : 'text-ink'}`}
              >
                {c.label}
              </span>
              <span className="text-[13px] leading-tight text-muted">{c.sub}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
