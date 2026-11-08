import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_HELP as T } from '../content/exportHelp';
import { RichText } from './RichText';
import {
  DropCsv,
  DropZip,
  ImdbExport,
  ImdbRatings,
  ImdbWait,
  LetterboxdExport,
  LetterboxdSettings,
} from './help/illustrations';

type Source = 'letterboxd' | 'imdb';

const SOURCES: Source[] = ['letterboxd', 'imdb'];

const DRAWINGS: Record<Source, (() => ReactNode)[]> = {
  letterboxd: [LetterboxdSettings, LetterboxdExport, DropZip],
  imdb: [ImdbRatings, ImdbExport, ImdbWait, DropCsv],
};

const linkClass =
  'min-h-11 cursor-pointer bg-transparent p-0 text-[15px] text-ink underline hover:text-pen disabled:cursor-default disabled:no-underline disabled:opacity-50';

/**
 * « où trouver mon export » (docs/etape-6b-retouches.md, D4): ARIA tabs (Letterboxd / IMDb), then
 * steps with « précédent / suivant ». No autoplay, no animation.
 */
export function ExportHelp() {
  const base = useId();
  const [source, setSource] = useState<Source>('letterboxd');
  const [steps, setSteps] = useState<Record<Source, number>>({ letterboxd: 0, imdb: 0 });
  const tabs = useRef<Record<Source, HTMLButtonElement | null>>({ letterboxd: null, imdb: null });

  const texts = T[source].etapes;
  const step = steps[source];
  const Drawing = DRAWINGS[source][step]!;
  const go = (delta: number) =>
    setSteps((s) => ({
      ...s,
      [source]: Math.min(texts.length - 1, Math.max(0, s[source] + delta)),
    }));

  const select = (s: Source) => {
    setSource(s);
    tabs.current[s]?.focus();
  };
  const onTabKey = (e: KeyboardEvent) => {
    const i = SOURCES.indexOf(source);
    const target = {
      ArrowRight: SOURCES[(i + 1) % SOURCES.length],
      ArrowLeft: SOURCES[(i - 1 + SOURCES.length) % SOURCES.length],
      Home: SOURCES[0],
      End: SOURCES[SOURCES.length - 1],
    }[e.key];
    if (target) {
      e.preventDefault();
      select(target);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[16px] font-bold">{T.titre}</p>
      <div role="tablist" aria-label="où trouver ton export" className="flex gap-6">
        {SOURCES.map((s) => (
          <button
            key={s}
            ref={(el) => {
              tabs.current[s] = el;
            }}
            id={`${base}-tab-${s}`}
            type="button"
            role="tab"
            aria-selected={source === s}
            aria-controls={`${base}-panel`}
            tabIndex={source === s ? 0 : -1}
            onClick={() => setSource(s)}
            onKeyDown={onTabKey}
            className={`min-h-11 cursor-pointer border-0 border-b-2 bg-transparent px-0 text-[16px] text-ink hover:text-pen ${source === s ? 'border-pen font-bold' : 'border-transparent'}`}
          >
            {T[s].onglet}
          </button>
        ))}
      </div>
      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${source}`}
        tabIndex={0}
        className="flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pen"
      >
        <Drawing />
        <div aria-live="polite" className="flex flex-col gap-1">
          <p className="m-0 text-[14px] text-muted">
            étape {step + 1} sur {texts.length}
          </p>
          <p className="m-0 text-[15px] leading-relaxed">
            <RichText text={texts[step]!} />
          </p>
        </div>
        <div className="flex gap-6">
          <button type="button" disabled={step === 0} onClick={() => go(-1)} className={linkClass}>
            {T.precedent}
          </button>
          <button
            type="button"
            disabled={step === texts.length - 1}
            onClick={() => go(1)}
            className={linkClass}
          >
            {T.suivant}
          </button>
        </div>
      </div>
    </div>
  );
}
