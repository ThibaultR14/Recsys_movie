import type { ReactNode } from 'react';
import { HandNote } from '../components/HandNote';
import { NoList } from '../components/NoList';

const TMDB_LOGO = `${import.meta.env.BASE_URL}tmdb-logo.svg`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex scroll-mt-6 flex-col gap-3">
      <h2 id={`${id}-titre`} className="m-0 text-[20px] font-bold">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed">{children}</div>
    </section>
  );
}

/** « à propos »: who we are, how it works, limits, and the mandatory TMDB / MovieLens notices. */
export function APropos() {
  return (
    <div className="flex max-w-[680px] flex-col gap-12 pt-10">
      <h1 className="m-0 text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-normal">
        qui on est,
        <br />
        et comment ça marche.
      </h1>

      <Section id="a-propos" title="qui on est">
        <p className="m-0">
          des étudiants en m2 à l'ece paris. pépite est un projet d'école : gratuit, sans pub, non
          commercial. on l'a fait parce qu'on passait plus de temps à chercher un film qu'à le
          regarder.
        </p>
      </Section>

      <Section id="comment-ca-marche" title="comment ça marche">
        <p className="m-0">
          tu nous donnes ton export letterboxd. ton navigateur le lit, sur ta machine : il n'est
          envoyé nulle part.
        </p>
        <p className="m-0">
          on compare tes goûts à ceux de milliers de cinéphiles qui ont noté des films, et on
          cherche ceux que t'as pas vus et que des gens comme toi ont aimés.
        </p>
        <p className="m-0">
          le curseur choisit entre les films connus et les pépites : plus tu vas vers la droite,
          moins les films proposés ont été vus.
        </p>
        <p className="m-0">compatible avec les exports Letterboxd et IMDb.</p>
        <HandNote rotate={-1.5} size={20}>
          (pour imdb, ça arrive bientôt)
        </HandNote>
      </Section>

      <Section id="on-garde-rien" title="on garde rien">
        <NoList
          items={[
            'pas de compte, pas de cookie, pas de base de données',
            'ton fichier reste dans ton navigateur, et tout disparaît quand tu fermes la page',
            "les affiches viennent de tmdb : leurs serveurs voient passer les affiches affichées, rien d'autre.",
          ]}
        />
      </Section>

      <Section id="limites" title="ce qu'on sait pas faire">
        <NoList
          items={[
            "les films sortis après 2023 : nos données s'arrêtent là",
            'les séries',
            'les films très peu vus (moins de 20 notes dans nos données)',
          ]}
        />
      </Section>

      <Section id="donnees" title="d'où viennent les données">
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
      </Section>
    </div>
  );
}
