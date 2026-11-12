/**
 * Pages opened by the URL anchor, over the screen state machine (docs/etape-6b-retouches.md, D2).
 * The screen (home, analysis, results) is kept underneath: going back to « # » shows it again.
 */
export type Page = 'comment-ca-marche' | 'a-propos' | 'contact';

export const PAGE_HASH: Record<Page, string> = {
  'comment-ca-marche': '#comment-ca-marche',
  'a-propos': '#a-propos',
  contact: '#contact',
};

/** Section anchors -> their page (the page opens, then scrolls to the section). */
const SECTION_PAGE: Record<string, Page> = {
  '#modele': 'comment-ca-marche',
  '#percentiles': 'comment-ca-marche',
  '#equilibre': 'comment-ca-marche',
  '#curseur': 'comment-ca-marche',
  '#tampons': 'comment-ca-marche',
  '#donnees': 'comment-ca-marche',
  '#on-garde-rien': 'comment-ca-marche',
  '#limites': 'comment-ca-marche',
  '#inspirations': 'comment-ca-marche',
  '#mentions': 'a-propos',
};

export function pageOfHash(hash: string): Page | null {
  const page = (Object.keys(PAGE_HASH) as Page[]).find((p) => PAGE_HASH[p] === hash);
  return page ?? SECTION_PAGE[hash] ?? null;
}

/** True when the anchor names a section inside a page (scroll to it, not to the top). */
export function isSectionHash(hash: string): boolean {
  return hash in SECTION_PAGE;
}
