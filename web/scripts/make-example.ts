/**
 * Synthetic example export (step 5, D3): real, well-known films with invented ratings, no personal
 * data. Writes public/exemple/letterboxd-exemple.zip (ratings.csv + watched.csv, Letterboxd format).
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

if (process.argv.includes('--check')) {
  const { loadEngine } = await import('../src/reco/engine');
  const DATA = new URL('../public/data/', import.meta.url);
  const engine = await loadEngine(
    async (url) => new Response(readFileSync(new URL(url.replace('/data/', ''), DATA))),
  );
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
