import { useId, useMemo, useState } from 'react';
import { CategoryPicker } from '../components/CategoryPicker';
import { FilmGrid } from '../components/FilmGrid';
import { HandNote } from '../components/HandNote';
import { PrimaryButton } from '../components/PrimaryButton';
import { Slider } from '../components/Slider';
import { hasFarRow } from '../components/cardRules';
import { capLabel } from '../components/sliderText';
import type { RecommendResult } from '../reco/workerCore';
import { activeCount } from '../reco/filters';
import { availableCategories, categoryAt } from './categories';
import {
  FAR_FROM_TASTE,
  FAR_ROWS_NOTE,
  NOTHING_HERE,
  NOTHING_PASSES,
  profileNote,
  titlePhrase,
} from './resultsText';
import { PAGE, initialView, type ResultsView } from './resultsView';

interface ResultatsProps {
  nEntries: number;
  /** All 8 positions, computed once after the analysis: moving the slider recomputes nothing. */
  reco: RecommendResult;
  /** Controlled view (App keeps it across pages); internal state when absent (tests). */
  view?: ResultsView;
  onViewChange?: (view: ResultsView) => void;
  /** Dev only (`?tampon_estimes=1`, step 8 R6e): « ✱ pépite » allowed on estimated films. */
  stampEstimated?: boolean;
  /** Dev only (`?crans=8`, step 8b D1): the 8-notch slider instead of the three categories. */
  allNotches?: boolean;
  /** A recomputation with new filters is running (step 8b, D2): the grid stays, aria-busy. */
  busy?: boolean;
}

/** Screen 3: recommendations, the three categories (step 8b, D1) and the annotations. */
export function Resultats({
  nEntries,
  reco,
  view: controlled,
  onViewChange,
  stampEstimated,
  allNotches,
  busy,
}: ResultatsProps) {
  const caps = useMemo(() => reco.positions.map((p) => p.cap), [reco]);
  const categories = useMemo(() => availableCategories(caps), [caps]);
  const [own, setOwn] = useState(() => initialView(reco));
  const view = controlled ?? own;
  const setView = (patch: Partial<ResultsView>) => {
    const next = { ...view, ...patch };
    setOwn(next);
    onViewChange?.(next);
  };
  const { index, visible, filters } = view;
  const docsId = useId();

  const position = reco.positions[index] ?? reco.positions[0]!;
  // step 8b (D2): the filters are applied by the worker, the lists arrive filtered
  const films = position.films;
  const shown = films.slice(0, visible);
  const series = useMemo(
    () => new Map(shown.flatMap((f) => (f.seriesOf ? [[f.item, f.seriesOf] as const] : []))),
    [shown],
  );
  const profile = profileNote(reco.profileDirectors);
  // « loin de tes goûts » (step 6b, Q4 revised): when at least half of a displayed row of 8 is
  // below the threshold, one note above the grid and the explanations stay; otherwise the
  // position-level rule of step 5 (note under the slider, explanations hidden).
  const farRows = hasFarRow(
    shown.map((f) => f.relativeScore ?? 1),
    FAR_FROM_TASTE,
  );
  const far = !farRows && position.relativeScore < FAR_FROM_TASTE;
  const category = categoryAt(caps, index);
  const live = category
    ? `${category.label} : ${shown.length} films`
    : `${shown.length} films${position.cap === null ? '' : `, ${capLabel(position.cap)}`}`;

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
          {allNotches || !category ? (
            <Slider positions={caps} index={index} onChange={(i) => setView({ index: i })} />
          ) : (
            <CategoryPicker
              categories={categories}
              index={index}
              onChange={(i) => setView({ index: i })}
            />
          )}
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
              checked={filters.docs}
              onChange={(e) =>
                setView({ filters: { ...filters, docs: e.target.checked }, visible: PAGE })
              }
              className="size-5 accent-pen"
            />
            les documentaires
          </label>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {live}
      </p>

      <div className="flex flex-col gap-14" aria-busy={busy ? 'true' : 'false'}>
        {farRows && (
          <HandNote as="p" rotate={-1.5} size={22}>
            {FAR_ROWS_NOTE}
          </HandNote>
        )}
        {shown.length > 0 ? (
          <FilmGrid
            films={shown}
            seriesOf={series}
            explain={!far}
            profileDirectors={reco.profileDirectors}
            stampEstimated={stampEstimated}
          />
        ) : (
          <p className="m-0 text-[16px]">
            {activeCount(filters) > 0 ? NOTHING_PASSES : NOTHING_HERE}
          </p>
        )}
      </div>

      <p className="m-0 text-[14px] text-muted">
        les films récents sont placés d'après leur contenu : on les connaît moins bien.
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
