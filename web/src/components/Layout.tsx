import type { ReactNode } from 'react';
import { NAV } from '../content/nav';
import { PAGE_HASH, type Page } from '../pages/pages';
import { HandNote } from './HandNote';
import { ThemeToggle } from './ThemeToggle';

interface LayoutProps {
  children: ReactNode;
  /** Kept for the callers; since step 6b R9 every screen uses the same 1 200 px container, aligned
   * on the header, and text blocks keep a reading width of ~65 characters. */
  width?: 'narrow' | 'wide';
  /** Analysis and results: « ← changer de fichier » at the top of the content (and the logo). */
  onBack?: () => void;
  /** Page shown (« comment ça marche », « à propos », « contact »): aria-current, « ← retour ». */
  page?: Page;
}

const linkClass = 'text-ink underline hover:text-pen';

const NAV_LINKS: { page: Page; label: string }[] = [
  { page: 'comment-ca-marche', label: NAV.commentCaMarche },
  { page: 'a-propos', label: NAV.aPropos },
  { page: 'contact', label: NAV.contact },
];

/** Page frame (step 6b, D2): header with the logo, the navigation and the theme button on every
 * screen; main column; footer with the TMDB notice. */
export function Layout({ children, onBack, page }: LayoutProps) {
  const col = 'mx-auto w-full max-w-[1200px] px-6';
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header
        className={`${col} flex flex-wrap items-center justify-between gap-x-6 gap-y-1 pt-8 pb-6`}
      >
        <span className="flex items-baseline gap-3">
          <a
            href="#"
            onClick={onBack}
            className="inline-flex min-h-11 items-center text-[22px] font-bold text-ink no-underline hover:text-pen"
          >
            pépite
          </a>
          <HandNote rotate={-4} size={20}>
            (nom provisoire)
          </HandNote>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-0 text-[15px] sm:gap-x-6">
          <nav aria-label="navigation" className="flex flex-wrap gap-x-4 sm:gap-x-6">
            {NAV_LINKS.map((l) => (
              <a
                key={l.page}
                href={PAGE_HASH[l.page]}
                aria-current={page === l.page ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center ${linkClass} aria-[current=page]:font-bold`}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <ThemeToggle />
        </span>
      </header>
      <main className={`${col} flex grow flex-col pb-16`}>
        {page ? (
          <a
            href="#"
            className={`inline-flex min-h-11 w-fit items-center text-[15px] ${linkClass}`}
          >
            {NAV.retour}
          </a>
        ) : (
          onBack && (
            <button
              type="button"
              onClick={onBack}
              className={`min-h-11 w-fit cursor-pointer bg-transparent p-0 text-[15px] ${linkClass}`}
            >
              {NAV.changerDeFichier}
            </button>
          )
        )}
        {children}
      </main>
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
