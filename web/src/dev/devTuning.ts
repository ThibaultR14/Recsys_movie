/**
 * Dev-only switches of the settings (docs/etape-8-analyse-reglages.md, end of the document), read
 * from the URL query: used only behind `import.meta.env.DEV`, so absent from the production build.
 *
 *   ?calibration=0            no genre calibration
 *   ?lambda=0.5               λ = 0,5 at the notches <= 5 000 (the left notches unchanged)
 *   ?lambda=0.1,0.1,…         one λ per notch (8 values, ∞ first)
 *   ?qualite=0                no quality term; ?qualite=0.2: gamma = 0,2
 *   ?recents=0                estimated films never recommended (still in the profile)
 *   ?recents=aucun            estimated films neither recommended nor in the profile
 *   ?classiques=0.5           classics bonus, gamma_c = 0,5, threshold at the percentile
 *                             DEFAULT_PERCENTILE (or ?centile=98); ?classiques_estimes=1: estimated
 *                             films get it too; ?classiques=0: no bonus (before R6e)
 *
 * Back to the settings before R6e (step 8, one switch each, to compare):
 *   ?lambda=0.9               λ = 0,9 at 5 000 again
 *   ?plafond_estimes=0        no cap of the estimated films per row
 *   ?tampon_estimes=1         « ✱ pépite » allowed on estimated films
 *   ?explication_estimes=1    « parce que t'as aimé » on estimated films
 *   ?q_estimes=catalogue      q of the estimated films from the catalogue-wide line (R6b)
 *   ?avant=1                  all of the above at once
 */
import type { Tuning } from '../reco/engine';

export const DEFAULT_PERCENTILE = 99;

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const x = Number(v.replace(',', '.'));
  return Number.isFinite(x) ? x : undefined;
}

/** Tuning of a query string, or undefined when no switch is set (production settings). */
export function parseDevTuning(search: string): Tuning | undefined {
  const q = new URLSearchParams(search);
  const t: Tuning = {};
  if (q.get('calibration') === '0') t.calibration = false;
  const lambda = q.get('lambda');
  if (lambda !== null) {
    // a list: 8 values separated by « ; » or « , » (« 0,5 » alone is one value)
    const raw = lambda.includes(';') ? lambda.split(';') : lambda.split(',');
    const parts = raw.length > 2 ? raw.map((s) => num(s)) : [num(lambda)];
    if (parts.length > 1 && parts.every((x) => x !== undefined)) t.lambda = parts as number[];
    else if (parts.length === 1 && parts[0] !== undefined) t.lambda = parts[0];
  }
  const qualite = num(q.get('qualite'));
  if (qualite === 0) t.quality = false;
  else if (qualite !== undefined) t.gamma = qualite;
  const recents = q.get('recents');
  if (recents === '0') t.recent = 'not-recommended';
  else if (recents === 'aucun') t.recent = 'off';
  const before = q.get('avant') === '1';
  const gc = before ? 0 : num(q.get('classiques'));
  if (gc !== undefined) {
    t.classics = {
      gamma: gc,
      percentile: num(q.get('centile')) ?? DEFAULT_PERCENTILE,
      ...(q.get('classiques_estimes') === '1' && { estimated: true }),
    };
  }
  if (before) t.lambda = 0.9;
  if (before || q.get('plafond_estimes') === '0') t.estimatedPerRow = false;
  if (before || q.get('tampon_estimes') === '1') t.estimatedStamp = true;
  if (before || q.get('explication_estimes') === '1') t.estimatedExplain = true;
  if (before || q.get('q_estimes') === 'catalogue') t.estimatedQuality = 'catalog';
  return Object.keys(t).length ? t : undefined;
}

const fr = (x: number) => String(x).replace('.', ',');

/** Short description for the dev banner. */
export function describeTuning(t: Tuning): string {
  const parts: string[] = [];
  if (t.calibration === false) parts.push('sans calibration');
  if (typeof t.lambda === 'number') parts.push(`λ ${fr(t.lambda)} (≤ 5 000)`);
  else if (t.lambda) parts.push(`λ ${t.lambda.map(fr).join(' / ')}`);
  if (t.quality === false) parts.push('sans qualité');
  if (t.gamma !== undefined) parts.push(`γ ${fr(t.gamma)}`);
  if (t.recent === 'not-recommended') parts.push('films estimés non recommandés');
  if (t.recent === 'off') parts.push('films estimés ni recommandés ni dans le profil');
  if (t.classics?.gamma === 0) parts.push('sans bonus des classiques');
  else if (t.classics) {
    parts.push(
      `classiques γc ${fr(t.classics.gamma)}, centile ${fr(t.classics.percentile)}` +
        (t.classics.estimated ? ', estimés compris' : ''),
    );
  }
  if (t.estimatedPerRow === false) parts.push('estimés sans plafond par rangée');
  if (t.estimatedStamp) parts.push('tampon permis sur les estimés');
  if (t.estimatedExplain) parts.push('« parce que t’as aimé » sur les estimés');
  if (t.estimatedQuality === 'catalog') parts.push('q des estimés : droite du catalogue');
  return parts.join(' · ');
}
