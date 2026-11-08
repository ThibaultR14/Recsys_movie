import { describe, expect, it } from 'vitest';
import type { FilmCard, Unrecognized } from '../reco/workerCore';
import {
  groupUnrecognized,
  nonFilmSentence,
  notInCatalogSentence,
  tooRecentSentence,
} from './analysis';
import { MESSAGES, readUpload } from './readUpload';

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

  it('IMDb ratings CSV -> text for the IMDb adapter, even named ratings.csv, BOM dropped', async () => {
    const text = 'Const,Your Rating,Date Rated,Title,URL,Title Type\ntt1,8,2024-01-01,X,u,Movie\n';
    expect(await readUpload(new File(['﻿' + text], 'ratings.csv'))).toEqual({
      ok: true,
      input: { kind: 'imdb', name: 'ratings.csv', text },
    });
  });

  it('Windows-1252 CSV is decoded', async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('Const,Your Rating,Title\ntt1,8,Am'),
      0xe9,
      ...new TextEncoder().encode('lie\n'),
    ]);
    const r = await readUpload(new File([bytes], 'export.csv'));
    expect(r.ok && r.input.kind === 'imdb' && r.input.text).toBe(
      'Const,Your Rating,Title\ntt1,8,Amélie\n',
    );
  });

  it('IMDb watchlist or list -> a short message, nothing imported', async () => {
    const wl = 'Position,Const,Created,Modified,Description,Title,URL,Title Type,Your Rating\n';
    expect(await readUpload(new File([wl], 'WATCHLIST.csv'))).toEqual({
      ok: false,
      message: MESSAGES.imdbList,
    });
    expect(await readUpload(new File(['Const,Title\n'], 'liste.csv'))).toEqual({
      ok: false,
      message: MESSAGES.imdbList,
    });
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
    expect(g.nonFilm).toEqual([]);
  });

  it('IMDb series, episodes, games: their own group, even after 2023 (step 6, D4)', () => {
    const g = groupUnrecognized([
      { ...u(0, 'not_found', 2019), reason: 'non_film' },
      { ...u(1, 'not_found', 2025), reason: 'non_film' },
      u(2, 'not_found', 2010),
      { ...u(3, 'ambiguous', 1964, 1), byTitle: true },
    ]);
    expect(g.nonFilm.map((x) => x.index)).toEqual([0, 1]);
    expect(g.tooRecent).toEqual([]);
    expect(g.notInCatalog.map((x) => x.index)).toEqual([2]);
    expect(g.toVerify.map((x) => x.index)).toEqual([3]);
    expect(nonFilmSentence(3)).toBe('3 séries, épisodes ou jeux : on fait que les films.');
    expect(nonFilmSentence(1)).toBe('1 série, épisode ou jeu : on fait que les films.');
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
