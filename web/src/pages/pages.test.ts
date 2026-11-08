import { describe, expect, it } from 'vitest';
import type { FilmCard, Unrecognized } from '../reco/workerCore';
import { groupUnrecognized, notInCatalogSentence, tooRecentSentence } from './analysis';
import { looksLikeImdb, MESSAGES, readUpload } from './readUpload';

describe('readUpload', () => {
  it('ZIP -> bytes for the worker', async () => {
    const r = await readUpload(new File([new Uint8Array([80, 75, 3, 4])], 'export.ZIP'));
    expect(r.ok && r.input.kind).toBe('zip');
  });

  it('Letterboxd CSV -> text, with its name', async () => {
    const text = 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,Amélie,2001,x,5\n';
    const r = await readUpload(new File([text], 'ratings.csv'));
    expect(r).toEqual({ ok: true, input: { kind: 'csv', name: 'ratings.csv', text } });
  });

  it('IMDb CSV -> « bientôt », even with a BOM', async () => {
    const text = '﻿Const,Your Rating,Date Rated,Title,URL,Title Type\ntt1,8,2024,X,u,Movie\n';
    expect(await readUpload(new File([text], 'ratings.csv'))).toEqual({
      ok: false,
      message: MESSAGES.imdbSoon,
    });
    expect(looksLikeImdb('"Const","Your Rating","Title"')).toBe(true);
    expect(looksLikeImdb('Date,Name,Year,Letterboxd URI')).toBe(false);
  });

  it('watchlist and other files -> a short message', async () => {
    const wl = await readUpload(new File(['Date,Name,Year,Letterboxd URI\n'], 'watchlist.csv'));
    expect(wl).toEqual({ ok: false, message: MESSAGES.watchlist });
    expect(await readUpload(new File(['x'], 'photo.png'))).toEqual({
      ok: false,
      message: MESSAGES.notExport,
    });
  });
});

describe('analysis groups', () => {
  const film = (item: number): FilmCard => ({
    item,
    title: `f${item}`,
    year: 2000,
    directors: [],
    posterPath: null,
    popularity: 1,
    tmdbId: null,
    genres: [],
  });
  const u = (index: number, status: Unrecognized['status'], year: number | null, n = 0) => ({
    index,
    title: `t${index}`,
    year,
    status,
    candidates: Array.from({ length: n }, (_, i) => film(i)),
  });

  it('to verify (with candidates) / after 2023 / not in the catalogue', () => {
    const g = groupUnrecognized([
      u(0, 'ambiguous', 2008, 2),
      u(1, 'probable_fuzzy', 1964, 1),
      u(2, 'not_found', 2024),
      u(3, 'not_found', 2023),
      u(4, 'not_found', null),
      u(5, 'not_found', 2026),
      u(6, 'probable_fuzzy', 1990, 0),
    ]);
    expect(g.toVerify.map((x) => x.index)).toEqual([0, 1]);
    expect(g.tooRecent.map((x) => x.index)).toEqual([2, 5]);
    expect(g.notInCatalog.map((x) => x.index)).toEqual([3, 4, 6]);
  });

  it('sentences, singular and plural', () => {
    expect(tooRecentSentence(3)).toBe(
      '3 films sont sortis après 2023 : trop récents pour nous, désolé.',
    );
    expect(tooRecentSentence(1)).toBe(
      '1 film est sorti après 2023 : trop récent pour nous, désolé.',
    );
    expect(notInCatalogSentence(2)).toBe("2 films qu'on connaît pas (séries, films très peu vus…)");
    expect(notInCatalogSentence(1)).toBe("1 film qu'on connaît pas (séries, films très peu vus…)");
  });
});
