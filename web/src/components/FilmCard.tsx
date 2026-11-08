import type { FilmCard as FilmData } from '../reco/workerCore';
import { HandNote } from './HandNote';
import {
  POSTER_BASE,
  byline,
  cardRotation,
  isDocumentary,
  letterboxdUrl,
  tapeRotation,
} from './cardRules';

interface FilmCardProps {
  film: FilmData;
  /** « ✱ pépite » stamp, decided by the grid (`pepiteStamps`). */
  stamp?: boolean;
  /** Title of a seen film of the same series, for « (même série que « X », que t'as vu) ». */
  seriesOf?: string;
}

const CARD_CLASS =
  'relative flex flex-col gap-3 bg-white px-3 pt-3 pb-[18px] text-ink no-underline shadow-[0_1px_2px_rgba(0,0,0,0.12)]';

/** « Taped photo » card (design system §5). The whole card links to the film on Letterboxd. */
export function FilmCard({ film, stamp = false, seriesOf }: FilmCardProps) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="absolute top-[-10px] left-1/2 ml-[-36px] h-[22px] w-[72px] bg-tape"
        style={{ transform: `rotate(${tapeRotation(film.item)}deg)` }}
      />
      {film.posterPath ? (
        <img
          src={`${POSTER_BASE}${film.posterPath}`}
          alt={film.title}
          loading="lazy"
          className="block aspect-[2/3] w-full bg-muted/15 object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          data-testid="no-poster"
          className="block aspect-[2/3] w-full bg-muted/15"
        />
      )}
      <span className="flex flex-col gap-0.5">
        <span className="text-[16px] leading-tight font-bold">{film.title}</span>
        <span className="text-[13px] text-muted">{byline(film.directors, film.year)}</span>
        {isDocumentary(film.genres) && (
          <span className="text-[13px] text-muted italic">documentaire</span>
        )}
      </span>
      {seriesOf && (
        <HandNote size={20} rotate={-2}>
          (même série que « {seriesOf} », que t'as vu)
        </HandNote>
      )}
      {stamp && (
        <span
          className="absolute right-[-14px] bottom-9 font-hand text-[24px] font-bold text-pen"
          style={{ transform: 'rotate(-12deg)' }}
        >
          ✱ pépite
        </span>
      )}
    </>
  );
  const style = { transform: `rotate(${cardRotation(film.item)}deg)` };
  if (film.tmdbId === null) {
    return (
      <div className={CARD_CLASS} style={style} data-testid="film-card">
        {content}
      </div>
    );
  }
  return (
    <a
      href={letterboxdUrl(film.tmdbId)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${CARD_CLASS} hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pen`}
      style={style}
      data-testid="film-card"
    >
      {content}
      <span className="sr-only">(s'ouvre sur letterboxd, dans un nouvel onglet)</span>
    </a>
  );
}
