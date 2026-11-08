import type { ReactNode } from 'react';
import { HandNote } from './HandNote';

export const ABOUT_HASH = '#a-propos';
export const HOW_HASH = '#comment-ca-marche';

interface LayoutProps {
  children: ReactNode;
  /** 820 px column (home, analysis, about) or 1 100 px (results). */
  width?: 'narrow' | 'wide';
  /** When set, the header shows « ← changer de fichier » instead of the navigation. */
  onBack?: () => void;
}

const linkClass = 'text-ink underline hover:text-pen';

/** Page frame: header (logo, navigation or back link), main column, footer with the TMDB notice. */
export function Layout({ children, width = 'narrow', onBack }: LayoutProps) {
  const col = `mx-auto w-full px-6 ${width === 'wide' ? 'max-w-[1100px]' : 'max-w-[820px]'}`;
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className={`${col} flex flex-wrap items-center justify-between gap-4 py-8`}>
        <span className="flex items-baseline gap-3">
          <a
            href="#"
            className="inline-flex min-h-11 items-center text-[22px] font-bold text-ink no-underline hover:text-pen"
            onClick={onBack}
          >
            pépite
          </a>
          {!onBack && (
            <HandNote rotate={-4} size={20}>
              (nom provisoire)
            </HandNote>
          )}
        </span>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className={`min-h-11 cursor-pointer bg-transparent p-0 text-[15px] ${linkClass}`}
          >
            ← changer de fichier
          </button>
        ) : (
          <nav aria-label="navigation" className="flex gap-6 text-[15px]">
            <a href={HOW_HASH} className={`inline-flex min-h-11 items-center ${linkClass}`}>
              comment ça marche
            </a>
            <a href={ABOUT_HASH} className={`inline-flex min-h-11 items-center ${linkClass}`}>
              qui on est
            </a>
          </nav>
        )}
      </header>
      <main className={`${col} flex grow flex-col pb-16`}>{children}</main>
      <footer className={col}>
        <div className="flex flex-col gap-1.5 border-t border-dashed border-rule pt-5 pb-8 text-[13px] text-muted">
          <span>
            fait à la main par des gens qui regardent trop de films. projet indépendant, sans lien
            avec letterboxd ni imdb.
          </span>
          <span lang="en">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </span>
        </div>
      </footer>
    </div>
  );
}
