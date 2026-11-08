import { PageSection, PageTitle, Paragraphs } from '../components/PageSection';
import { APROPOS as T } from '../content/apropos';

const TMDB_LOGO = `${import.meta.env.BASE_URL}tmdb-logo.svg`;

/** « à propos »: first person, no school name (D1), and the mandatory TMDB / MovieLens notices. */
export function APropos() {
  return (
    <div className="flex max-w-[680px] flex-col gap-12 pt-4">
      <PageTitle>{T.titre}</PageTitle>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed">
        <Paragraphs items={T.intro} />
        <Paragraphs items={T.pourquoi} />
      </div>

      {/* Mandatory notices (CLAUDE.md): never rewritten by Claude Web. */}
      <PageSection id="mentions" title="crédits">
        <img src={TMDB_LOGO} alt="TMDB" width={160} height={21} className="block h-auto w-40" />
        <p className="m-0" lang="en">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <p className="m-0">
          les notes qui servent à comparer les goûts viennent des données MovieLens, publiées pour
          la recherche :
        </p>
        <p className="m-0 border-l-2 border-rule pl-4 text-[15px]" lang="en">
          F. Maxwell Harper and Joseph A. Konstan. 2015.{' '}
          <cite>The MovieLens Datasets: History and Context.</cite> ACM Transactions on Interactive
          Intelligent Systems (TiiS) 5, 4, Article 19.
        </p>
        <p className="m-0 text-[15px] text-muted">
          pépite n'est ni soutenu ni approuvé par l'université du minnesota, grouplens ou tmdb.
        </p>
      </PageSection>
    </div>
  );
}
