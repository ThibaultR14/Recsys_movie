import { textParts } from '../content/richText';

/** A content text with its `{en:…}` parts in <span lang="en"> (R7). */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {textParts(text).map((p, i) =>
        p.en ? (
          <span key={i} lang="en">
            {p.text}
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
