/**
 * Inline markup of the content texts, rendered by RichText:
 * - `{en:…}` English words (real labels of other sites, article titles): lang="en";
 * - `{a:url|label}` an external link (new tab), `{a-en:url|label}` the same with an English label.
 * `plainText` removes the markup (tests, screen texts).
 */
export const MARK = /\{(en|a|a-en):([^}|]*)(?:\|([^}]*))?\}/g;

export interface TextPart {
  text: string;
  en: boolean;
  /** External link (https only). */
  href?: string;
}

export function plainText(text: string): string {
  return textParts(text)
    .map((p) => p.text)
    .join('');
}

/** Text split into plain, English and link parts, in order. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), en: false });
    const [, kind, first, label] = m;
    if (kind === 'en') {
      parts.push({ text: first!, en: true });
    } else {
      if (!first!.startsWith('https://') || label === undefined) {
        throw new Error(`lien mal formé dans un texte : ${m[0]}`);
      }
      parts.push({ text: label, en: kind === 'a-en', href: first! });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), en: false });
  return parts;
}
