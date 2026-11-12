import { NoList } from '../components/NoList';
import { PageSection, PageTitle, Paragraphs } from '../components/PageSection';
import { RichText } from '../components/RichText';
import { COMMENT_CA_MARCHE as T } from '../content/commentCaMarche';

/** « comment ça marche », detailed (docs/etape-6b-retouches.md, D2). Texts: Claude Web (D8). */
export function CommentCaMarche() {
  return (
    <div className="flex max-w-[65ch] flex-col gap-12 pt-4">
      <PageTitle>{T.titre}</PageTitle>
      <PageSection id="modele" title={T.modele.titre}>
        <Paragraphs items={T.modele.paragraphes} />
      </PageSection>
      <PageSection id="percentiles" title={T.percentiles.titre}>
        <Paragraphs items={T.percentiles.paragraphes} />
      </PageSection>
      <PageSection id="equilibre" title={T.equilibre.titre}>
        <Paragraphs items={T.equilibre.paragraphes} />
      </PageSection>
      <PageSection id="curseur" title={T.curseur.titre}>
        <Paragraphs items={T.curseur.paragraphes} />
      </PageSection>
      <PageSection id="donnees" title={T.donnees.titre}>
        <Paragraphs items={T.donnees.paragraphes} />
        <p className="m-0">compatible avec les exports Letterboxd et IMDb.</p>
      </PageSection>
      <PageSection id="on-garde-rien" title={T.onGardeRien.titre}>
        <NoList items={T.onGardeRien.liste} />
      </PageSection>
      <PageSection id="limites" title={T.limites.titre}>
        <NoList items={T.limites.liste} />
      </PageSection>
      <PageSection id="inspirations" title={T.inspirations.titre}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {T.inspirations.liste.map((item) => (
            <li key={item}>
              <span aria-hidden="true">→ </span>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      </PageSection>
    </div>
  );
}
