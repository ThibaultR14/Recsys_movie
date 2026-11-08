import { useId, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { ExportHelp } from '../components/ExportHelp';
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
  const [help, setHelp] = useState(true);
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
      {/* export help: open by default, right under the drop zone (step 6b, R9) */}
      <div className="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={help}
          aria-controls={helpId}
          onClick={() => setHelp((h) => !h)}
          className="min-h-11 w-fit cursor-pointer bg-transparent p-0 text-left text-[16px] text-muted underline hover:text-pen"
        >
          je sais pas où trouver mon export
        </button>
        <div id={helpId} hidden={!help} className="max-w-[620px]">
          {help && <ExportHelp />}
        </div>
      </div>
      <NoList items={PROMISES} />
      <a
        href="#exemple"
        onClick={(e) => {
          e.preventDefault();
          if (!busy) onExample();
        }}
        className="inline-flex min-h-11 w-fit items-center text-[16px] font-bold text-ink underline hover:text-pen"
      >
        montre-moi un exemple →
      </a>
    </div>
  );
}
