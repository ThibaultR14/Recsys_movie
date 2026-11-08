// Card annotations (D5, D6). Titles are already shortened by the card.

/** Longer cited titles are cut with « … » (the full text stays for screen readers). */
export const CITED_TITLE_MAX = 32;

export function shortTitle(title: string): string {
  return title.length <= CITED_TITLE_MAX
    ? title
    : `${title.slice(0, CITED_TITLE_MAX - 1).trimEnd()}…`;
}

/** « (parce que t'as aimé X et Y) », or « vu » when the history has no rating at all (Q4). */
export function becauseText(kind: 'liked' | 'seen', titles: readonly string[]): string {
  const verb = kind === 'liked' ? 'aimé' : 'vu';
  const quoted = titles.map((t) => `« ${t} »`);
  return `(parce que t'as ${verb} ${quoted.join(' et ')})`;
}
