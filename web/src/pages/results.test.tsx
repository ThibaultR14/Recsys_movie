import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App, type RecoApi } from '../App';
import type { RecommendedFilm, RecommendResult } from '../reco/workerCore';
import { APropos } from './APropos';
import { CommentCaMarche } from './CommentCaMarche';
import { isSectionHash, pageOfHash } from './pages';
import { Resultats } from './Resultats';
import { FAR_ROWS_NOTE, numberWord, profileNote, titlePhrase } from './resultsText';

const POSITIONS = [null, 20000, 10000, 5000, 2000, 1000, 500, 200];

function films(cap: number | null, n = 48): RecommendedFilm[] {
  return Array.from({ length: n }, (_, i) => ({
    item: (cap ?? 0) + i,
    title: `film ${cap ?? 'inf'} #${i}`,
    year: 1990,
    directors: ['Someone'],
    posterPath: null,
    // one film well below its block median at every 6th place of each block of 8
    popularity: i % 8 === 5 ? 10 : cap === null ? 50000 : Math.min(cap, 900 + i),
    tmdbId: 10 + i,
    genres: i % 4 === 0 ? ['Documentary'] : ['Drama'],
    score: 1 - i / 100,
    ...(i === 1 ? { seriesOf: 'Kill Bill: Vol. 1' } : {}),
    ...(i === 2
      ? {
          because: {
            kind: 'liked' as const,
            items: [900, 901],
            titles: ['Stalker', 'Paris, Texas'],
          },
        }
      : {}),
  }));
}

function reco(over: Partial<RecommendResult> = {}): RecommendResult {
  const rel = [1, 0.6, 0.4, 0.25, 0.17, 0.09, 0.039, 0.02];
  return {
    nHistory: 60,
    nExcluded: 70,
    profileDirectors: ['Andrei Tarkovsky', 'Wong Kar-wai', 'Wim Wenders'],
    positions: POSITIONS.map((cap, k) => ({ cap, relativeScore: rel[k]!, films: films(cap) })),
    ...over,
  };
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const cards = () =>
  within(screen.getByRole('list', { name: 'films recommandés' })).getAllByRole('listitem');
const slider = () => screen.getByRole('slider', { name: 'plutôt connu ou plutôt pépite ?' });
const moveTo = (cap: number | null) =>
  fireEvent.change(slider(), { target: { value: String(POSITIONS.indexOf(cap)) } });

describe('results texts', () => {
  it('French numbers', () => {
    expect([8, 16, 24, 32, 40, 48].map(numberWord)).toEqual([
      'huit',
      'seize',
      'vingt-quatre',
      'trente-deux',
      'quarante',
      'quarante-huit',
    ]);
    expect([1, 17, 21, 71, 80, 81, 91, 99].map(numberWord)).toEqual([
      'un',
      'dix-sept',
      'vingt et un',
      'soixante et onze',
      'quatre-vingts',
      'quatre-vingt-un',
      'quatre-vingt-onze',
      'quatre-vingt-dix-neuf',
    ]);
  });

  it('title sentence by notch (∞, 20 000, 10 000 / 5 000, 2 000 / 1 000, 500, 200)', () => {
    for (const cap of [null, 20000, 10000]) {
      expect(titlePhrase(cap, 8)).toBe('voilà des classiques qui devraient te plaire.');
    }
    for (const cap of [5000, 2000]) {
      expect(titlePhrase(cap, 8)).toBe('voilà un mélange de classiques et de découvertes.');
    }
    for (const cap of [1000, 500, 200]) {
      expect(titlePhrase(cap, 8)).toBe("voilà huit films que t'as sûrement jamais vus.");
    }
    expect(titlePhrase(500, 16)).toBe("voilà seize films que t'as sûrement jamais vus.");
    expect(titlePhrase(200, 1)).toBe("voilà un film que t'as sûrement jamais vu.");
  });

  it('profile note', () => {
    expect(profileNote(['Andrei Tarkovsky', 'Wong Kar-wai', 'Wim Wenders'])).toBe(
      "(t'aimes bien andrei tarkovsky, wong kar-wai et wim wenders, non ?)",
    );
    expect(profileNote(['A B', 'C D'])).toBe("(t'aimes bien a b et c d, non ?)");
    expect(profileNote(['A B'])).toBe('');
  });
});

describe('Resultats', () => {
  it('starts at 2 000 with 8 cards, profile note, mixed sentence', () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    expect(slider()).toHaveValue('4');
    expect(h1()).toHaveTextContent(
      'on a lu tes 66 films.voilà un mélange de classiques et de découvertes.',
    );
    expect(
      screen.getByText("(t'aimes bien andrei tarkovsky, wong kar-wai et wim wenders, non ?)"),
    ).toBeInTheDocument();
    expect(cards()).toHaveLength(8);
    expect(cards()[0]).toHaveTextContent('film 2000 #0');
    expect(
      screen.getByText('on connaît moins bien les films sortis après 2023, désolé.'),
    ).toBeInTheDocument();
    expect(screen.getByText("dis-nous si on s'est planté, ça nous aide")).toBeInTheDocument();
    expect(
      screen.queryByText("(là, on s'éloigne pas mal de tes goûts habituels)"),
    ).not.toBeInTheDocument();
  });

  it('moving the slider shows another precomputed list and sentence', () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    moveTo(null);
    expect(h1()).toHaveTextContent('voilà des classiques qui devraient te plaire.');
    expect(cards()[0]).toHaveTextContent('film inf #0');
    moveTo(500);
    expect(h1()).toHaveTextContent("voilà huit films que t'as sûrement jamais vus.");
    expect(cards()[0]).toHaveTextContent('film 500 #0');
  });

  it('« loin de tes goûts » below a relative score of 0.04 only', () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    const note = "(là, on s'éloigne pas mal de tes goûts habituels)";
    moveTo(1000); // 0.09
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    moveTo(500); // 0.039
    expect(screen.getByText(note)).toBeInTheDocument();
    moveTo(200); // 0.02
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("« parce que t'as aimé »: on the cards, not at a notch far from the user's taste (Q4)", () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    const why = "(parce que t'as aimé « Stalker » et « Paris, Texas »)";
    expect(cards()[2]).toHaveTextContent(why);
    moveTo(1000); // 0.09
    expect(cards()[2]).toHaveTextContent(why);
    moveTo(500); // 0.039: far
    expect(screen.queryByText(/parce que t'as/)).not.toBeInTheDocument();
  });

  it('a row half far from the taste: one note above the grid, explanations kept (Q4 revised)', () => {
    const r = reco();
    // at 500 (relative score 0.039): half of the first row below 0.04
    const p500 = r.positions[POSITIONS.indexOf(500)]!;
    p500.films = p500.films.map((f, i) => ({ ...f, relativeScore: i % 2 ? 0.03 : 0.05 }));
    render(<Resultats nEntries={66} reco={r} />);
    moveTo(500);
    const note = screen.getByText(FAR_ROWS_NOTE);
    // above the grid, and the position-level note is gone
    const grid = screen.getByRole('list', { name: 'films recommandés' });
    expect(note.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.queryByText("(là, on s'éloigne pas mal de tes goûts habituels)"),
    ).not.toBeInTheDocument();
    expect(cards()[2]).toHaveTextContent("(parce que t'as aimé « Stalker » et « Paris, Texas »)");
  });

  it('fewer than half of a row far: the position rule of step 5 stays', () => {
    const r = reco();
    const p500 = r.positions[POSITIONS.indexOf(500)]!;
    p500.films = p500.films.map((f, i) => ({ ...f, relativeScore: i < 3 ? 0.03 : 0.05 }));
    render(<Resultats nEntries={66} reco={r} />);
    moveTo(500); // position 0.039 < 0.04, 3 / 8 far cards
    expect(screen.queryByText(FAR_ROWS_NOTE)).not.toBeInTheDocument();
    expect(
      screen.getByText("(là, on s'éloigne pas mal de tes goûts habituels)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/parce que t'as/)).not.toBeInTheDocument();
  });

  it('pépite stamp: at most one per block of 8 cards, at every notch', async () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    expect(screen.getAllByText('✱ pépite')).toHaveLength(1);
    expect(cards()[5]).toHaveTextContent('✱ pépite');
    for (const cap of [null, 1000, 200]) {
      moveTo(cap);
      expect(screen.getAllByText('✱ pépite')).toHaveLength(1);
    }
    await userEvent.click(screen.getByRole('button', { name: 'encore des films' }));
    expect(screen.getAllByText('✱ pépite')).toHaveLength(2);
  });

  it('« encore des films » adds 8 cards up to 48, and the number in the title follows', async () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    moveTo(500);
    const more = screen.getByRole('button', { name: 'encore des films' });
    await userEvent.click(more);
    expect(cards()).toHaveLength(16);
    expect(h1()).toHaveTextContent("voilà seize films que t'as sûrement jamais vus.");
    for (let i = 0; i < 4; i++) await userEvent.click(more);
    expect(cards()).toHaveLength(48);
    expect(h1()).toHaveTextContent("voilà quarante-huit films que t'as sûrement jamais vus.");
    expect(screen.queryByRole('button', { name: 'encore des films' })).not.toBeInTheDocument();
  });

  it('« sans les documentaires » filters the computed list', async () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    expect(
      within(screen.getByRole('list', { name: 'films recommandés' })).getAllByText('documentaire'),
    ).toHaveLength(2);
    await userEvent.click(screen.getByRole('checkbox', { name: 'sans les documentaires' }));
    expect(screen.queryByText('documentaire')).not.toBeInTheDocument();
    expect(cards()).toHaveLength(8);
    expect(cards()[0]).toHaveTextContent('film 2000 #1');
  });

  it('same-series note on the card', () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    expect(
      screen.getByText("(même série que « Kill Bill: Vol. 1 », que t'as vu)"),
    ).toBeInTheDocument();
  });

  it('no profile note with fewer than 2 directors', () => {
    render(<Resultats nEntries={66} reco={reco({ profileDirectors: [] })} />);
    expect(screen.queryByText(/t'aimes bien/)).not.toBeInTheDocument();
  });
});

describe('pages (step 6b, D2)', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('« à propos »: mandatory notices, exact; no school name', () => {
    render(<APropos />);
    expect(screen.getByRole('img', { name: 'TMDB' })).toHaveAttribute('src', '/tmdb-logo.svg');
    expect(
      screen.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.'),
    ).toBeInTheDocument();
    const cite = screen.getByText(/F\. Maxwell Harper and Joseph A\. Konstan\. 2015\./);
    expect(cite).toHaveTextContent(
      'F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM Transactions on Interactive Intelligent Systems (TiiS) 5, 4, Article 19.',
    );
    expect(
      screen.getByText(/ni soutenu ni approuvé par l'université du minnesota, grouplens/),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'crédits' })).toHaveAttribute('id', 'mentions');
    expect(document.body).not.toHaveTextContent(/\bece\b|\bm2\b/i);
  });

  it('« comment ça marche »: the sections and their anchors', () => {
    render(<CommentCaMarche />);
    expect(screen.getAllByRole('region').map((r) => r.id)).toEqual([
      'modele',
      'percentiles',
      'curseur',
      'donnees',
      'on-garde-rien',
      'limites',
      'inspirations',
    ]);
    expect(screen.getByText('compatible avec les exports Letterboxd et IMDb.')).toBeInTheDocument();
  });

  it('anchors: page anchors and section anchors', () => {
    expect(pageOfHash('#contact')).toBe('contact');
    expect(pageOfHash('#a-propos')).toBe('a-propos');
    expect(pageOfHash('#comment-ca-marche')).toBe('comment-ca-marche');
    expect(pageOfHash('#on-garde-rien')).toBe('comment-ca-marche');
    expect(pageOfHash('#mentions')).toBe('a-propos');
    expect(pageOfHash('')).toBeNull();
    expect(pageOfHash('#nimporte')).toBeNull();
    expect(isSectionHash('#limites')).toBe(true);
    expect(isSectionHash('#contact')).toBe(false);
  });

  it('a direct link opens the page at load', () => {
    window.location.hash = '#contact';
    render(<App client={fakeApi()} />);
    expect(h1()).toHaveTextContent('contact.');
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('contact');
  });

  it('pages open over the results; « ← retour » gives them back at the same notch', async () => {
    render(<App client={fakeApi()} />);
    await userEvent.upload(
      screen.getByLabelText(/glisse ton fichier ici/),
      new File(['Date,Name,Year,Letterboxd URI,Rating\n'], 'ratings.csv', { type: 'text/csv' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'voir mes films' }));
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '6' } });
    for (const [name, title] of [
      ['à propos', 'à propos.'],
      ['comment ça marche', 'comment ça marche.'],
      ['contact', 'contact.'],
    ] as const) {
      await userEvent.click(screen.getByRole('link', { name }));
      await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
      expect(h1()).toHaveTextContent(title);
    }
    await userEvent.click(screen.getByRole('link', { name: '← retour' }));
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(screen.getByRole('slider')).toHaveValue('6');
  });
});

function fakeApi(): RecoApi {
  return {
    init: async () => ({ nItems: 1, positions: POSITIONS, timings: {} as never }),
    importExport: async () => ({
      summary: {
        nEntries: 3,
        nHistoryFilms: 3,
        counts: {},
        warnings: [],
        filesRead: [],
      } as never,
      unrecognized: [],
    }),
    confirm: async () => ({ counts: {} as never, nHistoryFilms: 3 }),
    recommend: async () => reco(),
  };
}
