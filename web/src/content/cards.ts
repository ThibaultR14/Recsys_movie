// Card annotations (D5, D6). Titles are already shortened by the card.

/** « (parce que t'as aimé X et Y) », or « vu » when the history has no rating at all (Q4). */
export function becauseText(kind: 'liked' | 'seen', titles: readonly string[]): string {
  const verb = kind === 'liked' ? 'aimé' : 'vu';
  const quoted = titles.map((t) => `« ${t} »`);
  return `(parce que t'as ${verb} ${quoted.join(' et ')})`;
}
