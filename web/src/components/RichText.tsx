import { textParts } from '../content/richText';

/** A content text: `{en:…}` parts in <span lang="en">, `{a:…}` / `{a-en:…}` as external links
 * opening in a new tab (R7, R9). */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {textParts(text).map((p, i) => {
        const lang = p.en ? 'en' : undefined;
        if (p.href) {
          return (
            <a
              key={i}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              lang={lang}
              className="text-ink underline hover:text-pen"
            >
              {p.text}
              <span className="sr-only" lang="fr">
                {' '}
                (nouvel onglet)
              </span>
            </a>
          );
        }
        return p.en ? (
          <span key={i} lang="en">
            {p.text}
          </span>
        ) : (
          p.text
        );
      })}
    </>
  );
}
