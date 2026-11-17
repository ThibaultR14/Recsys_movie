// Step 8b (D6): the CSV of the list shown, Letterboxd list-import format, made in the browser.
import { describe, expect, it } from 'vitest';
import { csvField, csvFileName, listCsv, personPart, slug } from './download';

describe('list CSV (D6)', () => {
  it('exact content: header, RFC 4180 quotes, empty ids and years, CRLF, no BOM', () => {
    const csv = listCsv([
      { tmdbId: 62, imdbId: 'tt0062622', title: '2001: A Space Odyssey', year: 1968 },
      { tmdbId: 1, imdbId: null, title: 'Crouching Tiger, Hidden Dragon', year: 2000 },
      { tmdbId: 2, imdbId: 'tt0000002', title: 'The "Best" Film, Ever', year: null },
      { tmdbId: null, title: 'Line\nbreak', year: 1999 },
    ]);
    expect(csv).toBe(
      'tmdbID,imdbID,Title,Year\r\n' +
        '62,tt0062622,2001: A Space Odyssey,1968\r\n' +
        '1,,"Crouching Tiger, Hidden Dragon",2000\r\n' +
        '2,tt0000002,"The ""Best"" Film, Ever",\r\n' +
        ',,"Line\nbreak",1999\r\n',
    );
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(new TextEncoder().encode(csv).slice(0, 3)).toEqual(new Uint8Array([116, 109, 100]));
  });

  it('fields: only what needs quotes is quoted', () => {
    expect(csvField('Amélie')).toBe('Amélie');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('file names: the category or films-de-<name without accents>, local date', () => {
    const d = new Date(2026, 10, 7); // 7 November 2026, local
    expect(csvFileName('valeurs-sures', d)).toBe('pepite-valeurs-sures-2026-11-07.csv');
    expect(csvFileName('moins-connus', d)).toBe('pepite-moins-connus-2026-11-07.csv');
    expect(csvFileName('pepites', d)).toBe('pepite-pepites-2026-11-07.csv');
    expect(csvFileName(personPart('Agnès Varda'), d)).toBe(
      'pepite-films-de-agnes-varda-2026-11-07.csv',
    );
    expect(slug("Jean-Pierre  Jeunet's (fan)")).toBe('jean-pierre-jeunet-s-fan');
    expect(slug('Wong Kar-wai')).toBe('wong-kar-wai');
  });
});
