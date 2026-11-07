import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  exportFileName,
  parseLetterboxdCsv,
  parseLetterboxdFiles,
  parseLetterboxdZip,
} from './letterboxd';

// Synthetic export written by hand (real titles, invented ratings and dates).
const WATCHED = [
  'Date,Name,Year,Letterboxd URI',
  '2024-01-02,Amélie,2001,https://boxd.it/aaa1',
  '2024-01-03,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/aaa2',
  '2024-01-04,"The ""Teddy"" Film",1999,https://boxd.it/aaa3',
  '2024-01-05,No Year Film,,https://boxd.it/aaa4',
  '2024-01-06,Seen Not Rated,2010,https://boxd.it/aaa5',
].join('\r\n');
const RATINGS = [
  'Date,Name,Year,Letterboxd URI,Rating',
  '2024-02-01,Amélie,2001,https://boxd.it/aaa1,4.5',
  '2024-02-02,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/aaa2,3',
  '2024-02-03,"The ""Teddy"" Film",1999,https://boxd.it/aaa3,0.5',
  '2024-02-04,No Year Film,,https://boxd.it/aaa4,5',
].join('\r\n');
const DIARY = [
  'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
  // diary links are diary entries: never equal to the film links
  '2024-03-01,Amélie,2001,https://boxd.it/dd01,4,,,2023-12-24',
  '2024-03-02,Amélie,2001,https://boxd.it/dd02,5,Yes,,2024-03-01',
  '2024-03-03,Seen Not Rated,2010,https://boxd.it/dd03,,,,2024-03-03',
  '2024-03-04,Diary Only Film,1987,https://boxd.it/dd04,3.5,,,2024-03-04',
].join('\r\n');

const byTitle = <T extends { title: string }>(entries: T[]) =>
  new Map(entries.map((e) => [e.title, e]));

describe('exportFileName', () => {
  it('accepts the three files at the top or in one wrapping folder', () => {
    expect(exportFileName('ratings.csv')).toBe('ratings.csv');
    expect(exportFileName('letterboxd-x-2026/diary.csv')).toBe('diary.csv');
    expect(exportFileName('letterboxd-x-2026\\watched.csv')).toBe('watched.csv');
  });
  it('ignores profile, watchlist and the deleted/orphaned/likes folders', () => {
    for (const p of [
      'profile.csv',
      'watchlist.csv',
      'reviews.csv',
      'deleted/diary.csv',
      'orphaned/diary.csv',
      'likes/films.csv',
      'a/b/ratings.csv',
    ]) {
      expect(exportFileName(p)).toBeNull();
    }
  });
});

describe('parseLetterboxdFiles', () => {
  const result = parseLetterboxdFiles({
    'watched.csv': WATCHED,
    'ratings.csv': '﻿' + RATINGS, // BOM tolerated
    'diary.csv': DIARY,
  });
  const films = byTitle(result.entries);

  it('merges ratings and watched by link, the diary by (title, year)', () => {
    expect(result.filesRead).toEqual(['diary.csv', 'ratings.csv', 'watched.csv']);
    expect(result.entries).toHaveLength(6);
    expect(films.get('Amélie')).toMatchObject({
      year: 2001,
      rating: 4.5, // ratings.csv wins over the diary
      date: '2024-03-01', // latest diary watch
      sourceKey: 'https://boxd.it/aaa1',
      source: 'letterboxd',
      scaleMax: 5,
    });
  });
  it('keeps commas and quotes in titles, and empty years', () => {
    expect(films.get('Crouching Tiger, Hidden Dragon')?.rating).toBe(3);
    expect(films.get('The "Teddy" Film')?.rating).toBe(0.5);
    expect(films.get('No Year Film')).toMatchObject({ year: undefined, rating: 5 });
  });
  it('leaves watched-without-rating films unrated and adds diary-only films', () => {
    expect(films.get('Seen Not Rated')).toMatchObject({ rating: undefined, date: '2024-03-03' });
    expect(films.get('Diary Only Film')).toMatchObject({
      year: 1987,
      rating: 3.5,
      sourceKey: 'title:Diary Only Film|1987',
    });
  });
});

describe('diary only, or ZIP without ratings.csv', () => {
  it('takes the rating of the latest diary entry (rewatch)', () => {
    const r = parseLetterboxdCsv('diary.csv', DIARY);
    expect(r.filesRead).toEqual(['diary.csv']);
    const films = byTitle(r.entries);
    expect(films.get('Amélie')).toMatchObject({ rating: 5, date: '2024-03-01' });
    expect(r.entries).toHaveLength(3);
  });
  it('reads a ZIP with a wrapping folder, skipping profile and deleted files', () => {
    const zip = zipSync({
      'letterboxd-someone-2026-11-07/watched.csv': strToU8(WATCHED),
      'letterboxd-someone-2026-11-07/diary.csv': strToU8(DIARY),
      'letterboxd-someone-2026-11-07/profile.csv': strToU8('Username\nsomeone'),
      'letterboxd-someone-2026-11-07/deleted/diary.csv': strToU8(DIARY),
    });
    const r = parseLetterboxdZip(zip);
    expect(r.filesRead).toEqual(['diary.csv', 'watched.csv']);
    expect(byTitle(r.entries).get('Amélie')).toMatchObject({ rating: 5 });
    expect(byTitle(r.entries).get('Crouching Tiger, Hidden Dragon')?.rating).toBeUndefined();
  });
});

describe('single CSV detection', () => {
  it('recognises a renamed file by its columns', () => {
    expect(parseLetterboxdCsv('mes-notes.csv', RATINGS).filesRead).toEqual(['ratings.csv']);
    expect(parseLetterboxdCsv('export.csv', WATCHED).filesRead).toEqual(['watched.csv']);
  });
  it('refuses the watchlist and unknown files', () => {
    expect(parseLetterboxdCsv('watchlist.csv', WATCHED).entries).toEqual([]);
    expect(parseLetterboxdCsv('autre.csv', 'a,b\n1,2').warnings).toHaveLength(1);
  });
  it('ignores invalid ratings with a warning', () => {
    const r = parseLetterboxdCsv(
      'ratings.csv',
      'Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,X,2000,https://boxd.it/x,7',
    );
    expect(r.entries[0]?.rating).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });
});

// Real export of Thibault (web/test-data/exports/, not versioned): structure only, no titles.
const EXPORTS = fileURLToPath(new URL('../../test-data/exports', import.meta.url));
const realExport = existsSync(EXPORTS)
  ? readdirSync(EXPORTS).find(
      (d) => d.startsWith('letterboxd-') && statSync(join(EXPORTS, d)).isDirectory(),
    )
  : undefined;

describe.skipIf(!realExport)('real export (structure only)', () => {
  it('reads one entry per watched film, the diary attached by (title, year)', () => {
    const dir = join(EXPORTS, realExport!);
    const files: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.csv')) files[f] = readFileSync(join(dir, f), 'utf-8');
    }
    const r = parseLetterboxdFiles(files);
    expect(r.filesRead).toEqual(['diary.csv', 'ratings.csv', 'watched.csv']);
    expect(r.warnings).toEqual([]);
    const watchedRows = files['watched.csv']!.trim().split(/\r?\n/).length - 1;
    expect(r.entries).toHaveLength(watchedRows); // no diary-only film in this export
    expect(r.entries.every((e) => e.title && e.year && e.date)).toBe(true);
  });
});
