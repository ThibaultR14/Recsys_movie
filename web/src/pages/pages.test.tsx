import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type RecoApi } from '../App';
import type { ImportSummary } from '../reco/engine';
import {
  createHandler,
  type FilmCard,
  type ImportResult,
  type InitResult,
  type RecoRequest,
  type RecommendResult,
  type Unrecognized,
} from '../reco/workerCore';
import { Analyse } from './Analyse';
import { MESSAGES } from './readUpload';

const POSITIONS = [null, 20000, 10000, 5000, 2000, 1000, 500, 200];

function film(item: number, title = `film ${item}`): FilmCard {
  return {
    item,
    title,
    year: 2008,
    directors: ['Someone'],
    posterPath: null,
    popularity: 3000,
    tmdbId: item + 1000,
    genres: [],
  };
}

function summary(over: Partial<ImportSummary> = {}): ImportSummary {
  return {
    nEntries: 10,
    counts: {
      exact: 6,
      probable_variant: 0,
      probable_fuzzy: 1,
      ambiguous: 1,
      not_found: 2,
      confirmed: 0,
    },
    nHistoryFilms: 6,
    warnings: [],
    filesRead: ['ratings.csv', 'watched.csv'],
    ...over,
  };
}

const UNRECOGNIZED: Unrecognized[] = [
  {
    index: 3,
    title: 'Milk',
    year: 2008,
    status: 'ambiguous',
    candidates: [film(1, 'Milk'), film(2, 'Süt')],
  },
  {
    index: 5,
    title: 'Dr. Strangelove',
    year: 1964,
    status: 'probable_fuzzy',
    candidates: [film(7, 'Dr. Strangelove or: …')],
  },
  { index: 8, title: 'Anora', year: 2024, status: 'not_found', candidates: [] },
  { index: 9, title: 'Chernobyl', year: 2019, status: 'not_found', candidates: [] },
];

function recoResult(): RecommendResult {
  return {
    nHistory: 7,
    nExcluded: 9,
    profileDirectors: ['Andrei Tarkovsky', 'Wong Kar-wai'],
    positions: POSITIONS.map((cap) => ({
      cap,
      relativeScore: 0.5,
      films: Array.from({ length: 48 }, (_, i) => ({ ...film(100 + i), score: 1 - i / 100 })),
    })),
  };
}

function fakeClient(
  over: Partial<RecoApi> = {},
): RecoApi & { [K in keyof RecoApi]: ReturnType<typeof vi.fn> } {
  return {
    init: vi.fn(async (): Promise<InitResult> => ({
      nItems: 23019,
      positions: POSITIONS,
      timings: {} as InitResult['timings'],
    })),
    importExport: vi.fn(async (): Promise<ImportResult> => ({
      summary: summary(),
      unrecognized: UNRECOGNIZED,
    })),
    confirm: vi.fn(async () => ({ counts: summary().counts, nHistoryFilms: 7 })),
    recommend: vi.fn(async () => recoResult()),
    ...over,
  } as never;
}

const zip = () => new File([new Uint8Array([80, 75, 3, 4])], 'letterboxd-export.zip');

describe('Analyse', () => {
  it('counts, sections, nothing ticked by default, choices sent by entry index', async () => {
    const onSubmit = vi.fn();
    render(<Analyse summary={summary()} unrecognized={UNRECOGNIZED} onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'on a lu tes 10 films.on en a reconnu 6.',
    );
    const verify = screen.getByRole('region', { name: 'à vérifier' });
    const groups = within(verify).getAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName('dans ton fichier : « Milk » (2008)');
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(within(groups[0]!).getAllByRole('radio')).toHaveLength(3); // 2 candidates + none

    await userEvent.click(within(groups[0]!).getByRole('radio', { name: /Süt/ }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('on en a reconnu 7.');
    await userEvent.click(within(groups[1]!).getByRole('radio', { name: 'aucun de ceux-là' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('on en a reconnu 7.');

    expect(
      screen.getByText('1 film est sorti après 2023 : trop récent pour nous, désolé.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 film qu'on connaît pas (séries, films très peu vus…)"),
    ).toBeInTheDocument();
    expect(screen.getByText('Anora, 2024')).not.toBeVisible(); // folded list

    await userEvent.click(screen.getByRole('button', { name: 'voir mes films' }));
    expect(onSubmit).toHaveBeenCalledWith({ 3: 2, 5: null });
  });

  it('no section « à vérifier » when there is nothing to verify', () => {
    render(
      <Analyse summary={summary()} unrecognized={UNRECOGNIZED.slice(2)} onSubmit={() => {}} />,
    );
    expect(screen.queryByRole('region', { name: 'à vérifier' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'voir mes films' })).toBeEnabled();
  });
});

describe('App (fake worker)', () => {
  it('loads the model on arrival, then file -> analysis -> results', async () => {
    const client = fakeClient();
    render(<App client={client} />);
    expect(client.init).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      "salut.donne-nous ta liste de films,on te trouve ceux que t'as pas encore vus.",
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain(
      '× on garde rien : tout se passe dans ton navigateur',
    );
    await userEvent.upload(screen.getByLabelText(/glisse ton fichier ici/), zip());
    await screen.findByText(/on a lu tes 10 films/);
    expect(client.importExport.mock.calls[0]![0].kind).toBe('zip');

    await userEvent.click(screen.getByRole('radio', { name: /^Milk/ }));
    await userEvent.click(screen.getByRole('button', { name: 'voir mes films' }));
    await screen.findByRole('list', { name: 'films recommandés' });
    expect(client.confirm).toHaveBeenCalledWith({ 3: 1 });
    expect(client.recommend).toHaveBeenCalledWith({ n: 48 });
    expect(client.recommend).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '← changer de fichier' }));
    expect(screen.getByLabelText(/glisse ton fichier ici/)).toBeInTheDocument();
  });

  it('drag and drop works too', async () => {
    const client = fakeClient();
    render(<App client={client} />);
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [zip()] } });
    await screen.findByText(/on a lu tes 10 films/);
  });

  it('a file dropped before the model is ready waits with « on prépare nos fiches… »', async () => {
    let finish!: (v: InitResult) => void;
    const client = fakeClient({ init: vi.fn(() => new Promise<InitResult>((r) => (finish = r))) });
    render(<App client={client} />);
    await userEvent.upload(screen.getByLabelText(/glisse ton fichier ici/), zip());
    expect(await screen.findByText('on prépare nos fiches…')).toBeInTheDocument();
    expect(client.importExport).not.toHaveBeenCalled();
    await act(async () =>
      finish({ nItems: 1, positions: POSITIONS, timings: {} as InitResult['timings'] }),
    );
    await screen.findByText(/on a lu tes 10 films/);
  });

  it('IMDb list, unreadable file, no film recognized: short messages, stays home', async () => {
    const client = fakeClient();
    render(<App client={client} />);
    const input = screen.getByLabelText(/glisse ton fichier ici/);
    await userEvent.upload(input, new File(['Position,Const,Title\n'], 'WATCHLIST.csv'));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.imdbList);
    expect(client.importExport).not.toHaveBeenCalled();

    client.importExport.mockRejectedValueOnce(new Error('invalid zip data'));
    await userEvent.upload(input, zip());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.notExport));

    client.importExport.mockResolvedValueOnce({
      summary: summary({ nEntries: 0, nHistoryFilms: 0 }),
      unrecognized: [],
    });
    await userEvent.upload(input, zip());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.notExport));

    client.importExport.mockResolvedValueOnce({
      summary: summary({ nHistoryFilms: 0 }),
      unrecognized: UNRECOGNIZED.slice(2),
    });
    await userEvent.upload(input, zip());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.noneRecognized),
    );
    expect(screen.getByLabelText(/glisse ton fichier ici/)).toBeInTheDocument();
  });

  it('« je sais pas où trouver mon export » unfolds a short help', async () => {
    render(<App client={fakeClient()} />);
    const btn = screen.getByRole('button', { name: 'je sais pas où trouver mon export' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/réglages → import & export → exporter tes données/)).not.toBeVisible();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/réglages → import & export → exporter tes données/)).toBeVisible();
    expect(
      screen.getByText(/ton profil → évaluations → actions → exporter. le fichier se prépare/),
    ).toBeVisible();
  });
});

// --- full path on the real files (skipped without web/public/data) ------------------------------

// jsdom: import.meta.url is not a file URL; Vitest runs from web/.
const DATA = join(process.cwd(), 'public/data/');
const EXAMPLE = join(process.cwd(), 'public/exemple/letterboxd-exemple.zip');
const ready =
  existsSync(EXAMPLE) && existsSync(DATA + 'catalog.json') && existsSync(DATA + 'embeddings.bin');

/** In-process client over the real worker handler (no Worker in jsdom). */
function inProcessClient(): RecoApi {
  const handle = createHandler(
    async (url) => new Response(readFileSync(DATA + url.replace('/data/', ''))),
  );
  let id = 0;
  const call = async <T,>(
    req: { type: RecoRequest['type'] } & Record<string, unknown>,
  ): Promise<T> => {
    const r = await handle({ ...req, id: ++id } as RecoRequest);
    if (!r.ok) throw new Error(r.error);
    return r.result as T;
  };
  return {
    init: () => call({ type: 'init' }),
    importExport: (input) => call({ type: 'import', input }),
    confirm: (choices) => call({ type: 'confirm', choices }),
    recommend: (o = {}) => call({ type: 'recommend', ...o }),
  };
}

describe.skipIf(!ready)('App on the real files, example export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('example -> analysis (Milk, Dr. Strangelove, after 2023) -> results', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('/exemple/letterboxd-exemple.zip');
      return new Response(readFileSync(EXAMPLE));
    });
    render(<App client={inProcessClient()} />);
    await userEvent.click(screen.getByRole('link', { name: 'montre-moi un exemple →' }));
    const h1 = await screen.findByText(/on a lu tes 66 films/, {}, { timeout: 10000 });
    expect(h1).toHaveTextContent('on en a reconnu 61.');
    expect(
      screen.getByRole('group', { name: 'dans ton fichier : « Milk » (2008)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'dans ton fichier : « Dr. Strangelove » (1964)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('2 films sont sortis après 2023 : trop récents pour nous, désolé.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 film qu'on connaît pas (séries, films très peu vus…)"),
    ).toBeInTheDocument();

    const milk = screen.getByRole('group', { name: 'dans ton fichier : « Milk » (2008)' });
    await userEvent.click(within(milk).getAllByRole('radio')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'voir mes films' }));
    const grid = await screen.findByRole('list', { name: 'films recommandés' }, { timeout: 10000 });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(8);
  }, 30000);

  it('IMDb example CSV dropped -> title fallback to verify, unticked; series apart -> results', async () => {
    render(<App client={inProcessClient()} />);
    const csv = readFileSync(join(process.cwd(), 'public/exemple/imdb-exemple.csv'));
    await userEvent.upload(
      screen.getByLabelText(/glisse ton fichier ici/),
      new File([csv], 'ratings.csv', { type: 'text/csv' }),
    );
    const h1 = await screen.findByText(/on a lu tes 68 films/, {}, { timeout: 10000 });
    expect(h1).toHaveTextContent('on en a reconnu 63.');
    const verify = screen.getByRole('region', { name: 'à vérifier' });
    const groups = within(verify).getAllByRole('group');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName(
      'dans ton fichier : « Die Regenschirme von Cherbourg » (1964)',
    );
    for (const r of within(groups[0]!).getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(
      screen.getByText('3 séries, épisodes ou jeux : on fait que les films.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 film est sorti après 2023 : trop récent pour nous, désolé.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/qu'on connaît pas/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'voir mes films' }));
    const grid = await screen.findByRole('list', { name: 'films recommandés' }, { timeout: 10000 });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(8);
  }, 30000);
});
