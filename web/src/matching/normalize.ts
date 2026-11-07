/**
 * Title key, v2 (docs/etape-3-letterboxd.md, D1). Must stay identical to Python
 * `normalize_title` in pipeline/titles.py; both are checked against shared/fixtures/.
 *
 * casefold (toLowerCase + table) -> NFKD -> drop every mark (\p{M}) -> keep letters and numbers
 * (\p{L}, \p{N}), anything else becomes a space -> collapse spaces.
 */
import casefold from '../../../shared/fixtures/casefold_table.json';

export const NORMALIZATION_VERSION = 'titles-v2';

const FOLD: Readonly<Record<string, string>> = casefold.table;
const MARK = /\p{M}/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/** Python `str.casefold()`: lowercase, then the characters whose case folding differs (ß -> ss). */
export function casefoldText(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) out += FOLD[ch] ?? ch;
  return out;
}

export function normalizeTitle(title: string | null | undefined): string {
  if (!title) return '';
  let out = '';
  for (const ch of casefoldText(title).normalize('NFKD')) {
    if (MARK.test(ch)) continue;
    out += LETTER_OR_NUMBER.test(ch) ? ch : ' ';
  }
  return out.split(' ').filter(Boolean).join(' ');
}
