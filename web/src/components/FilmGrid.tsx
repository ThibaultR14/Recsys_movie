import type { FilmCard as FilmData } from '../reco/workerCore';
import { useMemo } from 'react';
import { FilmCard } from './FilmCard';
import { pepiteStamps } from './cardRules';

interface FilmGridProps {
  films: FilmData[];
  /** item_idx -> title of a seen film of the same series. */
  seriesOf?: ReadonlyMap<number, string>;
}

/** Results grid: auto-fill columns of at least 220 px, wide gaps for the tilted cards. */
export function FilmGrid({ films, seriesOf }: FilmGridProps) {
  const stamps = useMemo(() => pepiteStamps(films.map((f) => f.popularity)), [films]);
  return (
    <ul
      aria-label="films recommandés"
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-9 gap-y-14 p-0"
    >
      {films.map((f, i) => (
        <li key={f.item}>
          <FilmCard film={f} stamp={stamps.has(i)} seriesOf={seriesOf?.get(f.item)} />
        </li>
      ))}
    </ul>
  );
}
