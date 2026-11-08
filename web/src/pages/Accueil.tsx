import { useId, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { NoList } from '../components/NoList';
import { Underline } from '../components/Underline';

interface AccueilProps {
  onFile: (file: File) => void;
  onExample: () => void;
  /** « on prépare nos fiches… » / « on lit ton fichier… » while busy. */
  status?: string;
  /** Short message in the site's tone (invalid file, IMDb list…). */
  error?: string;
  busy?: boolean;
}

const PROMISES = [
  'pas de compte à créer',
  'pas de pub, pas de tracking',
  'on garde rien : tout se passe dans ton navigateur',
];

/** Screen 1: home and drop zone (mockup C, exact texts). */
export function Accueil({ onFile, onExample, status, error, busy = false }: AccueilProps) {
  const [help, setHelp] = useState(false);
  const helpId = useId();
  return (
    <div className="flex flex-col gap-10 pt-10">
      <h1 className="m-0 text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-normal">
        salut.
        <br />
        donne-nous ta liste de films,
        <br />
        on te trouve ceux que t'as <Underline>pas encore vus.</Underline>
      </h1>
      <div className="flex flex-col gap-3">
        <DropZone onFile={onFile} disabled={busy} />
        <p aria-live="polite" className="m-0 min-h-[1.5em] text-[16px]">
          {error ? <span role="alert">{error}</span> : status}
        </p>
      </div>
      <NoList items={PROMISES} />
      <div className="flex flex-wrap gap-x-8 gap-y-3 text-[16px]">
        <a
          href="#exemple"
          onClick={(e) => {
            e.preventDefault();
            if (!busy) onExample();
          }}
          className="inline-flex min-h-11 items-center font-bold text-ink underline hover:text-pen"
        >
          montre-moi un exemple →
        </a>
        <button
          type="button"
          aria-expanded={help}
          aria-controls={helpId}
          onClick={() => setHelp((h) => !h)}
          className="min-h-11 cursor-pointer bg-transparent p-0 text-left text-[16px] text-muted underline hover:text-pen"
        >
          je sais pas où trouver mon export
        </button>
      </div>
      <div id={helpId} hidden={!help} className="max-w-[620px] text-[15px] leading-relaxed">
        <p className="m-0">
          sur letterboxd : réglages → import & export → exporter tes données. tu reçois un .zip :
          glisse-le ici tel quel, pas besoin de l'ouvrir.
        </p>
        <p className="m-0 mt-3">
          sur imdb : ton profil → évaluations → actions → exporter. le fichier se prépare sur une
          page à part : attends quelques minutes, recharge, puis télécharge le .csv et glisse-le
          ici.
        </p>
      </div>
    </div>
  );
}
