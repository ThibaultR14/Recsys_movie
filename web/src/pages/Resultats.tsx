import { useId, useMemo, useState } from 'react';
import { FilmGrid } from '../components/FilmGrid';
import { HandNote } from '../components/HandNote';
import { PrimaryButton } from '../components/PrimaryButton';
import { Slider } from '../components/Slider';
import { isDocumentary } from '../components/cardRules';
import { capLabel } from '../components/sliderText';
import type { RecommendResult } from '../reco/workerCore';
import { FAR_FROM_TASTE, profileNote, titlePhrase } from './resultsText';
import { PAGE, initialView, type ResultsView } from './resultsView';

interface ResultatsProps {
  nEntries: number;
  /** All 8 positions, computed once after the analysis: moving the slider recomputes nothing. */
  reco: RecommendResult;
  /** Controlled view (App keeps it across pages); internal state when absent (tests). */
  view?: ResultsView;
  onViewChange?: (view: ResultsView) => void;
}

/** Screen 3: recommendations, the slider and the annotations (mockup C, D5). */
export function Resultats({ nEntries, reco, view: controlled, onViewChange }: ResultatsProps) {
  const caps = useMemo(() => reco.positions.map((p) => p.cap), [reco]);
  const [own, setOwn] = useState(() => initialView(reco));
  const view = controlled ?? own;
  const setView = (patch: Partial<ResultsView>) => {
    const next = { ...view, ...patch };
    setOwn(next);
    onViewChange?.(next);
  };
  const { index, visible, noDocs } = view;
  const docsId = useId();

  const position = reco.positions[index] ?? reco.positions[0]!;
  const films = useMemo(
    () => (noDocs ? position.films.filter((f) => !isDocumentary(f.genres)) : position.films),
    [position, noDocs],
  );
  const shown = films.slice(0, visible);
  const series = useMemo(
    () => new Map(shown.flatMap((f) => (f.seriesOf ? [[f.item, f.seriesOf] as const] : []))),
    [shown],
  );
  const profile = profileNote(reco.profileDirectors);
  const far = position.relativeScore < FAR_FROM_TASTE;

  return (
    <div className="flex flex-col gap-14 pt-6">
      <div className="flex max-w-[760px] flex-col gap-7">
        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-normal">
            on a lu tes {nEntries} films.
            <br />
            {titlePhrase(position.cap, shown.length)}
          </h1>
          {profile && (
            <HandNote as="p" rotate={-1.5} size={24}>
              {profile}
            </HandNote>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <Slider positions={caps} index={index} onChange={(i) => setView({ index: i })} />
          {far && (
            <HandNote as="p" rotate={-2} size={22}>
              (là, on s'éloigne pas mal de tes goûts habituels)
            </HandNote>
          )}
          <label
            htmlFor={docsId}
            className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-[15px]"
          >
            <input
              id={docsId}
              type="checkbox"
              checked={noDocs}
              onChange={(e) => setView({ noDocs: e.target.checked })}
              className="size-5 accent-pen"
            />
            sans les documentaires
          </label>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {`${shown.length} films${position.cap === null ? '' : `, ${capLabel(position.cap)}`}`}
      </p>

      {shown.length > 0 ? (
        <FilmGrid films={shown} seriesOf={series} explain={!far} />
      ) : (
        <p className="m-0 text-[16px]">plus rien à ce cran-là : essaie un peu plus à gauche.</p>
      )}

      <p className="m-0 text-[14px] text-muted">
        on connaît moins bien les films sortis après 2023, désolé.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
        {visible < films.length && (
          <PrimaryButton onClick={() => setView({ visible: visible + PAGE })}>
            encore des films
          </PrimaryButton>
        )}
        <HandNote size={22} rotate={0}>
          dis-nous si on s'est planté, ça nous aide
        </HandNote>
      </div>
    </div>
  );
}
