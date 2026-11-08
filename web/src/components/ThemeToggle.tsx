import { useState } from 'react';
import { THEME } from '../content/theme';
import { applyTheme, currentTheme, type Theme } from '../theme';

const linkClass = 'text-ink underline hover:text-pen';

/** Header button: « passer en clair » / « passer en sombre » (D7). No emoji. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className={`inline-flex min-h-11 cursor-pointer items-center bg-transparent p-0 text-[15px] ${linkClass}`}
    >
      {theme === 'dark' ? THEME.versClair : THEME.versSombre}
    </button>
  );
}
