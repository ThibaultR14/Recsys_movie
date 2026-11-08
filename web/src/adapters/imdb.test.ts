// Step 6 (G1): IMDb adapter and source detection, on hand-written synthetic CSVs only.
import { describe, expect, it } from 'vitest';
import { detectCsv, headerColumns } from './detect';
import {
  decodeCsvBytes,
  IMDB_SCALE_MAX,
  isFilmType,
  normalizeTitleType,
  parseImdbCsv,
} from './imdb';
import { percentiles } from './normalizeRatings';

const HEADER =
  'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors';
const row = (cells: string[]) => cells.join(',');
const CSV = [
  HEADER,
  row([
    'tt0211915',
    '8',
    '2025-01-05',
    "Le Fabuleux Destin d'Amélie Poulain",
    "Le Fabuleux Destin d'Amélie Poulain",
    'u',
    'Movie',
    '8.3',
    '122',
    '2001',
    'Comedy',
    '800000',
    '2001-04-25',
    'Jean-Pierre Jeunet',
  ]),
  row([
    'tt0245429',
    '10',
    '2025-02-01',
    'Le Voyage de Chihiro',
    'Sen to Chihiro no kamikakushi',
    'u',
    'Movie',
    '',
    '',
    '2001',
    '',
    '',
    '',
    '',
  ]),
  row([
    'tt0114814',
    '7',
    '2025-03-01',
    '"Suspects, usuels"',
    'The Usual Suspects',
    'u',
    'Movie',
    '',
    '',
    '1995',
    '',
    '',
    '',
    '',
  ]),
  row([
    'tt0306414',
    '9',
    '2025-04-01',
    'The Wire',
    'The Wire',
    'u',
    'TV Series',
    '',
    '',
    '2002',
    '',
    '',
    '',
    '',
  ]),
].join('\r\n');

describe('detectCsv (D5)', () => {
  it('IMDb ratings, current and old headers, with BOM and quotes', () => {
    expect(detectCsv(HEADER)).toBe('imdb-ratings');
    expect(detectCsv('﻿"Const","Your Rating","Date Rated","Title","URL","Title Type"')).toBe(
      'imdb-ratings',
    );
    expect(detectCsv('const,your rating,title\r\ntt1,8,X')).toBe('imdb-ratings');
  });
  it('IMDb watchlist or list: Position column, or no rating column', () => {
    expect(
      detectCsv(
        'Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,Your Rating,Date Rated',
      ),
    ).toBe('imdb-list');
    expect(detectCsv('Const,Created,Modified,Description,Title,URL,Title Type')).toBe('imdb-list');
    // real watchlist header (8 November 2026): Your Rating is there, empty; Position decides
    expect(
      detectCsv(
        'Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated',
      ),
    ).toBe('imdb-list');
  });
  it('Letterboxd, whatever the file name, and unknown files', () => {
    expect(detectCsv('Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,X,2000,u,4')).toBe(
      'letterboxd',
    );
    expect(detectCsv('a,b,c')).toBe('unknown');
    expect(detectCsv('')).toBe('unknown');
    expect(headerColumns('﻿ "A" ,b')).toEqual(['a', 'b']);
  });
});

describe('parseImdbCsv (D1)', () => {
  it('one entry per row: id, rating 1-10, date, titles, normalized type', () => {
    const r = parseImdbCsv(CSV);
    expect(r.warnings).toEqual([]);
    expect(r.entries).toHaveLength(4);
    expect(r.entries[0]).toEqual({
      title: "Le Fabuleux Destin d'Amélie Poulain",
      year: 2001,
      imdbId: 'tt0211915',
      rating: 8,
      scaleMax: IMDB_SCALE_MAX,
      date: '2025-01-05',
      source: 'imdb',
      sourceKey: 'tt0211915',
      titleType: 'movie',
    }); // no originalTitle: same as the title
    expect(r.entries[1]).toMatchObject({
      title: 'Le Voyage de Chihiro',
      originalTitle: 'Sen to Chihiro no kamikakushi',
    });
    expect(r.entries[2]!.title).toBe('Suspects, usuels'); // quotes and comma
    expect(r.entries[3]).toMatchObject({ titleType: 'tvseries', rating: 9 });
  });

  it('columns by name, in any order, extra columns ignored', () => {
    const r = parseImdbCsv('Title,Extra,Year,Your Rating,Const\nAlien,x,1979,9,tt0078748\n');
    expect(r.entries).toEqual([
      expect.objectContaining({ title: 'Alien', year: 1979, rating: 9, imdbId: 'tt0078748' }),
    ]);
    expect(r.entries[0]!.titleType).toBeUndefined();
  });

  it('invalid rating, id or date: kept without it, with a warning', () => {
    const r = parseImdbCsv(
      'Const,Your Rating,Date Rated,Title,Year\nnm0000001,11,01/02/2025,X,2000\ntt1,,2025-01-01,Y,\n',
    );
    expect(r.entries[0]).toMatchObject({ title: 'X', imdbId: undefined, rating: undefined });
    expect(r.entries[0]!.date).toBeUndefined();
    expect(r.entries[0]!.sourceKey).toBe('title:X|2000');
    expect(r.entries[1]).toMatchObject({ imdbId: 'tt1', rating: undefined, year: undefined });
    expect(r.warnings).toEqual([
      'identifiant imdb ignoré : « nm0000001 »',
      'note ignorée : « 11 »',
    ]);
  });

  it('a list, a watchlist or a Letterboxd file gives no entry', () => {
    expect(parseImdbCsv('Position,Const,Your Rating,Title\n1,tt1,,X\n')).toMatchObject({
      entries: [],
      warnings: ['liste ou watchlist imdb : pas de notes'],
    });
    expect(parseImdbCsv('Date,Name,Year,Letterboxd URI\n').entries).toEqual([]);
  });

  it('percentiles on the 1-10 scale only depend on ranks', () => {
    const ten = percentiles([2, 6, 6, 10]);
    const five = percentiles([1, 3, 3, 5]);
    expect(ten).toEqual(five);
    expect(ten).toEqual([0, 0.5, 0.5, 1]);
  });
});

describe('title types and encoding', () => {
  it('« TV Movie », « tvMovie », « tv-movie » -> tvmovie; « Série télévisée » keeps its accents', () => {
    expect(normalizeTitleType('TV Movie')).toBe('tvmovie');
    expect(normalizeTitleType('tvMovie')).toBe('tvmovie');
    expect(normalizeTitleType('tv-movie')).toBe('tvmovie');
    expect(normalizeTitleType('Série télévisée')).toBe('sérietélévisée');
    expect(normalizeTitleType('  ')).toBeUndefined();
  });

  it('known non-film types, English and French, are not films (D3-D4 v0.3)', () => {
    for (const t of [
      'TV Series',
      'TV Mini Series',
      'TV Episode',
      'Video Game',
      'Podcast Series',
      'Podcast Episode',
      'Music Video',
      'tvSeries', // old exports
      'tvEpisode',
      'Série télévisée', // French account (real export)
      'Épisode télévisé',
    ]) {
      expect(isFilmType(normalizeTitleType(t)), t).toBe(false);
    }
  });

  it('film types, unknown types (other languages) and an absent type are films', () => {
    for (const t of ['Movie', 'TV Movie', 'Short', 'Video', 'TV Special', 'TV Short', 'movie']) {
      expect(isFilmType(normalizeTitleType(t)), t).toBe(true);
    }
    expect(isFilmType(normalizeTitleType('Film'))).toBe(true); // French account (real export)
    expect(isFilmType(normalizeTitleType('Spielfilm'))).toBe(true); // German: unknown -> film
    expect(isFilmType(normalizeTitleType('Fernsehserie'))).toBe(true); // unknown, even a series
    expect(isFilmType(undefined)).toBe(true); // no Title Type column
  });

  it('UTF-8 (BOM dropped), else Windows-1252', () => {
    const utf8 = new TextEncoder().encode('﻿Const,Title\ntt1,Amélie\n');
    expect(decodeCsvBytes(utf8)).toBe('Const,Title\ntt1,Amélie\n');
    const cp1252 = new Uint8Array([...new TextEncoder().encode('tt1,Am'), 0xe9, 0x6c, 0x69, 0x65]);
    expect(decodeCsvBytes(cp1252)).toBe('tt1,Amélie');
    const r = parseImdbCsv(
      decodeCsvBytes(
        new Uint8Array([
          ...new TextEncoder().encode('Const,Your Rating,Title,Year\ntt1,8,Am'),
          0xe9,
          ...new TextEncoder().encode('lie,2001\n'),
        ]),
      ),
    );
    expect(r.entries[0]!.title).toBe('Amélie');
  });
});
