/**
 * Inline markup of the content texts: `{en:…}` marks English words (real labels of other sites),
 * rendered with lang="en" by RichText. `plainText` removes the markup (tests, screen texts).
 */
export const EN_MARK = /\{en:([^}]*)\}/g;

export function plainText(text: string): string {
  return text.replace(EN_MARK, '$1');
}

/** Text split into plain and English parts, in order. */
export function textParts(text: string): { text: string; en: boolean }[] {
  const parts: { text: string; en: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(EN_MARK)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), en: false });
    parts.push({ text: m[1]!, en: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), en: false });
  return parts;
}
