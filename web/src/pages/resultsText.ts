// Texts of the results screen (step 5, D5), in the site's tone.

/** Relative score below which « (là, on s'éloigne pas mal de tes goûts habituels) » shows (D5). */
export const FAR_FROM_TASTE = 0.04;

/** Above the grid when at least half of a row of 8 is below FAR_FROM_TASTE (step 6b, Q4 revised). */
export const FAR_ROWS_NOTE =
  "(ici, on s'éloigne un peu de tes goûts : c'est le prix des vraies pépites)";

/** No film left, without any filter (step 8b, D9; Claude Web). */
export const NOTHING_HERE = 'plus rien ici : essaie « les valeurs sûres ».';

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
];
const TENS: Record<number, string> = {
  2: 'vingt',
  3: 'trente',
  4: 'quarante',
  5: 'cinquante',
  6: 'soixante',
  8: 'quatre-vingt',
};

/** French number in words, 0 to 99 (« et » for 21…61 and 71, hyphens otherwise). */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  let t = Math.floor(n / 10);
  let u = n % 10;
  if (t === 7 || t === 9) {
    t -= 1;
    u += 10;
  }
  const tens = TENS[t]!;
  if (u === 0) return t === 8 ? 'quatre-vingts' : tens;
  if ((u === 1 || u === 11) && t !== 8) return `${tens} et ${numberWord(u)}`;
  return `${tens}-${numberWord(u)}`;
}

/** Second sentence of the title, from the cap shown (D5, adjusted 8 November 2026; step 8b D9:
 * « valeurs sûres », the name of the category, at ∞ and >= 10 000). */
export function titlePhrase(cap: number | null, nShown: number): string {
  if (cap === null || cap >= 10000) return 'voilà des valeurs sûres qui devraient te plaire.';
  if (cap >= 2000) return 'voilà un mélange de classiques et de découvertes.';
  if (nShown === 1) return "voilà un film que t'as sûrement jamais vu.";
  return `voilà ${numberWord(nShown)} films que t'as sûrement jamais vus.`;
}

/** « (t'aimes bien x, y et z, non ?) », names in lower case; '' when hidden. */
export function profileNote(directors: readonly string[]): string {
  if (directors.length < 2) return '';
  const names = directors.map((d) => d.toLocaleLowerCase('fr'));
  const list = `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;
  return `(t'aimes bien ${list}, non ?)`;
}
