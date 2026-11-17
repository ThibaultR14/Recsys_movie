// « des films de… » (step 8b, D4): labels given by Thibault in the spec, and the empty grid text of
// Claude Web. The role is said without gender (« réalise », « joue »): TMDB's gender is not kept.
import type { PersonSuggestion } from '../reco/people';

export const PEOPLE = {
  label: 'des films de…',
  placeholder: 'un réalisateur, une actrice…',
  title: (name: string) => `les films de ${name} que t'as pas vus`,
  back: 'revenir à tes recos',
  allSeen: "t'as déjà vu tous ses films qu'on connaît.",
  /** « réalise · 12 films », « joue · 1950-1965 · 7 films » (years for namesakes only). */
  detail: (s: Pick<PersonSuggestion, 'directs' | 'acts' | 'films' | 'years'>) => {
    const role = [s.directs && 'réalise', s.acts && 'joue'].filter(Boolean).join(' et ');
    const films = s.films === 1 ? '1 film' : `${s.films} films`;
    return [role, s.years, films].filter(Boolean).join(' · ');
  },
};
