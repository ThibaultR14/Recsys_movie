import { useMemo, useState } from 'react';
import { HandNote } from '../components/HandNote';
import { PrimaryButton } from '../components/PrimaryButton';
import { byline } from '../components/cardRules';
import type { Choices } from '../reco/engine';
import type { ImportSummary } from '../reco/engine';
import type { FilmCard, Unrecognized } from '../reco/workerCore';
import { films, groupUnrecognized, notInCatalogSentence, tooRecentSentence } from './analysis';

const THUMB_BASE = 'https://image.tmdb.org/t/p/w92';
const NONE = 'none';

interface AnalyseProps {
  summary: ImportSummary;
  unrecognized: Unrecognized[];
  onSubmit: (choices: Choices) => void;
  busy?: boolean;
  error?: string;
}

function entryLabel(u: Unrecognized): string {
  return u.year === null ? `« ${u.title} »` : `« ${u.title} » (${u.year})`;
}

function Candidate({ film }: { film: FilmCard }) {
  return (
    <span className="flex items-center gap-3">
      {film.posterPath ? (
        <img
          src={`${THUMB_BASE}${film.posterPath}`}
          alt=""
          loading="lazy"
          className="block aspect-[2/3] w-10 shrink-0 bg-muted/15 object-cover"
        />
      ) : (
        <span aria-hidden="true" className="block aspect-[2/3] w-10 shrink-0 bg-muted/15" />
      )}
      <span className="flex flex-col">
        <span className="font-bold">{film.title}</span>
        <span className="text-[13px] text-muted">{byline(film.directors, film.year)}</span>
      </span>
    </span>
  );
}

function TitleList({ items }: { items: Unrecognized[] }) {
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[15px] text-muted">
      {items.map((u) => (
        <li key={u.index}>
          {u.title}
          {u.year !== null && `, ${u.year}`}
        </li>
      ))}
    </ul>
  );
}

/** Screen 2: what we read in the file, titles to verify, films we don't know. */
export function Analyse({ summary, unrecognized, onSubmit, busy = false, error }: AnalyseProps) {
  const groups = useMemo(() => groupUnrecognized(unrecognized), [unrecognized]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const nConfirmed = Object.values(picked).filter((v) => v !== NONE).length;
  const recognized = summary.nHistoryFilms + nConfirmed;

  const submit = () => {
    const choices: Choices = {};
    for (const [index, value] of Object.entries(picked)) {
      choices[Number(index)] = value === NONE ? null : Number(value);
    }
    onSubmit(choices);
  };

  return (
    <div className="flex flex-col gap-12 pt-10">
      <h1 className="m-0 text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-normal">
        on a lu tes {films(summary.nEntries)}.
        <br />
        on en a reconnu {recognized}.
      </h1>

      {groups.toVerify.length > 0 && (
        <section aria-labelledby="a-verifier" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 id="a-verifier" className="m-0 text-[20px] font-bold">
              à vérifier
            </h2>
            <HandNote rotate={-1.5} size={22}>
              (on hésite sur ces titres : dis-nous lequel c'est, ou aucun)
            </HandNote>
          </div>
          {groups.toVerify.map((u) => (
            <fieldset key={u.index} className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-2 p-0 text-[16px]">
                dans ton fichier : <span className="font-bold">{entryLabel(u)}</span>
              </legend>
              {u.candidates.map((c) => (
                <label
                  key={c.item}
                  className="flex min-h-11 cursor-pointer items-center gap-3 py-1 has-[:checked]:text-pen"
                >
                  <input
                    type="radio"
                    name={`entry-${u.index}`}
                    value={String(c.item)}
                    checked={picked[u.index] === String(c.item)}
                    onChange={() => setPicked((p) => ({ ...p, [u.index]: String(c.item) }))}
                    className="size-5 shrink-0 accent-pen"
                  />
                  <Candidate film={c} />
                </label>
              ))}
              <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                <input
                  type="radio"
                  name={`entry-${u.index}`}
                  value={NONE}
                  checked={picked[u.index] === NONE}
                  onChange={() => setPicked((p) => ({ ...p, [u.index]: NONE }))}
                  className="size-5 shrink-0 accent-pen"
                />
                aucun de ceux-là
              </label>
            </fieldset>
          ))}
        </section>
      )}

      {(groups.tooRecent.length > 0 || groups.notInCatalog.length > 0) && (
        <section className="flex flex-col gap-4 text-[16px]">
          {groups.tooRecent.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer py-2">
                {tooRecentSentence(groups.tooRecent.length)}
              </summary>
              <TitleList items={groups.tooRecent} />
            </details>
          )}
          {groups.notInCatalog.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer py-2">
                {notInCatalogSentence(groups.notInCatalog.length)}
              </summary>
              <TitleList items={groups.notInCatalog} />
            </details>
          )}
        </section>
      )}

      <div className="flex flex-col items-start gap-3">
        <PrimaryButton onClick={submit} disabled={busy || recognized === 0}>
          voir mes films
        </PrimaryButton>
        <p aria-live="polite" className="m-0 min-h-[1.5em] text-[16px]">
          {error && <span role="alert">{error}</span>}
        </p>
      </div>
    </div>
  );
}
