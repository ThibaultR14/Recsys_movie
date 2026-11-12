import type { FilmCard as FilmData } from '../reco/workerCore';
import { becauseText, shortTitle } from '../content/cards';
import { HandNote } from './HandNote';
import {
  POSTER_BASE,
  byline,
  ratingLine,
  cardRotation,
  tagLabel,
  type CardTag,
  isDocumentary,
  letterboxdUrl,
  tapeRotation,
} from './cardRules';

interface FilmCardProps {
  film: FilmData;
  /** Card tag (« ✱ pépite », « encore un … », « ça divise », « vieux trésor »), decided by the
   * grid (`cardTags`, step 6c Q6). */
  tag?: CardTag;
  /** Title of a seen film of the same series, for « (même série que « X », que t'as vu) ». */
  seriesOf?: string;
  /** « (parce que t'as aimé X et Y) » (step 6b, D6); hidden far from the user's taste (Q4). */
  because?: { kind: 'liked' | 'seen'; titles: string[] };
}

function PublicRating({ mean10, count }: { mean10: number; count: number }) {
  const { visible, spoken } = ratingLine(mean10, count);
  return (
    <span className="text-[13px] text-muted" data-testid="public-rating">
      <span aria-hidden="true">★ {visible}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

const CARD_CLASS =
  'relative flex flex-col gap-3 bg-surface px-3 pt-3 pb-[18px] text-ink no-underline shadow-photo';

/** « Taped photo » card (design system §5). The whole card links to the film on Letterboxd. */
/** One colour per tag (step 6c, Q6), same shape and place for all; AA in both themes. */
const TAG_COLORS: Record<CardTag['kind'], string> = {
  pepite: 'bg-surface text-pen',
  realisateur: 'bg-surface text-tag-director',
  divise: 'bg-surface text-tag-divise',
  vieux: 'bg-tag-old text-tag-old-ink',
};

export function FilmCard({ film, tag, seriesOf, because }: FilmCardProps) {
  const label = tag ? tagLabel(tag) : undefined;
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
        {film.publicRating && <PublicRating {...film.publicRating} />}
        {isDocumentary(film.genres) && (
          <span className="text-[13px] text-muted italic">documentaire</span>
        )}
      </span>
      {seriesOf && (
        <HandNote size={20} rotate={-2}>
          (même série que « {seriesOf} », que t'as vu)
        </HandNote>
      )}
      {because && !seriesOf && (
        <HandNote size={20} rotate={-2}>
          <span aria-hidden="true">
            {becauseText(because.kind, because.titles.map(shortTitle))}
          </span>
          <span className="sr-only">{becauseText(because.kind, because.titles)}</span>
        </HandNote>
      )}
      {tag && label && (
        // top right of the poster (step 6b, R9), on a small surface label: readable on any poster
        // and never over the explanation below; every tag looks like the « ✱ pépite » stamp (Q6)
        <span
          data-testid="card-tag"
          data-tag={tag.kind}
          className={`absolute top-5 right-[-8px] max-w-[calc(100%-4px)] rounded-[3px] px-1.5 font-hand text-[24px] leading-tight font-bold text-balance shadow-photo ${TAG_COLORS[tag.kind]}`}
          style={{ transform: 'rotate(-12deg)' }}
        >
          {label.visible === label.full ? (
            label.full
          ) : (
            <>
              <span aria-hidden="true">{label.visible}</span>
              <span className="sr-only">{label.full}</span>
            </>
          )}
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
