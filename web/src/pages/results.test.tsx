import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App, type RecoApi } from '../App';
import type { RecommendedFilm, RecommendResult } from '../reco/workerCore';
import { APropos } from './APropos';
import { CommentCaMarche } from './CommentCaMarche';
import { isSectionHash, pageOfHash } from './pages';
import { Resultats } from './Resultats';
import { CATEGORIES, availableCategories } from './categories';
import {
  FAR_ROWS_NOTE,
  NOTHING_HERE,
  NOTHING_PASSES,
  numberWord,
  profileNote,
  titlePhrase,
} from './resultsText';
import type { ResultsView } from './resultsView';
import { NO_FILTERS, type Filters } from '../reco/filters';

const POSITIONS = [null, 20000, 10000, 5000, 2000, 1000, 500, 200];
const REFINE_OPTIONS = {
  genres: ['Comedy', 'Horror', 'Drama'],
  languages: Array.from({ length: 10 }, (_, k) => ({
    code: ['en', 'fr', 'ja', 'ru', 'es', 'it', 'de', 'hi', 'ko', 'cn'][k]!,
    films: 1000 - k,
  })),
};

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
const radio = (label: string) => screen.getByRole('radio', { name: new RegExp(`^${label}`) });
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
      expect(titlePhrase(cap, 8)).toBe('voilà des valeurs sûres qui devraient te plaire.');
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
  it('starts on « les moins connus » (2 000) with 8 cards, profile note, mixed sentence', () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    expect(radio('les moins connus')).toBeChecked();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(h1()).toHaveTextContent(
      'on a lu tes 66 films.voilà un mélange de classiques et de découvertes.',
    );
    expect(
      screen.getByText("(t'aimes bien andrei tarkovsky, wong kar-wai et wim wenders, non ?)"),
    ).toBeInTheDocument();
    expect(cards()).toHaveLength(8);
    expect(cards()[0]).toHaveTextContent('film 2000 #0');
    expect(
      screen.getByText(
        "les films récents sont placés d'après leur contenu : on les connaît moins bien.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("dis-nous si on s'est planté, ça nous aide")).toBeInTheDocument();
    expect(
      screen.queryByText("(là, on s'éloigne pas mal de tes goûts habituels)"),
    ).not.toBeInTheDocument();
  });

  it('three categories: radio group, sub-labels, a precomputed list each (step 8b, D1)', async () => {
    render(<Resultats nEntries={66} reco={reco()} />);
    const group = screen.getByRole('group', { name: 'plutôt connu ou plutôt pépite ?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(group).toHaveTextContent(
      'les valeurs sûrestoutles moins connusmoins de 2 000 notesles pépitesmoins de 500 notes',
    );
    expect(screen.getByText('les moins connus : 8 films')).toBeInTheDocument();
    await userEvent.click(radio('les valeurs sûres'));
    expect(radio('les valeurs sûres')).toBeChecked();
    expect(h1()).toHaveTextContent('voilà des valeurs sûres qui devraient te plaire.');
    expect(cards()[0]).toHaveTextContent('film inf #0');
    expect(screen.getByText('les valeurs sûres : 8 films')).toBeInTheDocument();
    await userEvent.click(radio('les pépites'));
    expect(h1()).toHaveTextContent("voilà huit films que t'as sûrement jamais vus.");
    expect(cards()[0]).toHaveTextContent('film 500 #0');
    expect(screen.getByText('les pépites : 8 films')).toBeInTheDocument();
  });

  it('a category whose cap is not an engine position is hidden', () => {
    expect(availableCategories([null, 2000]).map((c) => [c.label, c.index])).toEqual([
      ['les valeurs sûres', 0],
      ['les moins connus', 1],
    ]);
    expect(CATEGORIES.map((c) => c.cap)).toEqual([null, 2000, 500]);
  });

  it('no film left: « plus rien ici » (D9)', () => {
    const r = reco();
    r.positions[POSITIONS.indexOf(2000)]!.films = [];
    render(<Resultats nEntries={66} reco={r} />);
    expect(screen.getByText(NOTHING_HERE)).toBeInTheDocument();
    expect(NOTHING_HERE).toBe('plus rien ici : essaie « les valeurs sûres ».');
  });

  it('moving the slider shows another precomputed list and sentence', () => {
    render(<Resultats allNotches nEntries={66} reco={reco()} />);
    moveTo(null);
    expect(h1()).toHaveTextContent('voilà des valeurs sûres qui devraient te plaire.');
    expect(cards()[0]).toHaveTextContent('film inf #0');
    moveTo(500);
    expect(h1()).toHaveTextContent("voilà huit films que t'as sûrement jamais vus.");
    expect(cards()[0]).toHaveTextContent('film 500 #0');
  });

  it('« loin de tes goûts » below a relative score of 0.04 only', () => {
    render(<Resultats allNotches nEntries={66} reco={reco()} />);
    const note = "(là, on s'éloigne pas mal de tes goûts habituels)";
    moveTo(1000); // 0.09
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    moveTo(500); // 0.039
    expect(screen.getByText(note)).toBeInTheDocument();
    moveTo(200); // 0.02
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("« parce que t'as aimé »: on the cards, not at a notch far from the user's taste (Q4)", () => {
    render(<Resultats allNotches nEntries={66} reco={reco()} />);
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
    render(<Resultats allNotches nEntries={66} reco={r} />);
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
    render(<Resultats allNotches nEntries={66} reco={r} />);
    moveTo(500); // position 0.039 < 0.04, 3 / 8 far cards
    expect(screen.queryByText(FAR_ROWS_NOTE)).not.toBeInTheDocument();
    expect(
      screen.getByText("(là, on s'éloigne pas mal de tes goûts habituels)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/parce que t'as/)).not.toBeInTheDocument();
  });

  it('pépite stamp: at most one per block of 8 cards, at every notch', async () => {
    render(<Resultats allNotches nEntries={66} reco={reco()} />);
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
    render(<Resultats allNotches nEntries={66} reco={reco()} />);
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

  it('« les documentaires »: ticked by default; unticking asks for new lists (step 8b, D2-D3)', async () => {
    const views: ResultsView[] = [];
    render(<Resultats nEntries={66} reco={reco()} onViewChange={(v) => views.push(v)} />);
    await userEvent.click(screen.getByRole('button', { name: 'affiner' }));
    const box = screen.getByRole('checkbox', { name: 'les documentaires' });
    expect(box).toBeChecked();
    // the page never filters by itself: the worker sends filtered lists
    await userEvent.click(box);
    expect(views.at(-1)!.filters).toEqual({ ...NO_FILTERS, docs: false });
    expect(views.at(-1)!.visible).toBe(8);
  });

  it('filters and no film left: « rien ne passe tous ces filtres ici… »', () => {
    const r = reco();
    r.positions[POSITIONS.indexOf(2000)]!.films = [];
    render(
      <Resultats
        nEntries={66}
        reco={r}
        view={{
          index: 4,
          visible: 8,
          filters: { ...NO_FILTERS, genres: ['Horror'] },
          refineOpen: false,
          person: null,
        }}
      />,
    );
    expect(screen.getByText(NOTHING_PASSES)).toBeInTheDocument();
    expect(NOTHING_PASSES).toBe(
      'rien ne passe tous ces filtres ici. enlève-en un, ou essaie « les valeurs sûres ».',
    );
  });

  it('same-series note on the card', () => {
    render(<Resultats allNotches nEntries={66} reco={reco()} />);
    expect(
      screen.getByText("(même série que « Kill Bill: Vol. 1 », que t'as vu)"),
    ).toBeInTheDocument();
  });

  it('no profile note with fewer than 2 directors', () => {
    render(<Resultats allNotches nEntries={66} reco={reco({ profileDirectors: [] })} />);
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
      'equilibre',
      'curseur',
      'affiner',
      'recents',
      'tampons',
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
    expect(pageOfHash('#equilibre')).toBe('comment-ca-marche');
    expect(pageOfHash('#tampons')).toBe('comment-ca-marche');
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

  it('pages open over the results; « ← retour » gives them back in the same category', async () => {
    render(<App client={fakeApi()} />);
    await userEvent.upload(
      screen.getByLabelText(/glisse ton fichier ici/),
      new File(['Date,Name,Year,Letterboxd URI,Rating\n'], 'ratings.csv', { type: 'text/csv' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'voir mes films' }));
    await userEvent.click(await screen.findByRole('radio', { name: /^les pépites/ }));
    // a filter (step 8b, D3): kept while a page is open, like the category
    await userEvent.click(screen.getByRole('button', { name: 'affiner' }));
    await userEvent.click(screen.getByRole('button', { name: 'horreur' }));
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
    expect(screen.getByRole('radio', { name: /^les pépites/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'affiner (1)' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'horreur' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('« affiner » (step 8b, D3)', () => {
  function Controlled({ onView }: { onView?: (v: ResultsView) => void }) {
    const [view, setView] = useState<ResultsView>({
      index: 4,
      visible: 8,
      filters: NO_FILTERS,
      refineOpen: false,
      person: null,
    });
    return (
      <Resultats
        nEntries={66}
        reco={reco()}
        refine={REFINE_OPTIONS}
        view={view}
        onViewChange={(v) => {
          setView(v);
          onView?.(v);
        }}
      />
    );
  }

  it('a disclosure, not a modal: aria-expanded, the panel under the categories', async () => {
    render(<Controlled />);
    const button = screen.getByRole('button', { name: 'affiner' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'genres' })).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeVisible();
    for (const name of ['genres', 'époque', 'durée', 'langue', 'on montre aussi']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggle chips (aria-pressed), the count on the button, « × » chips and « tout effacer »', async () => {
    const views: ResultsView[] = [];
    render(<Controlled onView={(v) => views.push(v)} />);
    await userEvent.click(screen.getByRole('button', { name: 'affiner' }));
    const genres = screen.getByRole('group', { name: 'genres' });
    // French labels, sorted; no documentary nor IMAX
    expect(
      within(genres)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['comédie', 'drame', 'horreur']);
    const horror = within(genres).getByRole('button', { name: 'horreur' });
    await userEvent.click(horror);
    expect(horror).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(
      within(screen.getByRole('group', { name: 'époque' })).getByRole('button', {
        name: 'années 70',
      }),
    );
    expect(views.at(-1)!.filters).toEqual({
      ...NO_FILTERS,
      genres: ['Horror'],
      decades: ['1970'],
    });
    expect(screen.getByRole('button', { name: 'affiner (2)' })).toBeInTheDocument();
    expect(screen.getByText('les moins connus, 2 filtres : 8 films')).toBeInTheDocument();
    // « × horreur » removes the filter
    await userEvent.click(screen.getByRole('button', { name: 'retirer le filtre horreur' }));
    expect(views.at(-1)!.filters.genres).toEqual([]);
    expect(screen.getByRole('button', { name: 'affiner (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'les documentaires' }));
    expect(
      screen.getByRole('button', { name: 'retirer le filtre sans les documentaires' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'tout effacer' }));
    expect(views.at(-1)!.filters).toEqual(NO_FILTERS);
    expect(screen.getByRole('button', { name: 'affiner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tout effacer' })).not.toBeInTheDocument();
  });

  it('languages: 8 shown, then « autres langues »; French names, cantonais from the fallback', async () => {
    render(<Controlled />);
    await userEvent.click(screen.getByRole('button', { name: 'affiner' }));
    const lang = screen.getByRole('group', { name: 'langue' });
    const chips = () =>
      within(lang)
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('aria-pressed'))
        .map((b) => b.textContent);
    expect(chips()).toEqual([
      'anglais',
      'français',
      'japonais',
      'russe',
      'espagnol',
      'italien',
      'allemand',
      'hindi',
    ]);
    const more = within(lang).getByRole('button', { name: 'autres langues' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(chips().slice(8)).toEqual(['coréen', 'cantonais']);
  });
});

describe('« télécharger la liste (csv) » (step 8b, D6)', () => {
  it('under the grid: the 48 films of the category, in order; help sentence; nothing sent', async () => {
    const saved: { text: string; name: string }[] = [];
    const blobs: Blob[] = [];
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob) => {
      blobs.push(b);
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push({ text: '', name: this.download });
    };
    try {
      render(<Resultats nEntries={66} reco={reco()} />);
      expect(screen.getByText("compatible avec l'import de listes de Letterboxd.")).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'télécharger la liste (csv)' }));
      expect(saved).toHaveLength(1);
      expect(saved[0]!.name).toMatch(/^pepite-moins-connus-\d{4}-\d{2}-\d{2}\.csv$/);
      const text = await blobs[0]!.text();
      const lines = text.trimEnd().split('\r\n');
      expect(lines[0]).toBe('tmdbID,imdbID,Title,Year');
      expect(lines).toHaveLength(49); // the 48 films, not only the 8 shown
      expect(lines[1]).toContain('film 2000 #0');
      expect(lines[48]).toContain('film 2000 #47');
    } finally {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      HTMLAnchorElement.prototype.click = click;
    }
  });
});

describe('filtered recomputation through App (step 8b, D2)', () => {
  it('a filter asks the worker; the grid stays with aria-busy; an older answer is ignored', async () => {
    const calls: { filters?: Filters; explainCaps?: (number | null)[] }[] = [];
    const pending: ((r: RecommendResult) => void)[] = [];
    const api = fakeApi();
    api.recommend = (opts) => {
      calls.push(opts ?? {});
      if (!opts?.filters) return Promise.resolve(reco());
      return new Promise((resolve) => pending.push(resolve));
    };
    render(<App client={api} />);
    await userEvent.upload(
      screen.getByLabelText(/glisse ton fichier ici/),
      new File(['Date,Name,Year,Letterboxd URI,Rating\n'], 'ratings.csv', { type: 'text/csv' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'voir mes films' }));
    await screen.findByRole('radio', { name: /^les moins connus/ });
    // the first lists: explanations for the three categories only
    expect(calls[0]!.explainCaps).toEqual([null, 2000, 500]);
    const zone = () =>
      screen.getByRole('list', { name: 'films recommandés' }).closest('[aria-busy]')!;
    expect(zone()).toHaveAttribute('aria-busy', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'affiner' }));
    const box = screen.getByRole('checkbox', { name: 'les documentaires' });
    await userEvent.click(box); // docs off -> request 1
    expect(zone()).toHaveAttribute('aria-busy', 'true');
    expect(cards()[0]).toHaveTextContent('film 2000 #0'); // the previous grid stays
    await userEvent.click(box); // docs on again -> request 2
    expect(calls.map((c) => c.filters?.docs)).toEqual([undefined, false, true]);
    // the second answer arrives first, then the older one: the older is ignored
    const second = reco();
    second.positions[POSITIONS.indexOf(2000)]!.films[0]!.title = 'réponse 2';
    const first = reco();
    first.positions[POSITIONS.indexOf(2000)]!.films[0]!.title = 'réponse 1';
    await act(async () => pending[1]!(second));
    await act(async () => pending[0]!(first));
    expect(cards()[0]).toHaveTextContent('réponse 2');
    expect(zone()).toHaveAttribute('aria-busy', 'false');
  });
});

function fakeApi(): RecoApi {
  return {
    init: async () => ({
      nItems: 1,
      positions: POSITIONS,
      timings: {} as never,
      refine: REFINE_OPTIONS,
    }),
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
    people: async () => [],
    person: async ({ person }) => ({ person, name: 'x', films: [] }),
  };
}
