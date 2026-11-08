import { describe, expect, it } from 'vitest';
import type { UserFilm } from '../matching/history';
import { mainTitleKey, profileDirectors, seriesOf } from './annotations';

const catalog = {
  title: [
    'Stalker', // 0
    'Solaris', // 1
    'Mirror', // 2
    'Chungking Express', // 3
    'In the Mood for Love', // 4
    'Kill Bill: Vol. 1', // 5
    'Kill Bill: Vol. 2', // 6
    'Alien', // 7
    'Alien: Resurrection', // 8
    'Paris, Texas', // 9
    'Wings of Desire', // 10
    'Fallen Angels', // 11
  ],
  directors: [
    ['Andrei Tarkovsky'],
    ['Andrei Tarkovsky'],
    ['Andrei Tarkovsky'],
    ['Wong Kar-wai'],
    ['Wong Kar-wai'],
    ['Quentin Tarantino'],
    ['Quentin Tarantino'],
    ['Ridley Scott'],
    ['Jean-Pierre Jeunet'],
    ['Wim Wenders'],
    ['Wim Wenders'],
    ['Wong Kar-wai'],
  ],
};

const h = (item: number, percentile: number, rated = true): UserFilm => ({
  item,
  percentile,
  rating: rated ? 4 : undefined,
  status: 'exact',
});

describe('profileDirectors', () => {
  it('most frequent among films rated above the median, at least 2 films each', () => {
    const history = [
      h(0, 0.9),
      h(1, 0.8),
      h(2, 0.7),
      h(3, 0.6),
      h(4, 0.95),
      h(9, 0.9),
      h(10, 0.3),
      h(5, 0.99),
    ];
    // Tarkovsky 3, Wong 2, Wenders 1 above median (Wings of Desire at 0.3), Tarantino 1
    expect(profileDirectors(history, catalog)).toEqual(['Andrei Tarkovsky', 'Wong Kar-wai']);
  });

  it('ties broken by the sum of percentiles, then by name; at most 3', () => {
    const history = [
      h(3, 0.6),
      h(4, 0.6),
      h(9, 0.9),
      h(10, 0.9),
      h(0, 0.7),
      h(1, 0.7),
      h(5, 0.8),
      h(6, 0.8),
    ];
    expect(profileDirectors(history, catalog)).toEqual([
      'Wim Wenders',
      'Quentin Tarantino',
      'Andrei Tarkovsky',
    ]);
  });

  it('unrated films and the median itself do not count; fewer than 2 directors -> hidden', () => {
    expect(
      profileDirectors([h(0, 0.9, false), h(1, 0.9, false), h(3, 0.9), h(4, 0.9)], catalog),
    ).toEqual([]);
    expect(profileDirectors([h(0, 0.5), h(1, 0.5), h(3, 0.9), h(4, 0.9)], catalog)).toEqual([]);
  });
});

describe('seriesOf', () => {
  it('main title before « : » or « - »', () => {
    expect(mainTitleKey('Kill Bill: Vol. 2')).toBe('kill bill');
    expect(mainTitleKey('Alien')).toBe('alien');
    expect(mainTitleKey('Mission - Impossible')).toBe('mission');
  });

  it('same main title and a director in common', () => {
    const out = seriesOf([6, 8, 11], [h(5, 0.7), h(7, 0.8), h(3, 0.9)], catalog);
    expect(out.get(6)).toBe('Kill Bill: Vol. 1');
    expect(out.has(8)).toBe(false); // Alien: Resurrection, another director
    expect(out.has(11)).toBe(false); // same director, another title
  });
});
