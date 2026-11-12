import type { FilmCard as FilmData, RecommendedFilm } from '../reco/workerCore';
import { useMemo } from 'react';
import { FilmCard } from './FilmCard';
import { cardTags, citationPicks } from './cardRules';

interface FilmGridProps {
  films: (FilmData & Pick<RecommendedFilm, 'because'>)[];
  /** item_idx -> title of a seen film of the same series. */
  seriesOf?: ReadonlyMap<number, string>;
  /** Show « (parce que t'as aimé X et Y) » (not at a notch far from the user's taste, Q4). */
  explain?: boolean;
  /** Directors of the profile phrase, for the « encore un … » tag (step 6c, Q6). */
  profileDirectors?: readonly string[];
}

/** Results grid: auto-fill columns of at least 220 px, wide gaps for the tilted cards. */
export function FilmGrid({
  films,
  seriesOf,
  explain = true,
  profileDirectors = [],
}: FilmGridProps) {
  // one tag per card, at most 2 per row of 8, « ✱ pépite » first (step 6c, Q6)
  const tags = useMemo(() => cardTags(films, profileDirectors), [films, profileDirectors]);
  const picks = useMemo(
    () => citationPicks(films.map((f) => (explain ? f.because?.items : undefined))),
    [films, explain],
  );
  return (
    <ul
      aria-label="films recommandés"
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-9 gap-y-14 p-0"
    >
      {films.map((f, i) => (
        <li key={f.item}>
          <FilmCard
            film={f}
            tag={tags[i] ?? undefined}
            seriesOf={seriesOf?.get(f.item)}
            because={
              f.because && picks[i]!.length > 0
                ? { kind: f.because.kind, titles: picks[i]!.map((k) => f.because!.titles[k]!) }
                : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}
