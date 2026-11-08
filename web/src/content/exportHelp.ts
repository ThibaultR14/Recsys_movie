import { pending } from './pending';

// Export help carousel (D4): 3 steps for Letterboxd, 4 for IMDb.
export const EXPORT_HELP = {
  titre: pending('aide.titre'),
  precedent: '← précédent',
  suivant: 'suivant →',
  letterboxd: {
    onglet: 'letterboxd',
    etapes: [
      pending('aide.letterboxd.1'),
      pending('aide.letterboxd.2'),
      pending('aide.letterboxd.3'),
    ],
  },
  imdb: {
    onglet: 'imdb',
    etapes: [
      pending('aide.imdb.1'),
      pending('aide.imdb.2'),
      pending('aide.imdb.3'),
      pending('aide.imdb.4'),
    ],
  },
};
