/**
 * Contact form -> pre-filled mailto: link (docs/etape-6b-retouches.md, D3). Nothing is added to the
 * user's message: no browser details, no films, no analysis. No request is ever made.
 */
export function mailtoHref(email: string, subject: string, message: string): string {
  const body = message.replace(/\r?\n/g, '\r\n');
  return (
    `mailto:${email}?subject=${encodeURIComponent(`[pépite] ${subject}`)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
