/**
 * Placeholders for the interface texts written by Claude Web (docs/etape-6b-retouches.md, D8).
 * A missing text renders « [texte à venir : <id>] »; `content.test.ts` lists the ones left.
 */
export const PENDING_PREFIX = '[texte à venir : ';

export function pending(id: string): string {
  return `${PENDING_PREFIX}${id}]`;
}

export function isPending(text: string): boolean {
  return text.startsWith(PENDING_PREFIX);
}
