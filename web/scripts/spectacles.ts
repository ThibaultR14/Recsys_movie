/**
 * Stand-up specials heuristic (step 5, D6, measured in G4): title of the form « Firstname Lastname: … »
 * and the single MovieLens genre « Comedy ». Lists the catalogue films it catches (catalogue data
 * only, no user data), most popular first, as a Markdown table for the step 5 report.
 *
 *   npm run spectacles [-- --all]   # --all: also the films caught by the title alone
 */
import { readFileSync } from 'node:fs';
import { isStandUpTitle } from '../src/reco/spectacle';

interface Catalog {
  title: string[];
  year: (number | null)[];
  directors: string[][];
  genres: number[][];
  genre_names: string[];
}

const DATA = new URL('../public/data/', import.meta.url);
const c = JSON.parse(readFileSync(new URL('catalog.json', DATA), 'utf-8')) as Catalog;
const pop = new Uint32Array(readFileSync(new URL('popularity.bin', DATA)).buffer.slice(0));
const comedy = c.genre_names.indexOf('Comedy');

const rows: { i: number; onlyComedy: boolean }[] = [];
for (let i = 0; i < c.title.length; i++) {
  if (!isStandUpTitle(c.title[i]!)) continue;
  const g = c.genres[i] ?? [];
  rows.push({ i, onlyComedy: g.length === 1 && g[0] === comedy });
}
const caught = rows.filter((r) => r.onlyComedy);
const all = process.argv.includes('--all');
const shown = (all ? rows : caught).sort((a, b) => pop[b.i]! - pop[a.i]!);

console.log(
  `titre « Prénom Nom: … » : ${rows.length} films ; + genre unique Comedy : ${caught.length}`,
);
console.log('');
console.log('| titre | année | réalisateur | popularité |' + (all ? ' Comedy seul |' : ''));
console.log('|---|---|---|---|' + (all ? '---|' : ''));
for (const { i, onlyComedy } of shown) {
  const cells = [c.title[i], c.year[i] ?? '', (c.directors[i] ?? []).join(', '), pop[i]];
  if (all) cells.push(onlyComedy ? 'oui' : 'non');
  console.log(`| ${cells.join(' | ')} |`);
}
