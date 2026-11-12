import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FilmCard as FilmData } from '../reco/workerCore';
import { ArrowNote } from './ArrowNote';
import { DropZone } from './DropZone';
import { FilmCard } from './FilmCard';
import { FilmGrid } from './FilmGrid';
import { HandNote } from './HandNote';
import { Layout } from './Layout';
import { NoList } from './NoList';
import { PrimaryButton } from './PrimaryButton';
import { Slider } from './Slider';
import { ThemeToggle } from './ThemeToggle';
import { THEME_KEY } from '../theme';
import { Underline } from './Underline';
import {
  byline,
  cardRotation,
  cardTags,
  citationPicks,
  hasFarRow,
  pepiteStamps,
  ratingLine,
  tagLabel,
  tapeRotation,
  type TaggedFilm,
} from './cardRules';
import { capLabel } from './sliderText';

const POSITIONS = [null, 20000, 10000, 5000, 2000, 1000, 500, 200];

function film(over: Partial<FilmData> = {}): FilmData {
  return {
    item: 42,
    title: 'Stalker',
    year: 1979,
    directors: ['Andrei Tarkovsky'],
    posterPath: '/stalker.jpg',
    popularity: 5000,
    tmdbId: 1398,
    genres: ['Drama', 'Sci-Fi'],
    ...over,
  };
}

describe('Layout', () => {
  it('header: logo, provisional-name note, navigation, theme button; footer notices', () => {
    render(<Layout>contenu</Layout>);
    expect(screen.getByRole('link', { name: 'pépite' })).toBeInTheDocument();
    expect(screen.getByText('(nom provisoire)')).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['comment ça marche', '#comment-ca-marche'],
      ['à propos', '#a-propos'],
      ['contact', '#contact'],
    ]);
    expect(within(nav).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'passer en clair' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('contenu');
    expect(screen.queryByRole('link', { name: '← retour' })).not.toBeInTheDocument();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(
      'fait à la main par des gens qui regardent trop de films. projet indépendant, sans lien avec letterboxd ni imdb.',
    );
    expect(footer).toHaveTextContent(
      'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    );
  });

  it('analysis and results: navigation kept, « ← changer de fichier » in the content', async () => {
    const onBack = vi.fn();
    render(
      <Layout width="wide" onBack={onBack}>
        x
      </Layout>,
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const back = within(screen.getByRole('main')).getByRole('button', {
      name: '← changer de fichier',
    });
    expect(back).toHaveClass('min-h-11');
    back.focus();
    await userEvent.keyboard('{Enter}');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a page: its link is the current one, « ← retour » goes back to « # »', () => {
    render(
      <Layout page="contact" onBack={() => {}}>
        x
      </Layout>,
    );
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('contact');
    expect(screen.getByRole('link', { name: '← retour' })).toHaveAttribute('href', '#');
    expect(screen.queryByRole('button', { name: '← changer de fichier' })).not.toBeInTheDocument();
  });
});

describe('small pieces', () => {
  it('HandNote is tilted Caveat text', () => {
    render(<HandNote rotate={-3}>(t'aimes bien ozu, non ?)</HandNote>);
    const el = screen.getByText("(t'aimes bien ozu, non ?)");
    expect(el).toHaveClass('font-hand', 'text-pen');
    expect(el.style.transform).toBe('rotate(-3deg)');
  });

  it('Underline keeps the words and hides the drawing', () => {
    render(
      <h1>
        <Underline>pas encore vus.</Underline>
      </h1>,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('pas encore vus.');
    expect(screen.getByTestId('underline')).toHaveAttribute('aria-hidden', 'true');
  });

  it('ArrowNote shows its text, arrow hidden', () => {
    const { container } = render(<ArrowNote>c'est là</ArrowNote>);
    expect(screen.getByText("c'est là")).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('PrimaryButton is a 48 px button that works with the keyboard', async () => {
    const onClick = vi.fn();
    render(<PrimaryButton onClick={onClick}>voir mes films</PrimaryButton>);
    const b = screen.getByRole('button', { name: 'voir mes films' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveClass('h-12');
    b.focus();
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('NoList: a list without bullets, each line starting with ×', () => {
    render(<NoList items={['pas de compte à créer', 'pas de pub, pas de tracking']} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '× pas de compte à créer',
      '× pas de pub, pas de tracking',
    ]);
  });
});

describe('DropZone', () => {
  it('is a labelled file input accepting .zip and .csv', () => {
    render(<DropZone onFile={() => {}} />);
    const input = screen.getByLabelText(/glisse ton fichier ici/);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.zip,.csv');
    expect(
      screen.getByText("l'export de letterboxd (le .zip) ou tes notes imdb (le .csv)"),
    ).toBeInTheDocument();
    expect(screen.getByText("c'est là")).toBeInTheDocument();
  });

  it('hands over a chosen file (click / keyboard picker)', async () => {
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} />);
    const input = screen.getByLabelText(/glisse ton fichier ici/);
    await userEvent.tab();
    expect(input).toHaveFocus();
    const f = new File(['x'], 'letterboxd.zip', { type: 'application/zip' });
    await userEvent.upload(input, f);
    expect(onFile).toHaveBeenCalledWith(f);
  });

  it('hands over a dropped file, not when disabled', () => {
    const onFile = vi.fn();
    const f = new File(['x'], 'ratings.csv', { type: 'text/csv' });
    const { rerender } = render(<DropZone onFile={onFile} />);
    const zone = screen.getByTestId('drop-zone');
    fireEvent.dragOver(zone, { dataTransfer: { files: [f] } });
    expect(zone).toHaveClass('border-pen');
    fireEvent.drop(zone, { dataTransfer: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
    expect(zone).toHaveClass('border-ink');
    rerender(<DropZone onFile={onFile} disabled />);
    fireEvent.drop(zone, { dataTransfer: { files: [f] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });
});

describe('card rules', () => {
  it('rotation is deterministic, within ±1.8°, and varies across films', () => {
    const rots = Array.from({ length: 2000 }, (_, i) => cardRotation(i));
    expect(rots.every((r) => r >= -1.8 && r <= 1.8)).toBe(true);
    expect(cardRotation(123)).toBe(cardRotation(123));
    expect(new Set(rots).size).toBeGreaterThan(30);
    expect(Math.min(...rots)).toBeLessThan(-1.5);
    expect(Math.max(...rots)).toBeGreaterThan(1.5);
    const tapes = Array.from({ length: 500 }, (_, i) => tapeRotation(i));
    expect(tapes.every((r) => r >= -4 && r <= 4)).toBe(true);
  });

  it('pépite stamp: least known of each block of 8, at most half the block median', () => {
    const block = [900, 800, 700, 600, 500, 400, 300, 200]; // median 550: 200 <= 275
    expect([...pepiteStamps(block)]).toEqual([7]);
    // 300 > 550 / 2: no stamp, whatever the absolute popularity
    expect(pepiteStamps([900, 800, 700, 600, 500, 400, 350, 300]).size).toBe(0);
    expect(pepiteStamps([50000, 40000, 45000, 9000, 60000, 52000, 48000, 41000])).toEqual(
      new Set([3]),
    );
    // exactly half the median counts; a tie goes to the first card
    expect([...pepiteStamps([10, 10, 10, 10, 10, 10, 5, 5])]).toEqual([6]);
    // one stamp per block, indexes relative to the grid; a shorter last block follows the rule
    expect([...pepiteStamps([...block, ...block, 1000, 1000, 100])]).toEqual([7, 15, 18]);
    expect(pepiteStamps([100]).size).toBe(0);
    expect(pepiteStamps([]).size).toBe(0);
  });

  it('byline: up to two directors, then the year', () => {
    expect(byline(['Andrei Tarkovsky'], 1979)).toBe('Andrei Tarkovsky, 1979');
    expect(byline(['Joel Coen', 'Ethan Coen', 'X'], 1996)).toBe('Joel Coen et Ethan Coen, 1996');
    expect(byline([], 2001)).toBe('2001');
    expect(byline(['Agnès Varda'], null)).toBe('Agnès Varda');
  });
});

describe('FilmCard', () => {
  it('links the whole card to Letterboxd by tmdb id, in a new tab', () => {
    render(<FilmCard film={film()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://letterboxd.com/tmdb/1398/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('Stalker');
    expect(link).toHaveTextContent('Andrei Tarkovsky, 1979');
    expect(link).toHaveTextContent("(s'ouvre sur letterboxd, dans un nouvel onglet)");
  });

  it('is not a link without tmdb id', () => {
    render(<FilmCard film={film({ tmdbId: null })} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('film-card')).toHaveTextContent('Stalker');
  });

  it('poster: TMDB w342, lazy, alt = title; plain frame without poster', () => {
    const { rerender } = render(<FilmCard film={film()} />);
    const img = screen.getByRole('img', { name: 'Stalker' });
    expect(img).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w342/stalker.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
    rerender(<FilmCard film={film({ posterPath: null })} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('no-poster')).toBeInTheDocument();
  });

  it('rotation comes from item_idx only', () => {
    const { rerender } = render(<FilmCard film={film({ item: 7 })} />);
    const a = screen.getByTestId('film-card').style.transform;
    rerender(<FilmCard film={film({ item: 7, title: 'Autre', popularity: 3 })} />);
    expect(screen.getByTestId('film-card').style.transform).toBe(a);
    expect(a).toBe(`rotate(${cardRotation(7)}deg)`);
  });

  it('pépite stamp only when the grid asks for it', () => {
    const { rerender } = render(<FilmCard film={film()} tag={{ kind: 'pepite' }} />);
    expect(screen.getByText('✱ pépite')).toBeInTheDocument();
    rerender(<FilmCard film={film()} />);
    expect(screen.queryByText('✱ pépite')).not.toBeInTheDocument();
  });

  it('tags (Q6): same place and style as the stamp; a long director name is cut, full for screen readers', () => {
    const { rerender } = render(<FilmCard film={film()} tag={{ kind: 'vieux' }} />);
    const tag = screen.getByTestId('card-tag');
    expect(tag).toHaveTextContent('vieux trésor');
    expect(tag).toHaveAttribute('data-tag', 'vieux');
    const style = tag.className;
    rerender(<FilmCard film={film()} tag={{ kind: 'pepite' }} />);
    expect(screen.getByTestId('card-tag').className).toBe(style);
    rerender(
      <FilmCard
        film={film()}
        tag={{ kind: 'realisateur', director: 'Apichatpong Weerasethakul' }}
      />,
    );
    const long = screen.getByTestId('card-tag');
    expect(within(long).getByText('encore un Apichatpong Wee…')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(within(long).getByText('encore un Apichatpong Weerasethakul')).toHaveClass('sr-only');
  });

  it('documentary mention from the MovieLens genre', () => {
    const { rerender } = render(<FilmCard film={film()} />);
    expect(screen.queryByText('documentaire')).not.toBeInTheDocument();
    rerender(<FilmCard film={film({ genres: ['Documentary'] })} />);
    expect(screen.getByText('documentaire')).toBeInTheDocument();
  });

  it('same-series note', () => {
    render(<FilmCard film={film()} seriesOf="Alien" />);
    expect(screen.getByText("(même série que « Alien », que t'as vu)")).toBeInTheDocument();
  });
});

describe('FilmGrid', () => {
  it('lists one card per film, with its series note', () => {
    const films = [film({ item: 1, title: 'A' }), film({ item: 2, title: 'B', tmdbId: null })];
    render(<FilmGrid films={films} seriesOf={new Map([[2, 'A']])} />);
    const list = screen.getByRole('list', { name: 'films recommandés' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText("(même série que « A », que t'as vu)")).toBeInTheDocument();
  });

  it('stamps the least known film of each block of 8 when well below the block median', () => {
    const pops = [5000, 4000, 4500, 6000, 1200, 5200, 4800, 4100, 3000, 3100, 2900, 3050];
    const films = pops.map((popularity, i) => film({ item: i, title: `F${i}`, popularity }));
    render(<FilmGrid films={films} />);
    const items = within(screen.getByRole('list', { name: 'films recommandés' })).getAllByRole(
      'listitem',
    );
    expect(screen.getAllByText('✱ pépite')).toHaveLength(1); // second block: 2 900 > 3 025 / 2
    expect(items[4]).toHaveTextContent('✱ pépite');
  });
});

describe('Slider', () => {
  function Controlled({ start = 4, onChange }: { start?: number; onChange?: (i: number) => void }) {
    const [i, setI] = useState(start);
    return (
      <Slider
        positions={POSITIONS}
        index={i}
        onChange={(v) => {
          setI(v);
          onChange?.(v);
        }}
      />
    );
  }

  it('cap labels', () => {
    expect(capLabel(null)).toBe('');
    expect(capLabel(2000).replace(/\s/g, ' ')).toBe('moins de 2 000 notes');
  });

  it('labelled native range with 8 notches, end labels and the current cap', () => {
    render(<Controlled />);
    const range = screen.getByRole('slider', { name: 'plutôt connu ou plutôt pépite ?' });
    expect(range).toHaveAttribute('type', 'range');
    expect(range).toHaveAttribute('min', '0');
    expect(range).toHaveAttribute('max', '7');
    expect(range).toHaveValue('4');
    expect(range).toHaveClass('h-11', 'accent-pen');
    expect(screen.getByText('les classiques')).toBeInTheDocument();
    expect(screen.getByText('les trucs que personne connaît')).toBeInTheDocument();
    expect(screen.getByTestId('cap-label').textContent?.replace(/\s/g, ' ')).toBe(
      'moins de 2 000 notes',
    );
  });

  // Arrow keys on a native range are browser behaviour (not simulated by jsdom): checked in
  // Playwright (G5). Here: focusable, and a value change reports the notch index.
  it('is focusable, reports the notch index; nothing shown at ∞', async () => {
    const onChange = vi.fn();
    render(<Controlled start={1} onChange={onChange} />);
    const range = screen.getByRole('slider');
    await userEvent.tab();
    expect(range).toHaveFocus();
    fireEvent.change(range, { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.change(range, { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId('cap-label')).toHaveTextContent('');
    expect(range).toHaveAttribute('aria-valuetext', 'les classiques');
  });
});

describe('ThemeToggle', () => {
  it('dark by default; light is stored under one key, removed when back to dark', async () => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'passer en clair' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect({ ...localStorage }).toEqual({ [THEME_KEY]: 'light' });
    await userEvent.click(screen.getByRole('button', { name: 'passer en sombre' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.length).toBe(0);
  });
});

describe('public rating (step 6b, D5)', () => {
  it('« ★ 3,9 · 1 240 notes », spoken without the star', () => {
    expect(ratingLine(39, 1240).visible).toBe('3,9 · 1 240 notes');
    expect(ratingLine(40, 20).visible).toBe('4,0 · 20 notes');
    expect(ratingLine(9, 102929).spoken).toBe('note moyenne 0,9 sur 5, 102 929 notes');
  });

  it('on the card, under the byline; absent without data', () => {
    const { rerender } = render(
      <FilmCard film={film({ publicRating: { mean10: 39, count: 1240 } })} />,
    );
    const line = screen.getByTestId('public-rating');
    expect(within(line).getByText('★ 3,9 · 1 240 notes')).toHaveAttribute('aria-hidden', 'true');
    expect(within(line).getByText('note moyenne 3,9 sur 5, 1 240 notes')).toHaveClass('sr-only');
    rerender(<FilmCard film={film()} />);
    expect(screen.queryByTestId('public-rating')).not.toBeInTheDocument();
  });
});

describe("« parce que t'as aimé » on a card (step 6b, D6)", () => {
  const long = 'The Lord of the Rings: The Fellowship of the Ring';

  it('one or two titles, long titles cut for the eye but whole for screen readers', () => {
    render(<FilmCard film={film()} because={{ kind: 'liked', titles: ['Stalker', long] }} />);
    // 32 characters at most: 31 + « … »
    const shown = screen.getByText(
      "(parce que t'as aimé « Stalker » et « The Lord of the Rings: The Fell… »)",
    );
    expect(shown).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(`(parce que t'as aimé « Stalker » et « ${long} »)`)).toHaveClass(
      'sr-only',
    );
  });

  it('« vu » when the history has no rating; the series note replaces it (Q3)', () => {
    const { rerender } = render(
      <FilmCard film={film()} because={{ kind: 'seen', titles: ['Ran'] }} />,
    );
    expect(
      screen.getByText("(parce que t'as vu « Ran »)", { selector: '[aria-hidden]' }),
    ).toBeInTheDocument();
    rerender(
      <FilmCard
        film={film()}
        seriesOf="Kill Bill: Vol. 1"
        because={{ kind: 'seen', titles: ['Ran'] }}
      />,
    );
    expect(screen.queryByText(/parce que/)).not.toBeInTheDocument();
    expect(screen.getByText(/même série que/)).toBeInTheDocument();
  });
});

describe('citation diversity (step 6b, R6, option A)', () => {
  it('a history film is cited on 2 cards of a block of 8 at most; then the next closest', () => {
    const all = Array.from({ length: 8 }, () => [1, 2, 3, 4]);
    expect(citationPicks(all)).toEqual([[0, 1], [0, 1], [2, 3], [2, 3], [], [], [], []]);
  });

  it('one title, or none, when the candidates run out; a new block starts afresh', () => {
    const cands = [[1, 2], [1], [1, 2], [2, 1], undefined, [], ...Array(2).fill([7]), [1, 2]];
    expect(citationPicks(cands)).toEqual([[0, 1], [0], [1], [], [], [], [0], [0], [0, 1]]);
  });
});

it('the grid applies the diversity rule to the cards', () => {
  const films = Array.from({ length: 4 }, (_, i) => ({
    ...film({ item: i, tmdbId: null }),
    because: { kind: 'liked' as const, items: [7, 8, 9], titles: ['A', 'B', 'C'] },
  }));
  render(<FilmGrid films={films} />);
  const why = screen
    .getAllByText(/^\(parce que/, { selector: '[aria-hidden]' })
    .map((e) => e.textContent);
  expect(why).toEqual([
    "(parce que t'as aimé « A » et « B »)",
    "(parce que t'as aimé « A » et « B »)",
    "(parce que t'as aimé « C »)",
    "(parce que t'as aimé « C »)", // C was cited once only
  ]);
});

describe('rows far from the taste (step 6b, Q4 revised)', () => {
  const t = 0.04;
  it('at least half of a row of 8 below the threshold', () => {
    expect(hasFarRow([0.1, 0.1, 0.1, 0.1, 0.03, 0.03, 0.03, 0.03], t)).toBe(true); // 4 / 8
    expect(hasFarRow([0.1, 0.1, 0.1, 0.1, 0.1, 0.03, 0.03, 0.03], t)).toBe(false); // 3 / 8
    expect(hasFarRow([...Array(8).fill(0.1), 0.03, 0.1], t)).toBe(true); // last row: 1 / 2
    expect(hasFarRow([...Array(8).fill(0.1), 0.03, 0.1, 0.1], t)).toBe(false); // 1 / 3
    expect(hasFarRow([], t)).toBe(false);
    expect(hasFarRow([0.04], t)).toBe(false); // strictly below
  });
});

describe('card tags (step 6c, Q6)', () => {
  const f = (over: Partial<TaggedFilm> = {}): TaggedFilm => ({
    popularity: 5000,
    year: 2000,
    directors: ['X'],
    ...over,
  });

  it('labels: « encore un » + full name, cut at 26 characters with « … »', () => {
    expect(tagLabel({ kind: 'realisateur', director: 'Denis Villeneuve' })).toEqual({
      visible: 'encore un Denis Villeneuve',
      full: 'encore un Denis Villeneuve',
    });
    const long = tagLabel({ kind: 'realisateur', director: 'Apichatpong Weerasethakul' });
    expect([...long.visible]).toHaveLength(26);
    expect(long.visible.endsWith('…')).toBe(true);
    expect(tagLabel({ kind: 'divise' }).visible).toBe('ça divise');
    expect(tagLabel({ kind: 'vieux' }).visible).toBe('vieux trésor');
  });

  it('one tag per card, by the hierarchy: pépite > réalisateur > ça divise > vieux trésor', () => {
    // 8 cards: card 7 is the least known (stamp); it is also by a liked director, divisive, old
    const films = [
      ...Array.from({ length: 7 }, () => f()),
      f({ popularity: 100, year: 1950, directors: ['Ozu'], divisive: true }),
    ];
    expect(cardTags(films, ['Ozu'])[7]).toEqual({ kind: 'pepite' });
    const noStamp = films.map((x) => ({ ...x, popularity: 900 }));
    expect(cardTags(noStamp, ['Ozu'])[7]).toEqual({ kind: 'realisateur', director: 'Ozu' });
    expect(cardTags(noStamp, [])[7]).toEqual({ kind: 'divise' });
    expect(
      cardTags(
        noStamp.map((x) => ({ ...x, divisive: false })),
        [],
      )[7],
    ).toEqual({
      kind: 'vieux',
    });
  });

  it('vieux trésor: before 1960 and popularity at most 1 000', () => {
    const tag = (over: Partial<TaggedFilm>) => cardTags([f(over)], [])[0];
    expect(tag({ year: 1959, popularity: 1000 })).toEqual({ kind: 'vieux' });
    expect(tag({ year: 1960, popularity: 500 })).toBeNull();
    expect(tag({ year: 1959, popularity: 1001 })).toBeNull();
    expect(tag({ year: null, popularity: 10 })).toBeNull();
  });

  it('at most 2 tags per row of 8, by the hierarchy then the list order; the stamp is kept', () => {
    // row 1: all divisive and old, card 5 the stamp, card 6 by a liked director
    const row = Array.from({ length: 8 }, (_, i) =>
      f({
        popularity: i === 5 ? 50 : 800,
        year: 1950,
        divisive: true,
        directors: [i === 6 ? 'Ozu' : 'X'],
      }),
    );
    const tags = cardTags([...row, ...row], ['Ozu']);
    expect(tags.slice(0, 8).filter(Boolean)).toHaveLength(2);
    expect(tags[5]).toEqual({ kind: 'pepite' });
    expect(tags[6]).toEqual({ kind: 'realisateur', director: 'Ozu' });
    // the second row is counted on its own
    expect(tags.slice(8).filter(Boolean)).toHaveLength(2);
    // without stamp or director: the first two divisive cards of the row
    const plain = cardTags(
      Array.from({ length: 8 }, () => f({ divisive: true })),
      [],
    );
    expect(plain.map((t) => t?.kind ?? null)).toEqual([
      'divise',
      'divise',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
