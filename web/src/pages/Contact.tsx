import { PageTitle, Paragraphs } from '../components/PageSection';
import { CONTACT as T } from '../content/contact';

/** « contact » (docs/etape-6b-retouches.md, D3). */
export function Contact() {
  return (
    <div className="flex max-w-[680px] flex-col gap-12 pt-4">
      <PageTitle>{T.titre}</PageTitle>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed">
        <Paragraphs items={T.intro} />
      </div>
    </div>
  );
}
