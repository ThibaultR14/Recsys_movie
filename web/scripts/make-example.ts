/**
 * Synthetic example exports (step 5, D3; step 6, D8): real, well-known films with invented ratings,
 * no personal data. Writes public/exemple/letterboxd-exemple.zip (ratings.csv + watched.csv) and
 * public/exemple/imdb-exemple.csv (IMDb ratings format; needs public/data/ for the ids).
 *
 * It exercises the analysis screen: one ambiguous title (« Milk », two films of 2008-2009), one
 * approximate title (probable_fuzzy: « Dr. Strangelove », short for the full title), two films
 * released after 2023 and one TV series (not in the catalogue).
 *
 *   npm run make-example            # writes the ZIP
 *   npm run make-example -- --check # also prints the match status of every title
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

/** [title, year, rating (0.5-5) or null = watched without rating] */
const FILMS: [string, number, number | null][] = [
  ['Amélie', 2001, 4],
  ['The Usual Suspects', 1995, 3.5],
  ['Seven Samurai', 1954, 5],
  ['Spirited Away', 2001, 4.5],
  ['In the Mood for Love', 2000, 5],
  ['Mulholland Drive', 2001, 4.5],
  ['Portrait of a Lady on Fire', 2019, 4.5],
  ['Parasite', 2019, 4],
  ['City of God', 2002, 4],
  ['The Good, the Bad and the Ugly', 1966, 4],
  ['The 400 Blows', 1959, 4.5],
  ['Crouching Tiger, Hidden Dragon', 2000, 3.5],
  ["Pan's Labyrinth", 2006, 4],
  ['Lost in Translation', 2003, 4],
  ['Eternal Sunshine of the Spotless Mind', 2004, 4.5],
  ['Pulp Fiction', 1994, 3.5],
  ['The Godfather', 1972, 4.5],
  ['Taxi Driver', 1976, 4],
  ['Apocalypse Now', 1979, 4],
  ['Blade Runner', 1982, 4],
  ['Alien', 1979, 4],
  ['2001: A Space Odyssey', 1968, 5],
  ['Stalker', 1979, 5],
  ['Solaris', 1972, 4.5],
  ['Persona', 1966, 4.5],
  ['The Seventh Seal', 1957, 4],
  ['Breathless', 1960, 3.5],
  ['Contempt', 1963, 4],
  ['Chungking Express', 1994, 4.5],
  ['Yi Yi', 2000, 5],
  ['Tokyo Story', 1953, 5],
  ['Rashomon', 1950, 4],
  ['My Neighbor Totoro', 1988, 4],
  ['Princess Mononoke', 1997, 4],
  ['Oldboy', 2003, 3.5],
  ['Memories of Murder', 2003, 4.5],
  ['Before Sunrise', 1995, 4],
  ['Before Sunset', 2004, 4.5],
  ['Paris, Texas', 1984, 5],
  ['Wings of Desire', 1987, 4.5],
  ['Fargo', 1996, 4],
  ['No Country for Old Men', 2007, 4],
  ['There Will Be Blood', 2007, 4.5],
  ['The Social Network', 2010, 3.5],
  ['Her', 2013, 3.5],
  ['Moonlight', 2016, 4],
  ['Get Out', 2017, 3.5],
  ['Mad Max: Fury Road', 2015, 4],
  ['Whiplash', 2014, 3],
  ['La La Land', 2016, 2.5],
  ['The Grand Budapest Hotel', 2014, 3.5],
  ['Amour', 2012, 4],
  ['A Separation', 2011, 4.5],
  ['Drive', 2011, 3],
  ['Inception', 2010, 3],
  ['The Dark Knight', 2008, 3],
  ['Kill Bill: Vol. 1', 2003, 3.5],
  ['Titanic', 1997, null],
  ['Forrest Gump', 1994, null],
  ['The Matrix', 1999, null],
  // analysis screen cases
  ['Milk', 2008, 4], // ambiguous
  ['Dr. Strangelove', 1964, 4.5], // probable_fuzzy
  ["Harry Potter and the Sorcerer's Stone", 2001, 2.5],
  ['Anora', 2024, 4], // after 2023
  ['The Substance', 2024, 3.5], // after 2023
  ['Chernobyl', 2019, 4.5], // TV series
];

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function day(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 5) + i * 5 * 86400000);
  return d.toISOString().slice(0, 10);
}

const watched = ['Date,Name,Year,Letterboxd URI'];
const ratings = ['Date,Name,Year,Letterboxd URI,Rating'];
FILMS.forEach(([title, year, rating], i) => {
  const uri = `https://boxd.it/ex${String(i + 1).padStart(3, '0')}`;
  const row = `${day(i)},${csvField(title)},${year},${uri}`;
  watched.push(row);
  if (rating !== null) ratings.push(`${row},${rating}`);
});

const OUT_DIR = new URL('../public/exemple/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });
const zip = zipSync(
  {
    'watched.csv': strToU8(watched.join('\n') + '\n'),
    'ratings.csv': strToU8(ratings.join('\n') + '\n'),
  },
  { mtime: new Date(Date.UTC(2026, 10, 8)) },
);
writeFileSync(new URL('letterboxd-exemple.zip', OUT_DIR), zip);
console.log(
  `-> public/exemple/letterboxd-exemple.zip (${FILMS.length} films, ${zip.length} bytes)`,
);

// ---------------------------------------------------------------------------------------------
// IMDb ratings example (docs/etape-6-imdb.md, D8): same films, ratings on 1-10, Const = the
// catalogue's imdb_id (MovieLens links.csv). IMDb-only columns stay empty: nothing from the IMDb
// datasets. Needs public/data/ (catalogue ids).

const IMDB_HEADER =
  'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors';

/**
 * Test rows (invented ids, not in the catalogue): [id, title, original, type, year, rating].
 * Title Type in French (a French account, the most likely case; v0.3): only labels seen in a real
 * export. An episode row comes back once its French label is known.
 */
const IMDB_SPECIAL: [string, string, string, string, number, number | null][] = [
  // id not in the catalogue, title in it (via Original Title): « à vérifier », never automatic
  ['tt99000001', 'Die Regenschirme von Cherbourg', 'Les Parapluies de Cherbourg', 'Film', 1964, 9],
  ['tt99000002', 'Anora', 'Anora', 'Film', 2024, 8], // after 2023
  ['tt99000003', 'Chernobyl', 'Chernobyl', 'Série télévisée', 2019, 9], // not a film (mini-series: French label not seen yet)
  ['tt99000004', 'Twin Peaks', 'Twin Peaks', 'Série télévisée', 1990, 9], // not a film
];
/** Localized titles (French account) and original titles, for films found by id. */
const LOCALIZED: Record<string, [string, string]> = {
  'Spirited Away': ['Le Voyage de Chihiro', 'Sen to Chihiro no kamikakushi'],
  'Seven Samurai': ['Les Sept Samouraïs', 'Shichinin no samurai'],
  'The 400 Blows': ['Les Quatre Cents Coups', 'Les quatre cents coups'],
};
/** Letterboxd test titles replaced by the film itself for IMDb (matched by id anyway). */
const IMDB_TITLE: Record<string, string> = {
  'Dr. Strangelove': 'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb',
};

const { loadEngine } = await import('../src/reco/engine');
const DATA = new URL('../public/data/', import.meta.url);
const engine = await loadEngine(
  async (url) => new Response(readFileSync(new URL(url.replace('/data/', ''), DATA))),
);

const imdbRows = [IMDB_HEADER];
let nById = 0;
FILMS.forEach(([title, year, rating], i) => {
  if (year >= 2024 || title === 'Chernobyl') return; // replaced by the IMDb test rows
  const t = IMDB_TITLE[title] ?? title;
  const r = engine.matcher.match(t, year);
  const item = r.item ?? r.candidates[0]?.item; // « Milk »: the most popular of the two
  const id = item === undefined ? null : engine.catalog.imdb_id[item];
  if (!id) throw new Error(`pas d'imdb_id pour ${t} (${year})`);
  const [shown, original] = LOCALIZED[title] ?? [t, t];
  // IMDb ratings are 1-10: twice the Letterboxd rating; « The Matrix » stays unrated (test row),
  // the other unrated films get an invented rating
  const note =
    title === 'The Matrix' ? '' : String(rating === null ? 7 : Math.max(1, Math.round(rating * 2)));
  const url = `https://www.imdb.com/title/${id}/`;
  const row = [id, note, day(i), shown, original, url, 'Film'];
  imdbRows.push([...row, '', '', String(year), '', '', '', ''].map(csvField).join(','));
  nById++;
});
IMDB_SPECIAL.forEach(([id, title, original, type, year, rating], k) => {
  const row = [id, rating === null ? '' : String(rating), day(FILMS.length + k), title, original];
  const rest = [`https://www.imdb.com/title/${id}/`, type, '', '', String(year), '', '', '', ''];
  imdbRows.push([...row, ...rest].map(csvField).join(','));
});
writeFileSync(new URL('imdb-exemple.csv', OUT_DIR), imdbRows.join('\n') + '\n');
console.log(
  `-> public/exemple/imdb-exemple.csv (${imdbRows.length - 1} rows, ${nById} with a catalogue id)`,
);

if (process.argv.includes('--check')) {
  const { importExport } = await import('../src/reco/engine');
  const { matched } = importExport(engine, {
    kind: 'imdb',
    name: 'imdb-exemple.csv',
    text: imdbRows.join('\n'),
  });
  const imdbCounts: Record<string, number> = {};
  for (const m of matched) {
    const k = [m.result.status, m.result.matchedBy, m.result.reason].filter(Boolean).join(' / ');
    imdbCounts[k] = (imdbCounts[k] ?? 0) + 1;
    if (m.result.matchedBy !== 'imdb_id') console.log(`  imdb: ${k.padEnd(28)} ${m.entry.title}`);
  }
  console.log(imdbCounts);
  const counts: Record<string, number> = {};
  for (const [title, year] of FILMS) {
    const r = engine.matcher.match(title, year);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status !== 'exact') {
      const shown = r.item !== undefined ? engine.catalog.title[r.item] : '';
      console.log(`  ${r.status.padEnd(16)} ${title} (${year}) ${shown ? '-> ' + shown : ''}`);
    }
  }
  console.log(counts);
}
