/**
 * Theme (docs/etape-6b-retouches.md, D7): dark by default, even when the system is light (Q2).
 * The only thing ever stored in the browser: the key below, written when the user switches to
 * light and removed when they come back to dark. index.html applies it before the first paint.
 */
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'pepite-theme';

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'light') localStorage.setItem(THEME_KEY, 'light');
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // private browsing or blocked storage: the theme works, it is just not remembered
  }
}
